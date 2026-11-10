import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runReconciliation, runReminders } from '../../apps/api/src/billing';
import { applyPayment, startCheckout } from '../../apps/api/src/billing/payments';
import { startCloud, type Cloud } from '../cloud';
import { admin, approveOnProviderPage, at, GHS, mkClient, one, q } from './helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());
const a = () => admin(cloud);
const SYSTEM = { type: 'admin' as const, id: null };

async function invoice(tenantId: string, amountGhs: number, due: string, issue = true) {
  const r = await a().post('/invoices', { tenantId, lines: [{ description: 'Consultancy retainer', quantity: 1, unitPrice: GHS(amountGhs), serviceCode: 'consultancy' }], dueDate: due, issue });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body.id as string;
}
const detail = async (id: string) => (await a().get(`/invoices/${id}`)).body;

describe('acceptance 12, 13: partial payments, allocations, refunds, credit notes, disputes', () => {
  let client: { id: string; token: string }, inv: string, firstPayment: string;

  it('12. partial payments leave the correct balance and over-payment is refused', async () => {
    at(cloud, '2026-11-10');
    client = await mkClient(cloud, 'Manual Payer');
    inv = await invoice(client.id, 1000, '2026-11-20');
    const p1 = await a().post(`/invoices/${inv}/payment`, { amount: GHS(400), method: 'momo', reference: 'MP-1001' });
    expect(p1.status).toBe(200);
    firstPayment = p1.body.paymentId;
    expect(await detail(inv)).toMatchObject({ status: 'partially_paid', outstanding: GHS(600), amount_paid: GHS(400) });
    await a().post(`/invoices/${inv}/payment`, { amount: GHS(250), method: 'cash' });
    expect(await detail(inv)).toMatchObject({ status: 'partially_paid', outstanding: GHS(350) });
    const over = await a().post(`/invoices/${inv}/payment`, { amount: GHS(351), method: 'cash' });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('EXCEEDS_BALANCE');
    expect((await a().post(`/invoices/${inv}/payment`, { amount: GHS(10), method: 'cash', receivedOn: '2099-01-01' })).body.code).toBe('DATE_IN_FUTURE');
    await a().post(`/invoices/${inv}/payment`, { amount: GHS(350), method: 'bank', reference: 'GCB-2231' });
    expect(await detail(inv)).toMatchObject({ status: 'paid', outstanding: 0, amount_paid: GHS(1000) });
    expect((await a().post(`/invoices/${inv}/payment`, { amount: GHS(1), method: 'cash' })).body.code).toBe('NOT_PAYABLE');
    const doc = (await a().get(`/invoices/${inv}/document`)).body;
    expect(doc.html).toContain('Invoice'); expect(doc.html).toContain('GH₵1,000.00'); expect(doc.html).toContain('RCT-2026-000001'); expect(doc.html).not.toContain('<script');
    const rec = (await a().get(`/payments/${firstPayment}/receipt`)).body;
    expect(rec.html).toContain('GH₵400.00'); expect(rec.html).toContain('RCT-2026-000001');
  });

  it('12. one payment can be spread over several invoices, and any excess is flagged, not lost', async () => {
    const i1 = await invoice(client.id, 300, '2026-11-25'), i2 = await invoice(client.id, 500, '2026-11-25');
    const r = await cloud.db.platform((x) => applyPayment(cloud.billing, x, { tenantId: client.id, amount: GHS(600), method: 'bank', receivedAt: '2026-11-10T10:00:00.000Z', allocations: [{ invoiceId: i1, amount: GHS(300) }, { invoiceId: i2, amount: GHS(300) }], actor: SYSTEM }));
    expect(r).toMatchObject({ allocated: GHS(600), unallocated: 0 });
    expect(await detail(i1)).toMatchObject({ status: 'paid', outstanding: 0 });
    expect(await detail(i2)).toMatchObject({ status: 'partially_paid', outstanding: GHS(200) });
    const cap = await cloud.db.platform((x) => applyPayment(cloud.billing, x, { tenantId: client.id, amount: GHS(250), method: 'momo', provider: 'paystack', providerTxnId: 'ps-1', fee: 375, receivedAt: '2026-11-10T11:00:00.000Z', allocations: [{ invoiceId: i2, amount: GHS(250) }], capToOutstanding: true, actor: SYSTEM }));
    expect(cap).toMatchObject({ allocated: GHS(200), unallocated: GHS(50) });
    expect(await detail(i2)).toMatchObject({ status: 'paid', outstanding: 0 });
    expect((await q(cloud, `SELECT kind FROM billing_exceptions`)).map((e: any) => e.kind)).toContain('unallocated_payment');
    // The same provider transaction can never be recorded twice.
    await expect(cloud.db.platform((x) => applyPayment(cloud.billing, x, { tenantId: client.id, amount: GHS(10), method: 'momo', provider: 'paystack', providerTxnId: 'ps-1', receivedAt: '2026-11-10T11:05:00.000Z', allocations: [], capToOutstanding: true, actor: SYSTEM }))).rejects.toThrow(/duplicate key|unique/i);
  });

  it('13. a refund references its payment, cannot exceed it, and reopens the invoice; a credit note then closes it', async () => {
    const r = await a().post(`/payments/${firstPayment}/refund`, { amount: GHS(100), reason: 'Overlapping service month', viaProvider: false });
    expect(r.body).toMatchObject({ status: 'completed' });
    expect(await one(cloud, `SELECT status, amount_refunded FROM billing_payments WHERE id = $1`, [firstPayment])).toMatchObject({ status: 'partially_refunded', amount_refunded: GHS(100) });
    expect(await detail(inv)).toMatchObject({ status: 'partially_paid', outstanding: GHS(100), amount_refunded: GHS(100) });
    const tooMuch = await a().post(`/payments/${firstPayment}/refund`, { amount: GHS(301), reason: 'x' });
    expect(tooMuch.status).toBe(409); expect(tooMuch.body.code).toBe('REFUND_EXCEEDS_PAYMENT');
    expect((await a().post(`/invoices/${inv}/credit-note`, { amount: GHS(101), reason: 'x' })).body.code).toBe('CREDIT_EXCEEDS_BALANCE');
    const cn = await a().post(`/invoices/${inv}/credit-note`, { amount: GHS(100), reason: 'Agreed with the client' });
    expect(cn.body.number).toBe('CN-2026-000001');
    expect(await detail(inv)).toMatchObject({ status: 'paid', outstanding: 0, amount_credited: GHS(100), total: GHS(1000) }); // the issued invoice itself is never edited
  });

  it('13. a dispute pauses collection and reminders; resolving it restores the invoice', async () => {
    const d = await invoice(client.id, 150, '2026-11-10');
    expect((await a().post(`/invoices/${d}/dispute`, { reason: 'Client says service not delivered' })).status).toBe(200);
    expect(await detail(d)).toMatchObject({ status: 'disputed', outstanding: GHS(150) });
    at(cloud, '2026-11-30');
    const before = (await q(cloud, `SELECT 1 FROM notifications WHERE invoice_id = $1 AND kind LIKE 'reminder%'`, [d])).length;
    await runReminders(cloud.billing);
    expect((await q(cloud, `SELECT 1 FROM notifications WHERE invoice_id = $1 AND kind LIKE 'reminder%'`, [d])).length).toBe(before); // nothing sent while disputed
    expect((await a().post(`/invoices/${d}/dispute`, { reason: 'again' })).body.code).toBe('CANNOT_DISPUTE'); // already disputed
    expect((await a().post(`/invoices/${d}/dispute/resolve`, { resolution: 'Service confirmed delivered' })).status).toBe(200);
    expect(await detail(d)).toMatchObject({ status: 'sent' });
    const w = await a().post(`/invoices/${d}/write-off`, { reason: 'Uncollectable' });
    expect(w.status).toBe(200);
    expect(await detail(d)).toMatchObject({ status: 'written_off', outstanding: 0 });
  });
});

