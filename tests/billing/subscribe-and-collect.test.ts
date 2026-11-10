import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBillingCycle } from '../../apps/api/src/billing';
import { chargeInvoice } from '../../apps/api/src/billing/payments';
import { startCloud, type Cloud } from '../cloud';
import { admin, approveOnProviderPage, asClient, at, GHS, mkClient, mkPlan, one, q, subscribe } from './helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

describe('acceptance 1-8, 11, 14: subscribe, authorise, pay and renew automatically', () => {
  let planId: string, client: { id: string; token: string }, subscriptionId: string, invoiceId: string;
  const a = () => admin(cloud);

  it('1. an administrator creates a monthly plan; prices are configuration, not code', async () => {
    planId = await mkPlan(cloud, { name: 'POS + Inventory', price: GHS(300), setupFee: GHS(50), description: 'POS with stock control' });
    const plan = (await cloud.api('GET', '/v1/admin/plans')).body.find((p: any) => p.id === planId);
    expect(plan).toMatchObject({ price: 30000, setup_fee: 5000, currency: 'GHS', billing_period: 'monthly', trial_days: 0 });
  });

  it('2. a client subscribes: a subscription agreement is recorded and the initial invoice is issued', async () => {
    at(cloud, '2026-11-10');
    client = await mkClient(cloud, 'Adwoa Mart');
    ({ subscriptionId, invoiceId } = (await subscribe(cloud, client.id, planId)) as any);
    const inv = (await a().get(`/invoices/${invoiceId}`)).body;
    expect(inv).toMatchObject({ number: 'INV-2026-000001', status: 'sent', total: 35000, outstanding: 35000, is_initial: true, period_start: '2026-11-10', period_end: '2026-12-09' });
    expect(inv.lines.map((l: any) => [l.service_code, l.line_total])).toEqual([['subscription', 30000], ['setup', 5000]]);
    const s = (await a().get(`/subscriptions/${subscriptionId}`)).body.subscription;
    expect(s).toMatchObject({ status: 'awaiting_approval', renewal_date: '2026-12-10', agreed_amount: 30000 });
  });

  it('3-7. the client authorises a card; only the provider-verified payment marks it paid; receipt and dates are right', async () => {
    const c = asClient(cloud, client.token);
    const start = await c.post('/mandate', { method: 'card' });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ sandbox: true });
    // Starting the authorisation is not paying.
    expect((await a().get(`/invoices/${invoiceId}`)).body.status).toBe('sent');
    expect(await q(cloud, `SELECT 1 FROM billing_payments`)).toHaveLength(0);

    await approveOnProviderPage(start.body.url); // the customer approves on the provider's page; the provider's signed webhook follows

    const inv = (await a().get(`/invoices/${invoiceId}`)).body;
    expect(inv).toMatchObject({ status: 'paid', outstanding: 0, amount_paid: 35000 });
    const pay = await one(cloud, `SELECT * FROM billing_payments`);
    expect(pay).toMatchObject({ amount: 35000, method: 'card', provider: 'sandbox', sandbox: true, status: 'successful', receipt_number: 'RCT-2026-000001' });
    const m = await one(cloud, `SELECT * FROM payment_mandates`);
    expect(m).toMatchObject({ status: 'active', method: 'card', provider: 'sandbox', max_amount: 35000, frequency: 'monthly' });
    expect(m.consent_text).toContain('I authorise');
    expect(m.token_encrypted).toMatch(/^v1\./); // the reusable token is stored encrypted, never in the clear
    expect(m.token_encrypted).not.toContain('sbx_tok');
    const s = (await a().get(`/subscriptions/${subscriptionId}`)).body.subscription;
    expect(s).toMatchObject({ status: 'active', renewal_date: '2026-12-10' }); // 7. next billing date
    const kinds = (await q(cloud, `SELECT kind FROM notifications`)).map((n: any) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['invoice_issued', 'receipt', 'mandate_confirmed']));
    const audit = (await q(cloud, `SELECT action FROM billing_audit_logs`)).map((r: any) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['subscription.created', 'invoice.issued', 'mandate.requested', 'mandate.approved', 'payment.recorded', 'subscription.transition']));
    // The client sees the same thing in its own portal.
    const view = (await c.get('/summary')).body;
    expect(view.subscription).toMatchObject({ status: 'active', plan: 'POS + Inventory', amount: 30000, nextBillingDate: '2026-12-10' });
    expect(view.mandate).toMatchObject({ status: 'active', method: 'card' });
    expect(view.payments[0]).toMatchObject({ amount: 35000, sandbox: true });
  });

  it('8, 11. the next invoice is created ahead of time, collected on its due date, and repeated or concurrent runs change nothing', async () => {
    at(cloud, '2026-12-02');
    expect((await runBillingCycle(cloud.billing)).invoicesCreated).toBe(0); // 8 days before the due date: outside the 7-day lead
    at(cloud, '2026-12-03');
    expect((await runBillingCycle(cloud.billing)).invoicesCreated).toBe(1);
    const second = await runBillingCycle(cloud.billing);
    const third = await runBillingCycle(cloud.billing);
    expect([second.invoicesCreated, third.invoicesCreated]).toEqual([0, 0]);
    const invoices = await q(cloud, `SELECT * FROM invoices WHERE subscription_id = $1 ORDER BY created_at`, [subscriptionId]);
    expect(invoices).toHaveLength(2);
    expect(invoices[1]).toMatchObject({ status: 'sent', total: 30000, due_date: '2026-12-10', period_start: '2026-12-10', period_end: '2027-01-09', is_initial: false });
    expect((await one(cloud, `SELECT renewal_date, status FROM client_subscriptions WHERE id = $1`, [subscriptionId]))).toMatchObject({ renewal_date: '2027-01-10', status: 'payment_due' });
    expect(await q(cloud, `SELECT 1 FROM payment_attempts WHERE kind = 'mandate_charge'`)).toHaveLength(0); // nothing is charged before the due date

    at(cloud, '2026-12-10');
    const runs = await Promise.all([runBillingCycle(cloud.billing), runBillingCycle(cloud.billing), runBillingCycle(cloud.billing)]);
    expect(runs.reduce((n, r) => n + r.chargesInitiated, 0)).toBe(1);
    expect(runs.flatMap((r) => r.errors)).toEqual([]);
    expect(await q(cloud, `SELECT 1 FROM payment_attempts WHERE kind = 'mandate_charge'`)).toHaveLength(1);
    expect(await q(cloud, `SELECT 1 FROM billing_payments`)).toHaveLength(2); // one charge, one payment, however many runs
    expect((await one(cloud, `SELECT status, amount_paid FROM invoices WHERE id = $1`, [invoices[1].id]))).toMatchObject({ status: 'paid', amount_paid: 30000 });
    expect((await one(cloud, `SELECT status FROM client_subscriptions WHERE id = $1`, [subscriptionId])).status).toBe('active');
    expect((await one(cloud, `SELECT receipt_number FROM billing_payments ORDER BY received_at DESC LIMIT 1`)).receipt_number).toBe('RCT-2026-000002');
  });

  it('14. a cancelled authorisation is never charged, and the provider is told to revoke it', async () => {
    const c = asClient(cloud, client.token);
    expect((await c.post('/mandate/cancel')).status).toBe(200);
    expect((await one(cloud, `SELECT status, cancel_reason FROM payment_mandates`))).toMatchObject({ status: 'cancelled', cancel_reason: 'Cancelled by the client' });
    expect(cloud.sandbox.revokedTokens.size).toBe(1);
    at(cloud, '2027-01-03');
    expect((await runBillingCycle(cloud.billing)).invoicesCreated).toBe(1); // still invoiced...
    at(cloud, '2027-01-10');
    const r = await runBillingCycle(cloud.billing);
    expect(r.chargesInitiated).toBe(0); // ...but never charged
    const jan = await one(cloud, `SELECT id, status FROM invoices WHERE due_date = '2027-01-10'`);
    expect(jan.status).toBe('sent');
    expect(await q(cloud, `SELECT 1 FROM payment_attempts WHERE invoice_id = $1`, [jan.id])).toHaveLength(0);
    expect(await chargeInvoice(cloud.billing, jan.id, { force: true, actor: { type: 'admin', id: null } })).toMatchObject({ result: 'skipped', reason: 'no_active_mandate' });
    expect((await c.post('/mandate/cancel')).status).toBe(409); // nothing left to cancel
  });
});
