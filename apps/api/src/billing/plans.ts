import type { Query } from '../db';

/**
 * The plans approved by the owner on 14 November 2026: Starter, Business and Plus, yearly at ten months' price
 * (two months free), with a GHS 400 setup fee on the first invoice. Added when the server starts if they are not
 * there yet; a plan already present (even with a changed price) is left as it is. Kept out of the migrations so a
 * newly migrated database stays empty for restoring a backup.
 */
export const APPROVED_PLANS = [
  { name: 'Mansora Starter', tier: 'starter', price: 12900, annualPrice: 129000,
    description: 'Sales, stock, receipts and basic reports for one till.', support: 'WhatsApp and email support in working hours' },
  { name: 'Mansora Business', tier: 'business', price: 22900, annualPrice: 229000,
    description: 'Everything in Starter plus staff and permissions, customer credit, suppliers and reordering, profit reports, daily summary and bank and MoMo statements.',
    support: 'WhatsApp and email support in working hours' },
  { name: 'Mansora Plus', tier: 'plus', price: 39900, annualPrice: 399000,
    description: 'Everything in Business, with priority support and new features first.', support: 'Priority WhatsApp and phone support' },
] as const;
export const SETUP_FEE = 40000;

export async function ensureApprovedPlans(q: Query): Promise<number> {
  let added = 0;
  for (const p of APPROVED_PLANS) {
    const rows = await q(`INSERT INTO service_plans (id, name, price, billing_period, annual_price, setup_fee, tier, description, included_support, category)
      VALUES (gen_random_uuid(), $1, $2, 'monthly', $3, $4, $5, $6, $7, 'subscription') ON CONFLICT (name) DO NOTHING RETURNING id`,
      [p.name, p.price, p.annualPrice, SETUP_FEE, p.tier, p.description, p.support]);
    added += rows.length;
  }
  return added;
}
