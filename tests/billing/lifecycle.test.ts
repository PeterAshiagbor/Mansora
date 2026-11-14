import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBillingCycle } from '../../apps/api/src/billing';
import { startCloud, type Cloud } from '../cloud';
import { admin, approveOnProviderPage, asClient, at, GHS, mkClient, mkPlan, one, q, subscribe } from './helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());
const a = () => admin(cloud);
const sub = async (id: string) => (await a().get(`/subscriptions/${id}`)).body.subscription;

describe('subscription lifecycle: every move is checked and audited', () => {
  let tenant: { id: string; token: string }, planId: string, bigPlan: string, subId: string;

  it('moves through draft, awaiting approval and active, and refuses impossible moves', async () => {
    at(cloud, '2026-11-10');
    planId = await mkPlan(cloud, { price: GHS(100) });
    bigPlan = await mkPlan(cloud, { price: GHS(250) });
    tenant = await mkClient(cloud, 'Lifecycle Co');
    const created = await a().post('/subscriptions', { tenantId: tenant.id, planId });
    subId = created.body.id;
    expect(await sub(subId)).toMatchObject({ status: 'draft', agreed_amount: GHS(100), billing_frequency: 'monthly' });
    await a().post(`/subscriptions/${subId}/submit`);
    expect((await a().post(`/subscriptions/${subId}/submit`)).body.code).toBe('NOT_DRAFT');
    expect((await a().post('/subscriptions', { tenantId: tenant.id, planId })).body.code).toBe('SUBSCRIPTION_EXISTS');
    expect((await a().post(`/subscriptions/${subId}/resume`)).body.code).toBe('INVALID_TRANSITION'); // awaiting approval cannot "resume"
    await a().post(`/subscriptions/${subId}/activate`); // for a client who pays by bank transfer
    expect(await sub(subId)).toMatchObject({ status: 'active' });
    const trail = (await a().get(`/subscriptions/${subId}`)).body.history.filter((h: any) => h.action === 'subscription.transition').map((h: any) => `${JSON.parse(h.detail).from}>${JSON.parse(h.detail).to}`);
    expect(trail).toEqual(['draft>awaiting_approval', 'awaiting_approval>active']);
  });

  it('a price or plan change never alters an invoice already issued; it applies from the next one', async () => {
    const first = await one(cloud, `SELECT id, total FROM invoices WHERE subscription_id = $1`, [subId]);
    expect(first.total).toBe(GHS(100));
    expect((await a().post(`/subscriptions/${subId}/change-plan`, { planId: bigPlan })).status).toBe(200);
    expect((await one(cloud, `SELECT total FROM invoices WHERE id = $1`, [first.id])).total).toBe(GHS(100)); // unchanged
    expect(await sub(subId)).toMatchObject({ agreed_amount: GHS(250) });
    await a().post(`/subscriptions/${subId}/discount`, { discountBps: 1000, note: 'Loyalty discount agreed by Peter' });
    at(cloud, '2026-12-03');
    await runBillingCycle(cloud.billing);
    const next = await one(cloud, `SELECT total, discount_total FROM invoices WHERE subscription_id = $1 AND NOT is_initial`, [subId]);
    expect(next).toMatchObject({ total: GHS(225), discount_total: GHS(25) }); // 250 less 10%
    const history = (await a().get(`/subscriptions/${subId}`)).body.history.map((h: any) => h.action);
    expect(history).toEqual(expect.arrayContaining(['subscription.plan_changed', 'subscription.discount_changed']));
  });

  it('a paused subscription is not invoiced; resuming continues from the next period without back-billing', async () => {
    expect((await a().post(`/subscriptions/${subId}/pause`, { reason: 'Shop closed for renovation' })).status).toBe(200);
    expect(await sub(subId)).toMatchObject({ status: 'paused' });
    const n = (await q(cloud, `SELECT 1 FROM invoices WHERE subscription_id = $1`, [subId])).length;
    at(cloud, '2027-03-15');
    expect((await runBillingCycle(cloud.billing)).invoicesCreated).toBe(0);
    expect((await q(cloud, `SELECT 1 FROM invoices WHERE subscription_id = $1`, [subId])).length).toBe(n);
    await a().post(`/subscriptions/${subId}/resume`);
    const s = await sub(subId);
    expect(s.status).toMatch(/active|payment_due|overdue/);
    expect(s.renewal_date >= '2027-03-15').toBe(true);
    expect(s.renewal_date).toBe('2027-04-10'); // anchored to the 10th, next boundary after today
  });

  it('cancelling at the end of the period lets the paid time run out, then cancels and revokes the authorisation', async () => {
    const t2 = await mkClient(cloud, 'Leaving Co');
    at(cloud, '2027-04-01');
    const s2 = await subscribe(cloud, t2.id, planId);
    const mandate = await asClient(cloud, t2.token).post('/mandate', { method: 'card' });
    await approveOnProviderPage(mandate.body.url);
    expect((await sub(s2.subscriptionId)).status).toBe('active');
    expect((await a().post(`/subscriptions/${s2.subscriptionId}/cancel`, { reason: 'Closing the business', atPeriodEnd: true })).status).toBe(200);
    expect(await sub(s2.subscriptionId)).toMatchObject({ status: 'active', cancel_at_period_end: true });
    at(cloud, '2027-04-27'); // inside the invoice lead time: the period after cancellation is not invoiced
    await runBillingCycle(cloud.billing);
    expect(await q(cloud, `SELECT 1 FROM invoices WHERE subscription_id = $1`, [s2.subscriptionId])).toHaveLength(1);
    at(cloud, '2027-05-01'); // the renewal date: nothing further is invoiced
    const r = await runBillingCycle(cloud.billing);
    expect(r.subscriptionsCancelled).toBe(1);
    expect(await sub(s2.subscriptionId)).toMatchObject({ status: 'cancelled' });
    expect((await one(cloud, `SELECT status FROM payment_mandates WHERE tenant_id = $1`, [t2.id])).status).toBe('cancelled');
    expect(await q(cloud, `SELECT 1 FROM invoices WHERE subscription_id = $1`, [s2.subscriptionId])).toHaveLength(1); // only the initial invoice
    expect((await a().post(`/subscriptions/${s2.subscriptionId}/activate`)).body.code).toBe('INVALID_TRANSITION'); // cancelled is final until re-created
    // a client asking to cancel is recorded and flagged for Mansora, not acted on automatically
    const t3 = await mkClient(cloud, 'Wavering Co');
    const s3 = await subscribe(cloud, t3.id, planId);
    await a().post(`/subscriptions/${s3.subscriptionId}/activate`);
    expect((await asClient(cloud, t3.token).post('/cancellation-request', { reason: 'Too expensive' })).status).toBe(200);
    expect(await sub(s3.subscriptionId)).toMatchObject({ status: 'active', cancel_reason: 'Too expensive' });
    expect((await sub(s3.subscriptionId)).cancel_requested_at).toBeTruthy();
  });

  it('prorates an upgrade only when proration is enabled for that subscription', async () => {
    at(cloud, '2027-06-10');
    const on = await mkClient(cloud, 'Prorate On'), off = await mkClient(cloud, 'Prorate Off');
    const sOn = await subscribe(cloud, on.id, planId, { prorationEnabled: true }), sOff = await subscribe(cloud, off.id, planId);
    await a().post(`/subscriptions/${sOn.subscriptionId}/activate`); await a().post(`/subscriptions/${sOff.subscriptionId}/activate`);
    at(cloud, '2027-06-25'); // 15 of 30 days left in the period 10 June to 9 July
    const upOn = await a().post(`/subscriptions/${sOn.subscriptionId}/change-plan`, { planId: bigPlan });
    const upOff = await a().post(`/subscriptions/${sOff.subscriptionId}/change-plan`, { planId: bigPlan });
    expect(upOff.body.prorationInvoiceId ?? null).toBeNull();
    const pro = (await a().get(`/invoices/${upOn.body.prorationInvoiceId}`)).body;
    expect(pro.total).toBe(GHS(75)); // (250 - 100) x 15/30
    expect(pro.lines[0].description).toContain('Prorated upgrade');
  });

  it('a trial delays the first charge, and automatic payment can be authorised during it', async () => {
    at(cloud, '2027-07-01');
    const trialPlan = await mkPlan(cloud, { price: GHS(120), trialDays: 14 });
    const t = await mkClient(cloud, 'Trial Co');
    const s = await subscribe(cloud, t.id, trialPlan, { activationPolicy: 'mandate' });
    expect(s.invoiceId).toBeNull(); // no setup fee, nothing due yet
    expect(await sub(s.subscriptionId)).toMatchObject({ status: 'awaiting_approval', renewal_date: '2027-07-15' });
    const m = await asClient(cloud, t.token).post('/mandate', { method: 'card' });
    expect(m.status).toBe(409); // a card is authorised by paying an invoice, and there is none yet
    expect(m.body.code).toBe('NOTHING_TO_PAY');
    const momo = await asClient(cloud, t.token).post('/mandate', { method: 'momo', phone: '0244000000' }); // the sandbox wallet flow needs no invoice
    expect(momo.status).toBe(200);
    await approveOnProviderPage(momo.body.url);
    expect(await sub(s.subscriptionId)).toMatchObject({ status: 'trial' });
    at(cloud, '2027-07-08'); // 7 days before the trial ends: first invoice is created
    await runBillingCycle(cloud.billing);
    expect((await sub(s.subscriptionId)).status).toBe('payment_due');
    at(cloud, '2027-07-15');
    await runBillingCycle(cloud.billing);
    expect(await one(cloud, `SELECT status, total FROM invoices WHERE subscription_id = $1`, [s.subscriptionId])).toMatchObject({ status: 'paid', total: GHS(120) });
    expect((await sub(s.subscriptionId)).status).toBe('active');
  });
});