describe('acceptance 15, 16: reminders follow the schedule, stop on payment, and overdue money shows on the dashboard', () => {
  let client: { id: string }, inv: string;
  const sent = async (id: string) => (await q(cloud, `SELECT step, status FROM collection_reminders WHERE invoice_id = $1 ORDER BY created_at, step`, [id]));

  it('sends each step once, on its day, in order', async () => {
    at(cloud, '2027-02-01');
    client = await mkClient(cloud, 'Slow Payer Ltd');
    inv = await invoice(client.id, 200, '2027-02-20');
    const steps: [string, number][] = [['2027-02-16', 0], ['2027-02-17', 1], ['2027-02-20', 2], ['2027-02-23', 3], ['2027-02-27', 4], ['2027-03-06', 5], ['2027-03-22', 6]];
    for (const [day, count] of steps) {
      at(cloud, day);
      await runReminders(cloud.billing);
      await runReminders(cloud.billing); // running again the same day sends nothing more
      expect((await sent(inv)).filter((r: any) => r.status === 'sent'), day).toHaveLength(count);
    }
    expect((await sent(inv)).map((r: any) => r.step)).toEqual(['upcoming', 'due', 'overdue_1', 'overdue_2', 'escalate', 'review']);
    const mail = await q(cloud, `SELECT kind, to_address, body FROM notifications WHERE invoice_id = $1 AND kind LIKE 'reminder_%' ORDER BY created_at`, [inv]);
    expect(mail[0].to_address).toBe('slowpayerltd@clients.test');
    expect(mail[0].body).toContain('/pay/'); expect(mail[0].body).toContain('GH₵200.00'); expect(mail[0].body).toContain('INV-2027-');
    expect(mail[4].to_address).toBe('billing-admin@mansora.test'); // escalation goes to Mansora, not the client
    expect((await q(cloud, `SELECT kind FROM billing_exceptions WHERE invoice_id = $1`, [inv])).map((e: any) => e.kind)).toContain('collection_review');
    expect((await one(cloud, `SELECT status FROM tenants WHERE id = $1`, [client.id])).status).not.toBe('suspended'); // nothing is suspended automatically, however late
  });

  it('16. the overdue invoice shows on the admin dashboard with ageing, and reminders stop once it is paid', async () => {
    const overdue = (await a().get('/collections?filter=overdue')).body;
    expect(overdue.find((r: any) => r.tenant_id === client.id)).toMatchObject({ outstanding: GHS(200), days_overdue: 30 });
    const s = (await a().get('/reports/summary?from=2027-02-01&to=2027-03-31')).body;
    expect(s.receivables.overdue).toBeGreaterThanOrEqual(GHS(200));
    expect(s.receivables.ageing.d15_30).toBeGreaterThanOrEqual(GHS(200));
    expect(s.period.invoiced).toBeGreaterThanOrEqual(GHS(200));
    expect(s.period.cash.gross).toBe(0); // invoiced is not cash
    await a().post(`/invoices/${inv}/payment`, { amount: GHS(200), method: 'momo', reference: 'MP-late' });
    at(cloud, '2027-04-30');
    const n = (await q(cloud, `SELECT 1 FROM notifications WHERE invoice_id = $1 AND kind LIKE 'reminder_%'`, [inv])).length;
    await runReminders(cloud.billing);
    expect((await q(cloud, `SELECT 1 FROM notifications WHERE invoice_id = $1 AND kind LIKE 'reminder_%'`, [inv])).length).toBe(n);
    expect((await a().get('/collections?filter=overdue')).body.some((r: any) => r.tenant_id === client.id)).toBe(false);
  });

  it('when a run is late, only the latest step reached is sent and earlier ones are recorded as skipped', async () => {
    const c2 = await mkClient(cloud, 'Late Run Co');
    at(cloud, '2027-05-01');
    const i2 = await invoice(c2.id, 90, '2027-05-10');
    at(cloud, '2027-05-18'); // 8 days overdue and the job has not run since before the due date
    await runReminders(cloud.billing);
    const rows = await sent(i2);
    expect(rows.filter((r: any) => r.status === 'sent').map((r: any) => r.step)).toEqual(['overdue_2']);
    expect(rows.filter((r: any) => r.status === 'skipped').map((r: any) => r.step).sort()).toEqual(['due', 'overdue_1', 'upcoming']);
  });
});

