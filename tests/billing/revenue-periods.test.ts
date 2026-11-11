import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPayment } from '../../apps/api/src/billing/payments';
import { startCloud, type Cloud } from '../cloud';
import { admin, approveOnProviderPage, at, GHS, mkClient } from './helpers';
import { startCheckout } from '../../apps/api/src/billing/payments';

const SYSTEM = { type: 'admin' as const, id: null };
let cloud: Cloud;
let a: ReturnType<typeof admin>;
beforeAll(async () => { cloud = await startCloud(); a = admin(cloud); });
afterAll(async () => { await cloud?.close(); });

const ok = (r: { status: number; body: any }) => { expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
async function invoice(tenantId: string, lines: [string, number][], due: string) {
  return ok(await a.post('/invoices', { tenantId, lines: lines.map(([serviceCode, cedis]) => ({ description: serviceCode, quantity: 1, unitPrice: GHS(cedis), serviceCode })), dueDate: due, issue: true })).id as string;
}
const refund = async (paymentId: string, cedis: number) => ok(await a.post(`/payments/${paymentId}/refund`, { amount: GHS(cedis), reason: 'Test refund', viaProvider: false }));
const report = async (from: string, to: string) => ok(await a.get(`/reports/summary?from=${from}&to=${to}`));
const clientRow = (s: any, id: string) => s.byClient.find((r: any) => r.id === id) ?? { gross: 0, refunded: 0 };
const serviceTotal = (s: any) => Object.values(s.collectedByService).reduce((t: number, v: any) => t + v, 0) + s.collectedUnallocated;

// Every period's client and service breakdowns must agree with its headline (C30 F01).
function expectReconciled(s: any) {
  expect(s.byClient.reduce((t: number, r: any) => t + r.gross, 0)).toBe(s.period.cash.gross);
  expect(s.byClient.reduce((t: number, r: any) => t + r.refunded, 0)).toBe(s.period.cash.refunds);
  expect(serviceTotal(s)).toBe(s.period.cash.net);
}

describe('C30 F01: receipts and refunds each count in their own period', () => {
  it('reconciles the review example: GHS 100 received in November, GHS 20 refunded in December', async () => {
    at(cloud, '2030-11-10');
    const c = await mkClient(cloud, 'Period Example Co');
    const inv = await invoice(c.id, [['review', 100]], '2030-11-20');
    const pay = ok(await a.post(`/invoices/${inv}/payment`, { amount: GHS(100), method: 'cash' }));
    at(cloud, '2030-12-10');
    await refund(pay.paymentId, 20);

    const nov = await report('2030-11-01', '2030-11-30');
    expect(clientRow(nov, c.id)).toMatchObject({ gross: GHS(100), refunded: 0 });
    expect(nov.collectedByService.review).toBe(GHS(100)); // a later refund no longer rewrites history
    expectReconciled(nov);

    const dec = await report('2030-12-01', '2030-12-31');
    expect(clientRow(dec, c.id)).toMatchObject({ gross: 0, refunded: GHS(20) }); // refund-only client is listed
    expect(dec.collectedByService.review).toBe(-GHS(20));
    expectReconciled(dec);
  });

  it('splits a cross-year partial refund across several services and leaves full-refund periods at zero overall', async () => {
    at(cloud, '2031-12-15');
    const c = await mkClient(cloud, 'Multi Service Ltd');
    const inv = await invoice(c.id, [['subscription', 300], ['training', 100]], '2031-12-31');
    const pay = ok(await a.post(`/invoices/${inv}/payment`, { amount: GHS(400), method: 'bank', reference: 'BANK-1' }));
    at(cloud, '2032-01-05');
    await refund(pay.paymentId, 40);
    at(cloud, '2032-02-05');
    await refund(pay.paymentId, 360); // the rest: fully refunded now

    const dec = await report('2031-12-01', '2031-12-31');
    expect(dec.collectedByService).toMatchObject({ subscription: GHS(300), training: GHS(100) });
    expectReconciled(dec);
    const jan = await report('2032-01-01', '2032-01-31');
    expect(jan.collectedByService).toMatchObject({ subscription: -GHS(30), training: -GHS(10) });
    expectReconciled(jan);
    const feb = await report('2032-02-01', '2032-02-29'); // a valid leap day
    expect(feb.collectedByService).toMatchObject({ subscription: -GHS(270), training: -GHS(90) });
    expectReconciled(feb);
    const all = await report('2031-12-01', '2032-02-29');
    expect(all.collectedByService.subscription ?? 0).toBe(0); // received and fully refunded inside the range
    expect(all.collectedByService.training ?? 0).toBe(0);
    expectReconciled(all);
  });

  it('keeps unallocated money separate, refunds it first, and excludes sandbox payments', async () => {
    at(cloud, '2033-03-10');
    const c = await mkClient(cloud, 'Unallocated Shop');
    const inv = await invoice(c.id, [['subscription', 50]], '2033-03-31');
    // GHS 80 arrives: 50 is applied to the invoice, 30 is never applied to any invoice.
    const pay = await cloud.db.platform((x) => applyPayment(cloud.billing, x, { tenantId: c.id, amount: GHS(80), method: 'bank', receivedAt: '2033-03-10T10:00:00.000Z', allocations: [{ invoiceId: inv, amount: GHS(50) }], actor: SYSTEM }));
    const sandboxInv = await invoice(c.id, [['subscription', 25]], '2033-03-31');
    const co = await startCheckout(cloud.billing, { tenantId: c.id, invoiceId: sandboxInv, actor: SYSTEM });
    await approveOnProviderPage(co.url);

    const mar = await report('2033-03-01', '2033-03-31');
    expect(mar.collectedByService.subscription).toBe(GHS(50)); // the sandbox GHS 25 is not revenue
    expect(mar.collectedUnallocated).toBe(GHS(30));
    expectReconciled(mar);

    at(cloud, '2033-04-02');
    await refund(pay.paymentId, 35); // 30 from the unallocated part first, then 5 from the invoice
    const apr = await report('2033-04-01', '2033-04-30');
    expect(apr.collectedUnallocated).toBe(-GHS(30));
    expect(apr.collectedByService.subscription).toBe(-GHS(5));
    expectReconciled(apr);
  });
});

describe('C30 F02: report dates are checked before any query runs', () => {
  it('refuses impossible or reversed dates with a clear 400 and accepts leap days and one-day ranges', async () => {
    for (const bad of ['from=2026-99-01&to=2026-99-30', 'from=2026-02-29&to=2026-03-01', 'from=2026-04-31&to=2026-05-01', 'from=2026-12-31&to=2026-12-01', 'from=2026-1-01&to=2026-01-31']) {
      const r = await a.get(`/reports/summary?${bad}`);
      expect(r.status, bad).toBe(400);
      expect(r.body.code, bad).toBe('INVALID_INPUT');
      const e = await a.get(`/reports/export?kind=payments&${bad}`);
      expect(e.status, `export ${bad}`).toBe(400);
    }
    expect((await a.get('/reports/summary?from=2028-02-29&to=2028-02-29')).status).toBe(200);
    expect((await a.get('/reports/summary')).status).toBe(200); // defaults still work

    const c = await mkClient(cloud, 'Support Range Check');
    const support = await cloud.api('GET', `/v1/admin/clients/${c.id}/reports/summary?from=2026-02-30&to=2026-03-01`);
    expect(support.status).toBe(400);
    const reversed = await cloud.api('GET', `/v1/admin/clients/${c.id}/reports/summary?from=2026-03-02&to=2026-03-01`);
    expect(reversed.status).toBe(400);
  });
});
