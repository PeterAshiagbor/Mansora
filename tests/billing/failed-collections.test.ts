import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBillingCycle, runReconciliation } from '../../apps/api/src/billing';
import { startCloud, type Cloud } from '../cloud';
import { admin, approveOnProviderPage, asClient, at, GHS, mkClient, mkPlan, one, q, subscribe } from './helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

describe('acceptance 9, 21: failed collections never show as paid, and provider trouble is visible and recoverable', () => {
  let subId: string, invoiceId: string, tenantId: string;
  const a = () => admin(cloud);
  const attempts = () => q(cloud, `SELECT * FROM payment_attempts WHERE kind = 'mandate_charge' ORDER BY attempt_no`);

  it('set up: a client with an active card authorisation and a paid first month', async () => {
    at(cloud, '2026-11-10');
    const plan = await mkPlan(cloud, { price: GHS(200) });
    const client = await mkClient(cloud, 'Kwesi Provisions');
    tenantId = client.id;
    const s = await subscribe(cloud, client.id, plan);
    subId = s.subscriptionId;
    const start = await asClient(cloud, client.token).post('/mandate', { method: 'card' });
    await approveOnProviderPage(start.body.url);
    expect((await one(cloud, `SELECT status FROM client_subscriptions WHERE id = $1`, [subId])).status).toBe('active');
  });

  it('9. a declined collection leaves the invoice unpaid, flags the subscription and tells the client', async () => {
    cloud.sandbox.nextChargeOutcome = 'failed';
    at(cloud, '2026-12-03');
    await runBillingCycle(cloud.billing);
    at(cloud, '2026-12-10');
    const r = await runBillingCycle(cloud.billing);
    expect(r.chargesInitiated).toBe(1);
    invoiceId = (await one(cloud, `SELECT id FROM invoices WHERE due_date = '2026-12-10'`)).id;
    const [att] = await attempts();
    expect(att).toMatchObject({ status: 'failed', failure_reason: 'Insufficient funds (sandbox)', attempt_no: 1 });
    expect(await one(cloud, `SELECT status, amount_paid FROM invoices WHERE id = $1`, [invoiceId])).toMatchObject({ status: 'sent', amount_paid: 0 });
    expect(await q(cloud, `SELECT 1 FROM billing_payments`)).toHaveLength(1); // only the first month
    expect((await one(cloud, `SELECT status FROM client_subscriptions WHERE id = $1`, [subId])).status).toBe('payment_failed');
    expect((await q(cloud, `SELECT kind FROM notifications WHERE kind = 'payment_failed'`))).toHaveLength(1);
    const detail = (await a().get(`/invoices/${invoiceId}`)).body;
    expect(detail.attempts[0]).toMatchObject({ status: 'failed' });
    expect(detail.display_status).toBe('sent'); // due today, not yet overdue
  });

  it('retries wait the configured interval and stop at the configured maximum', async () => {
    const again = await runBillingCycle(cloud.billing);
    expect(again.chargesSkipped.retry_not_due).toBe(1);
    expect(await attempts()).toHaveLength(1);
    at(cloud, '2026-12-13');
    await runBillingCycle(cloud.billing);
    at(cloud, '2026-12-16');
    await runBillingCycle(cloud.billing);
    expect(await attempts()).toHaveLength(3);
    at(cloud, '2026-12-19');
    const last = await runBillingCycle(cloud.billing);
    expect(last.chargesSkipped.max_attempts).toBe(1);
    expect(await attempts()).toHaveLength(3);
    expect((await one(cloud, `SELECT status FROM client_subscriptions WHERE id = $1`, [subId])).status).toBe('overdue');
    expect((await a().get(`/invoices/${invoiceId}`)).body).toMatchObject({ display_status: 'overdue', days_overdue: 9 });
  });

  it('21. when the provider cannot be reached, the outcome is not guessed, nothing is double-charged, and it recovers', async () => {
    cloud.sandbox.down = true;
    const first = await a().post(`/invoices/${invoiceId}/retry`);
    expect(first.status).toBe(200);
    const [, , , stuck] = await attempts();
    expect(stuck.status).toBe('pending'); // unknown, so not failed and not paid
    expect(stuck.failure_reason).toContain('No clear answer');
    expect((await q(cloud, `SELECT kind, status FROM billing_exceptions`)).map((e: any) => e.kind)).toContain('provider_error');
    const second = await a().post(`/invoices/${invoiceId}/retry`);
    expect(second.body).toMatchObject({ result: 'skipped', reason: 'in_flight' }); // the same invoice cannot be charged twice
    expect(await attempts()).toHaveLength(4);
    expect(await one(cloud, `SELECT status FROM invoices WHERE id = $1`, [invoiceId])).toMatchObject({ status: 'sent' });

    cloud.sandbox.down = false;
    at(cloud, '2026-12-19T13:00:00Z'); // reconciliation checks with the provider, which has no record of the lost request
    const rec = await runReconciliation(cloud.billing);
    expect(rec.settled).toBe(1);
    expect((await attempts())[3].status).toBe('failed');

    cloud.sandbox.nextChargeOutcome = 'successful'; // the client topped up their wallet
    const retry = await a().post(`/invoices/${invoiceId}/retry`);
    expect(retry.body).toMatchObject({ result: 'initiated' });
    expect(await one(cloud, `SELECT status, amount_paid FROM invoices WHERE id = $1`, [invoiceId])).toMatchObject({ status: 'paid', amount_paid: 20000 });
    expect((await one(cloud, `SELECT status FROM client_subscriptions WHERE id = $1`, [subId])).status).toBe('active');
    expect(await q(cloud, `SELECT 1 FROM billing_payments`)).toHaveLength(2);
    void tenantId;
  });
});