describe('acceptance 17: revenue, fees and settlements reconcile; cash is kept apart from invoiced revenue and sandbox money', () => {
  it('reports cash, refunds, fees and settlements consistently, and excludes sandbox payments', async () => {
    at(cloud, '2027-06-01');
    const c = await mkClient(cloud, 'Reconcile Me');
    const i1 = await invoice(c.id, 500, '2027-06-10');
    const pay = await cloud.db.platform((x) => applyPayment(cloud.billing, x, { tenantId: c.id, amount: GHS(500), method: 'card', provider: 'paystack', providerTxnId: 'ps-settle-1', reference: 'ref1', fee: GHS(7.5), receivedAt: '2027-06-02T08:00:00.000Z', allocations: [{ invoiceId: i1, amount: GHS(500) }], actor: SYSTEM }));
    // a sandbox payment for another invoice must never count as revenue
    const i2 = await invoice(c.id, 120, '2027-06-12');
    const co = await startCheckout(cloud.billing, { tenantId: c.id, invoiceId: i2, actor: SYSTEM });
    await approveOnProviderPage(co.url);
    expect(await detail(i2)).toMatchObject({ status: 'paid' });
    const s = (await a().get('/reports/summary?from=2027-06-01&to=2027-06-30')).body;
    expect(s.period.cash).toMatchObject({ gross: GHS(500), fees: GHS(7.5), refunds: 0, net: GHS(500), netSettled: GHS(492.5) });
    expect(s.sandboxPaymentsExcluded).toBeGreaterThanOrEqual(1);
    expect(s.period.invoiced).toBe(GHS(620)); // invoiced revenue is a different number from cash
    expect(s.collectedByService.consultancy).toBe(GHS(500));
    const total = (await one(cloud, `SELECT COALESCE(SUM(amount), 0)::bigint AS n FROM billing_payments WHERE sandbox = false AND received_at >= '2027-06-01' AND received_at < '2027-07-01'`)).n;
    expect(total).toBe(s.period.cash.gross);

    const good = await a().post('/settlements', { provider: 'paystack', reference: 'STL-1', settledOn: '2027-06-04', gross: GHS(500), fees: GHS(7.5), paymentIds: [pay.paymentId] });
    expect(good.body).toMatchObject({ linked: 1 });
    expect(await q(cloud, `SELECT 1 FROM billing_exceptions WHERE kind = 'settlement_mismatch'`)).toHaveLength(0);
    const s2 = (await a().get('/reports/summary?from=2027-06-01&to=2027-06-30')).body;
    expect(s2.period.settledByProvider).toBe(GHS(492.5));
    expect(s2.period.settledByProvider).toBe(s2.period.cash.netSettled); // revenue and settlement totals reconcile

    const p2 = await cloud.db.platform((x) => applyPayment(cloud.billing, x, { tenantId: c.id, amount: GHS(80), method: 'card', provider: 'paystack', providerTxnId: 'ps-settle-2', fee: GHS(1.2), receivedAt: '2027-06-03T08:00:00.000Z', allocations: [], capToOutstanding: true, actor: SYSTEM }));
    const bad = await a().post('/settlements', { provider: 'paystack', reference: 'STL-2', settledOn: '2027-06-05', gross: GHS(80), fees: GHS(5), paymentIds: [p2.paymentId] }); // the provider took more in fees than recorded
    expect(bad.status).toBe(200);
    const kinds = (await a().get('/exceptions')).body.map((e: any) => e.kind);
    expect(kinds).toContain('settlement_mismatch');
    const exc = (await a().get('/exceptions')).body.find((e: any) => e.kind === 'settlement_mismatch');
    expect((await a().post(`/exceptions/${exc.id}/resolve`, { resolution: 'Fee schedule confirmed with Paystack' })).status).toBe(200);
    expect((await a().get('/exceptions')).body.some((e: any) => e.id === exc.id)).toBe(false);
  });

  it('a payment whose webhook never arrived is found and recorded by reconciliation', async () => {
    const c = await mkClient(cloud, 'Lost Webhook Ltd');
    const i = await invoice(c.id, 75, '2027-06-20');
    const co = await startCheckout(cloud.billing, { tenantId: c.id, invoiceId: i, actor: SYSTEM });
    const ref = (await one(cloud, `SELECT reference FROM payment_attempts WHERE id = $1`, [co.attemptId])).reference;
    cloud.sandbox.approve(ref); // the customer paid at the provider, but the webhook was lost
    expect(await detail(i)).toMatchObject({ status: 'sent' });
    at(cloud, '2027-06-02T08:30:00.000Z');
    const r = await runReconciliation(cloud.billing);
    expect(r.settled).toBeGreaterThanOrEqual(1);
    expect(await detail(i)).toMatchObject({ status: 'paid', outstanding: 0 });
    expect(await q(cloud, `SELECT 1 FROM billing_payments WHERE attempt_id = $1`, [co.attemptId])).toHaveLength(1);
    const again = await runReconciliation(cloud.billing);
    expect(again.settled).toBe(0);
    expect(await q(cloud, `SELECT 1 FROM billing_payments WHERE attempt_id = $1`, [co.attemptId])).toHaveLength(1);
  });
});
