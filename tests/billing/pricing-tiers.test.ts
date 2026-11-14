import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBillingCycle } from '../../apps/api/src/billing';
import { ensureApprovedPlans } from '../../apps/api/src/billing/plans';
import { startCloud, type Cloud } from '../cloud';
import { admin, at, GHS, mkClient, one, q, subscribe } from './helpers';

let cloud: Cloud;
beforeAll(async () => { cloud = await startCloud(); expect(await cloud.db.platform((x) => ensureApprovedPlans(x))).toBe(3); expect(await cloud.db.platform((x) => ensureApprovedPlans(x))).toBe(0); });
afterAll(() => cloud.close());
const a = () => admin(cloud);
const plan = (name: string) => one(cloud, `SELECT * FROM service_plans WHERE name = $1`, [name]);

describe('approved pricing (owner, 14 November 2026)', () => {
  it('offers Starter, Business and Plus monthly, yearly at ten months (two months free), with a GHS 400 setup fee', async () => {
    const tiers = await q(cloud, `SELECT name, tier, price, annual_price, setup_fee, billing_period FROM service_plans WHERE tier IS NOT NULL ORDER BY price`);
    expect(tiers).toEqual([
      { name: 'Mansora Starter', tier: 'starter', price: GHS(129), annual_price: GHS(1290), setup_fee: GHS(400), billing_period: 'monthly' },
      { name: 'Mansora Business', tier: 'business', price: GHS(229), annual_price: GHS(2290), setup_fee: GHS(400), billing_period: 'monthly' },
      { name: 'Mansora Plus', tier: 'plus', price: GHS(399), annual_price: GHS(3990), setup_fee: GHS(400), billing_period: 'monthly' },
    ]);
  });

  it('bills a client yearly at the yearly price, with the setup fee on the first invoice', async () => {
    at(cloud, '2026-11-14');
    const business = await plan('Mansora Business');
    const t = await mkClient(cloud, 'Yearly Shop');
    const { subscriptionId, invoiceId } = await subscribe(cloud, t.id, business.id, { frequency: 'yearly' });
    expect(await one(cloud, `SELECT agreed_amount, billing_frequency, renewal_date FROM client_subscriptions WHERE id = $1`, [subscriptionId]))
      .toEqual({ agreed_amount: GHS(2290), billing_frequency: 'yearly', renewal_date: '2027-11-14' });
    expect(await one(cloud, `SELECT total FROM invoices WHERE id = $1`, [invoiceId])).toEqual({ total: GHS(2290 + 400) });
    // Quarterly is not offered on these plans.
    const t2 = await mkClient(cloud, 'Quarterly Shop');
    expect((await a().post('/subscriptions', { tenantId: t2.id, planId: business.id, frequency: 'quarterly' })).body.code).toBe('FREQUENCY_NOT_OFFERED');
  });

  it('a pilot: setup fee waived (shown at no charge), discounted price until a date, then the full price', async () => {
    at(cloud, '2026-11-14');
    const starter = await plan('Mansora Starter');
    const t = await mkClient(cloud, 'Pilot Shop');
    const { subscriptionId, invoiceId } = await subscribe(cloud, t.id, starter.id, {
      setupFeeWaived: true, setupWaiverNote: 'Pilot shop', discountBps: 5000, discountNote: 'Pilot price', discountUntil: '2027-02-14',
    });
    const lines = await q(cloud, `SELECT description, unit_price, discount FROM invoice_line_items WHERE invoice_id = $1 ORDER BY description`, [invoiceId]);
    expect(lines).toEqual([
      { description: 'Mansora Starter (2026-11-14 to 2026-12-13) · Pilot price', unit_price: GHS(129), discount: GHS(64.5) },
      { description: 'Mansora Starter one-time setup (waived: Pilot shop)', unit_price: GHS(400), discount: GHS(400) },
    ]);
    expect(await one(cloud, `SELECT total FROM invoices WHERE id = $1`, [invoiceId])).toEqual({ total: GHS(64.5) });
    await a().post(`/subscriptions/${subscriptionId}/activate`);
    // Periods starting before 14 February keep the pilot price; the one starting on 14 February is full price.
    const totals: Record<string, number> = {};
    for (const day of ['2026-12-14', '2027-01-14', '2027-02-14']) {
      at(cloud, day);
      await runBillingCycle(cloud.billing);
      totals[day] = (await one(cloud, `SELECT total FROM invoices WHERE subscription_id = $1 AND period_start = $2`, [subscriptionId, day])).total;
    }
    expect(totals).toEqual({ '2026-12-14': GHS(64.5), '2027-01-14': GHS(64.5), '2027-02-14': GHS(129) });
  });

  it('refuses a pilot end date without a discount, or before the start', async () => {
    at(cloud, '2026-11-14');
    const starter = await plan('Mansora Starter');
    const t = await mkClient(cloud, 'Bad Pilot Shop');
    expect((await a().post('/subscriptions', { tenantId: t.id, planId: starter.id, discountUntil: '2027-01-01' })).body.code).toBe('NO_DISCOUNT');
    expect((await a().post('/subscriptions', { tenantId: t.id, planId: starter.id, discountBps: 1000, discountUntil: '2026-11-01' })).body.code).toBe('INVALID_DATE');
  });
});

describe('changing plan keeps how the client is billed', () => {
  it('a yearly client moved from Starter to Business stays yearly at the Business yearly price', async () => {
    at(cloud, '2026-11-14');
    const t = await mkClient(cloud, 'Upgrade Shop');
    const { subscriptionId } = await subscribe(cloud, t.id, (await plan('Mansora Starter')).id, { frequency: 'yearly' });
    expect((await a().post(`/subscriptions/${subscriptionId}/change-plan`, { planId: (await plan('Mansora Business')).id })).status).toBe(200);
    expect(await one(cloud, `SELECT agreed_amount, billing_frequency FROM client_subscriptions WHERE id = $1`, [subscriptionId])).toEqual({ agreed_amount: GHS(2290), billing_frequency: 'yearly' });
  });
});
