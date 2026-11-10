import { randomUUID } from 'node:crypto';
import { mulDivRound } from '@mansora/domain';
import type { Query } from '../db';
import { addDays, addMonths, daysBetween, FREQUENCY_MONTHS, monthlyEquivalent, nextBoundary, type Frequency } from './dates';
import { audit, ensureBillingAccount, fail, loadSettings, nowIso, queueEmail, today, unseal, type Actor, type Billing } from './core';
import { createInvoice, type LineInput } from './invoices';

const LIVE = ['active', 'payment_due', 'payment_failed', 'overdue', 'past_due'];
/** The subscription lifecycle. Every move is checked against this table and written to the audit log. */
const ALLOWED: Record<string, string[]> = {
  draft: ['awaiting_approval', 'active', 'cancelled'],
  awaiting_approval: ['active', 'trial', 'cancelled', 'draft'],
  trial: ['payment_due', 'active', 'paused', 'cancelled'],
  active: ['payment_due', 'payment_failed', 'overdue', 'paused', 'cancelled', 'expired'],
  payment_due: ['active', 'payment_failed', 'overdue', 'paused', 'cancelled'],
  payment_failed: ['active', 'payment_due', 'overdue', 'paused', 'cancelled'],
  overdue: ['active', 'payment_due', 'payment_failed', 'paused', 'cancelled'],
  past_due: ['active', 'payment_due', 'payment_failed', 'overdue', 'paused', 'cancelled'],
  paused: ['active', 'cancelled'],
  cancelled: ['draft'],
  expired: ['draft'],
};
const label = (s: string) => s.replace(/_/g, ' ');

export async function transition(b: Billing, q: Query, subId: string, to: string, actor: Actor, reason?: string): Promise<any> {
  const [s] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!s) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (s.status === to) return s;
  if (!ALLOWED[s.status]?.includes(to)) fail(409, 'INVALID_TRANSITION', `A subscription that is ${label(s.status)} cannot become ${label(to)}`);
  await q(`UPDATE client_subscriptions SET status = $2, updated_at = $3,
    paused_at = CASE WHEN $2 = 'paused' THEN $3::timestamptz WHEN $2 = 'active' THEN NULL ELSE paused_at END,
    cancelled_at = CASE WHEN $2 = 'cancelled' THEN $3::timestamptz ELSE cancelled_at END WHERE id = $1`, [subId, to, nowIso(b)]);
  await audit(q, { actor, action: 'subscription.transition', entityType: 'subscription', entityId: subId, tenantId: s.tenant_id, detail: { from: s.status, to, reason: reason ?? null } });
  return { ...s, status: to };
}

async function planOf(q: Query, id: string): Promise<any> {
  const [p] = await q(`SELECT * FROM service_plans WHERE id = $1`, [id]);
  if (!p) fail(404, 'NOT_FOUND', 'Plan not found');
  return p;
}

/** Invoice lines for one billing period of a subscription: the agreed amount, less any approved discount. */
export function periodLines(plan: any, sub: any, from: string, toExclusive: string): LineInput[] {
  const discount = mulDivRound(sub.agreed_amount, sub.discount_bps, 10_000);
  return [{ description: `${plan.name} (${from} to ${addDays(toExclusive, -1)})`, quantity: 1, unitPrice: sub.agreed_amount, discount, serviceCode: plan.category }];
}
export const netAmount = (sub: any) => sub.agreed_amount - mulDivRound(sub.agreed_amount, sub.discount_bps, 10_000);

export interface NewSubscription { tenantId: string; planId: string; agreedAmount?: number | null; startDate?: string | null; discountBps?: number; activationPolicy?: 'first_payment' | 'mandate'; paymentMethod?: string | null; prorationEnabled?: boolean }
export async function createSubscription(b: Billing, q: Query, i: NewSubscription, actor: Actor): Promise<string> {
  const plan = await planOf(q, i.planId);
  if (!plan.active) fail(409, 'PLAN_RETIRED', 'This plan is no longer offered');
  const [existing] = await q(`SELECT * FROM client_subscriptions WHERE tenant_id = $1 FOR UPDATE`, [i.tenantId]);
  if (existing && !['cancelled', 'expired', 'draft'].includes(existing.status)) fail(409, 'SUBSCRIPTION_EXISTS', 'This client already has a subscription. Change its plan instead.');
  const s = await loadSettings(q);
  const start = i.startDate ?? today(b), amount = i.agreedAmount ?? plan.price;
  if (!Number.isSafeInteger(amount) || amount < 0) fail(400, 'INVALID_AMOUNT', 'The agreed amount must be a whole number of pesewas');
  await ensureBillingAccount(q, i.tenantId);
  const vals = [plan.id, amount, plan.billing_period, start, i.activationPolicy ?? s.activationPolicy, i.discountBps ?? 0, i.paymentMethod ?? null, i.prorationEnabled ?? false];
  let id = existing?.id as string | undefined;
  if (id) {
    await q(`UPDATE client_subscriptions SET plan_id = $2, agreed_amount = $3, billing_frequency = $4, start_date = $5, billing_anchor = $5, activation_policy = $6, discount_bps = $7, payment_method = $8, proration_enabled = $9,
      status = 'draft', renewal_date = NULL, mandate_id = NULL, cancel_requested_at = NULL, cancel_reason = NULL, cancel_at_period_end = false, paused_at = NULL, cancelled_at = NULL, updated_at = $10 WHERE id = $1`, [id, ...vals, nowIso(b)]);
  } else {
    id = randomUUID();
    await q(`INSERT INTO client_subscriptions (id, tenant_id, plan_id, status, agreed_amount, billing_frequency, start_date, billing_anchor, activation_policy, discount_bps, payment_method, proration_enabled, updated_at)
      VALUES ($1, $2, $3, 'draft', $4, $5, $6, $6, $7, $8, $9, $10, $11)`, [id, i.tenantId, ...vals, nowIso(b)]);
  }
  await audit(q, { actor, action: 'subscription.created', entityType: 'subscription', entityId: id, tenantId: i.tenantId, detail: { planId: plan.id, amount, frequency: plan.billing_period, start } });
  return id;
}

/** Draft to awaiting approval: sets the billing calendar and issues the initial invoice (setup fee and the first period). */
export async function submitSubscription(b: Billing, q: Query, subId: string, actor: Actor): Promise<{ invoiceId: string | null }> {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (sub.status !== 'draft') fail(409, 'NOT_DRAFT', 'Only a draft subscription can be sent for approval');
  const plan = await planOf(q, sub.plan_id);
  const s = await loadSettings(q);
  const months = FREQUENCY_MONTHS[sub.billing_frequency as Frequency];
  const start = sub.start_date ?? today(b);
  let renewal: string, anchor: string;
  const lines: LineInput[] = [];
  let periodStart: string | null = null, periodEnd: string | null = null;
  if (plan.trial_days > 0) {
    renewal = anchor = addDays(start, plan.trial_days);
  } else {
    anchor = start; renewal = addMonths(anchor, months); periodStart = start; periodEnd = addDays(renewal, -1);
    lines.push(...periodLines(plan, sub, start, renewal));
  }
  if (plan.setup_fee > 0) lines.push({ description: `${plan.name} one-time setup`, quantity: 1, unitPrice: plan.setup_fee, serviceCode: 'setup' });
  let invoiceId: string | null = null;
  if (lines.length && lines.reduce((t, l) => t + l.quantity * l.unitPrice - (l.discount ?? 0), 0) > 0) {
    ({ id: invoiceId } = await createInvoice(b, q, { tenantId: sub.tenant_id, subscriptionId: subId, lines, dueDate: addDays(today(b), s.defaultDueDays), periodStart, periodEnd, isInitial: true, issue: true, actor, idempotencyKey: `sub:${subId}:initial:${start}` }));
  }
  await q(`UPDATE client_subscriptions SET status = 'awaiting_approval', renewal_date = $2, billing_anchor = $3, start_date = $4, updated_at = $5 WHERE id = $1`, [subId, renewal, anchor, start, nowIso(b)]);
  await audit(q, { actor, action: 'subscription.transition', entityType: 'subscription', entityId: subId, tenantId: sub.tenant_id, detail: { from: 'draft', to: 'awaiting_approval', initialInvoice: invoiceId, nextBillingDate: renewal } });
  return { invoiceId };
}

/** Activate when the agreed policy is met: initial invoice paid (default) or a payment authorisation approved. */
export async function maybeActivate(b: Billing, q: Query, subId: string, actor: Actor): Promise<void> {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub || sub.status !== 'awaiting_approval') return;
  const [m] = await q(`SELECT 1 AS ok FROM payment_mandates WHERE id = $1 AND status = 'active'`, [sub.mandate_id]);
  const initial = await q(`SELECT status FROM invoices WHERE subscription_id = $1 AND is_initial AND status <> 'cancelled'`, [subId]);
  const ok = sub.activation_policy === 'mandate' ? !!m : initial.length ? initial.every((i: any) => i.status === 'paid') : !!m;
  if (!ok) return;
  const plan = await planOf(q, sub.plan_id);
  await transition(b, q, subId, plan.trial_days > 0 && sub.renewal_date > today(b) ? 'trial' : 'active', actor, 'Activation condition met');
}

/** Bring a live subscription's status in line with what it owes: active, payment due, payment failed or overdue. */
export async function recomputeSubscription(b: Billing, q: Query, subId: string, actor: Actor): Promise<void> {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1`, [subId]);
  if (!sub || !LIVE.includes(sub.status)) return;
  const unpaid = await q(`SELECT i.id, i.due_date, (SELECT a.status FROM payment_attempts a WHERE a.invoice_id = i.id ORDER BY a.created_at DESC LIMIT 1) AS last_attempt
    FROM invoices i WHERE i.subscription_id = $1 AND i.status IN ('sent','partially_paid')`, [subId]);
  const day = today(b);
  const to = !unpaid.length ? 'active' : unpaid.some((i: any) => i.due_date < day) ? 'overdue' : unpaid.some((i: any) => i.last_attempt === 'failed') ? 'payment_failed' : 'payment_due';
  if (to !== sub.status) await transition(b, q, subId, to, actor);
}

/** Called after money lands on a subscription invoice. */
export async function onInvoicePaid(b: Billing, q: Query, subId: string, actor: Actor): Promise<void> {
  await q(`UPDATE client_subscriptions SET last_payment_at = $2 WHERE id = $1`, [subId, nowIso(b)]);
  await maybeActivate(b, q, subId, actor);
  await recomputeSubscription(b, q, subId, actor);
}

/** For clients who pay by bank transfer or cash: Mansora switches the subscription on by hand. */
export async function activateManually(b: Billing, q: Query, subId: string, actor: Actor): Promise<void> {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (sub.status === 'draft') await submitSubscription(b, q, subId, actor);
  await transition(b, q, subId, 'active', actor, 'Activated manually');
}

export async function pauseSubscription(b: Billing, q: Query, subId: string, reason: string, actor: Actor) { await transition(b, q, subId, 'paused', actor, reason); }

export async function resumeSubscription(b: Billing, q: Query, subId: string, actor: Actor) {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (sub.status !== 'paused') fail(409, 'INVALID_TRANSITION', `Only a paused subscription can be resumed. This one is ${label(sub.status)}.`);
  await transition(b, q, subId, 'active', actor, 'Resumed');
  const day = today(b);
  // Billing carries on from the next period boundary. Nothing is invoiced for the time it was paused.
  if (sub.billing_anchor && (!sub.renewal_date || sub.renewal_date < day)) {
    await q(`UPDATE client_subscriptions SET renewal_date = $2 WHERE id = $1`, [subId, nextBoundary(sub.billing_anchor, addDays(day, -1), FREQUENCY_MONTHS[sub.billing_frequency as Frequency])]);
  }
  await recomputeSubscription(b, q, subId, actor);
}

/** Cancel in the database: the mandate stops being usable at once. Returns what the caller must revoke at the provider. */
export async function cancelMandateLocal(b: Billing, q: Query, mandateId: string | null, reason: string, actor: Actor): Promise<{ provider: string; token: string | null; providerRef: string | null } | null> {
  if (!mandateId) return null;
  const [m] = await q(`SELECT * FROM payment_mandates WHERE id = $1 FOR UPDATE`, [mandateId]);
  if (!m || m.status === 'cancelled') return null;
  await q(`UPDATE payment_mandates SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3 WHERE id = $1`, [mandateId, nowIso(b), reason]);
  await audit(q, { actor, action: 'mandate.cancelled', entityType: 'mandate', entityId: mandateId, tenantId: m.tenant_id, detail: { reason } });
  return { provider: m.provider, token: m.token_encrypted ? unseal(b, m.token_encrypted, `mandate:${m.id}`) : null, providerRef: m.provider_ref };
}

export async function cancelSubscription(b: Billing, q: Query, subId: string, o: { atPeriodEnd: boolean; reason: string }, actor: Actor) {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (o.atPeriodEnd) {
    if (!LIVE.includes(sub.status) && sub.status !== 'trial') fail(409, 'INVALID_TRANSITION', 'Only a running subscription can be cancelled at the end of its period');
    await q(`UPDATE client_subscriptions SET cancel_at_period_end = true, cancel_reason = $2, updated_at = $3 WHERE id = $1`, [subId, o.reason, nowIso(b)]);
    await audit(q, { actor, action: 'subscription.cancel_scheduled', entityType: 'subscription', entityId: subId, tenantId: sub.tenant_id, detail: { reason: o.reason, effective: sub.renewal_date } });
    return { revoke: null };
  }
  await transition(b, q, subId, 'cancelled', actor, o.reason);
  await q(`UPDATE client_subscriptions SET cancel_reason = $2 WHERE id = $1`, [subId, o.reason]);
  return { revoke: await cancelMandateLocal(b, q, sub.mandate_id, `Subscription cancelled: ${o.reason}`, actor) };
}

/** Change plan or price from the next invoice. Invoices already issued are never altered. Mid-period proration only when enabled for this subscription. */
export async function changePlan(b: Billing, q: Query, subId: string, o: { planId: string; agreedAmount?: number | null }, actor: Actor): Promise<{ prorationInvoiceId: string | null }> {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (['cancelled', 'expired'].includes(sub.status)) fail(409, 'INVALID_TRANSITION', 'A cancelled subscription cannot change plan');
  const plan = await planOf(q, o.planId), oldPlan = await planOf(q, sub.plan_id);
  const amount = o.agreedAmount ?? plan.price;
  if (!Number.isSafeInteger(amount) || amount < 0) fail(400, 'INVALID_AMOUNT', 'The agreed amount must be a whole number of pesewas');
  const freq = plan.billing_period as Frequency;
  let prorationInvoiceId: string | null = null;
  if (sub.proration_enabled && LIVE.includes(sub.status) && sub.billing_anchor && freq === sub.billing_frequency) {
    const months = FREQUENCY_MONTHS[freq], day = today(b);
    const end = nextBoundary(sub.billing_anchor, day, months);
    let start = sub.billing_anchor; // the period boundary at or before today
    for (let n = 0; ; n++) { const next = addMonths(sub.billing_anchor, (n + 1) * months); if (next > day) { start = addMonths(sub.billing_anchor, n * months); break; } }
    const gain = amount - sub.agreed_amount;
    const left = daysBetween(day, end), total = daysBetween(start, end);
    if (gain > 0 && left > 0 && total > 0) {
      const charge = mulDivRound(gain, left, total);
      if (charge > 0) ({ id: prorationInvoiceId } = await createInvoice(b, q, { tenantId: sub.tenant_id, subscriptionId: subId, lines: [{ description: `Prorated upgrade to ${plan.name}: ${left} of ${total} days (${day} to ${addDays(end, -1)})`, quantity: 1, unitPrice: charge, serviceCode: plan.category }], issue: true, actor, idempotencyKey: `sub:${subId}:proration:${day}:${amount}` }));
    }
  }
  await q(`UPDATE client_subscriptions SET plan_id = $2, agreed_amount = $3, billing_frequency = $4, updated_at = $5 WHERE id = $1`, [subId, plan.id, amount, freq, nowIso(b)]);
  await audit(q, { actor, action: 'subscription.plan_changed', entityType: 'subscription', entityId: subId, tenantId: sub.tenant_id, detail: { fromPlan: oldPlan.name, toPlan: plan.name, fromAmount: sub.agreed_amount, toAmount: amount, monthlyEquivalent: monthlyEquivalent(amount, freq), prorationInvoiceId, effective: prorationInvoiceId ? 'now (prorated)' : 'next invoice' } });
  return { prorationInvoiceId };
}

export async function setRenewalDate(b: Billing, q: Query, subId: string, date: string, actor: Actor) {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  if (date < today(b)) fail(400, 'DATE_IN_PAST', 'The next billing date cannot be in the past');
  await q(`UPDATE client_subscriptions SET renewal_date = $2, billing_anchor = $2, updated_at = $3 WHERE id = $1`, [subId, date, nowIso(b)]);
  await audit(q, { actor, action: 'subscription.renewal_date_changed', entityType: 'subscription', entityId: subId, tenantId: sub.tenant_id, detail: { from: sub.renewal_date, to: date } });
}

export async function setDiscount(b: Billing, q: Query, subId: string, bps: number, note: string, actor: Actor) {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [subId]);
  if (!sub) fail(404, 'NOT_FOUND', 'Subscription not found');
  await q(`UPDATE client_subscriptions SET discount_bps = $2, discount_note = $3, updated_at = $4 WHERE id = $1`, [subId, bps, note, nowIso(b)]);
  await audit(q, { actor, action: 'subscription.discount_changed', entityType: 'subscription', entityId: subId, tenantId: sub.tenant_id, detail: { from: sub.discount_bps, to: bps, note, appliesFrom: 'next invoice' } });
}

export async function requestCancellation(b: Billing, q: Query, tenantId: string, reason: string, actor: Actor) {
  const [sub] = await q(`SELECT * FROM client_subscriptions WHERE tenant_id = $1 FOR UPDATE`, [tenantId]);
  if (!sub || ['cancelled', 'expired', 'draft'].includes(sub.status)) fail(409, 'NO_SUBSCRIPTION', 'There is no running subscription to cancel');
  await q(`UPDATE client_subscriptions SET cancel_requested_at = $2, cancel_reason = $3, updated_at = $2 WHERE id = $1`, [sub.id, nowIso(b), reason]);
  await audit(q, { actor, action: 'subscription.cancellation_requested', entityType: 'subscription', entityId: sub.id, tenantId, detail: { reason } });
  const s = await loadSettings(q);
  await queueEmail(q, { tenantId: null, to: b.env.adminEmail ?? s.issuer.email ?? null, kind: 'cancellation_request', subject: 'Cancellation requested by a client', body: `A client has asked to cancel their subscription.\nReason: ${reason}\nReview it under Subscriptions in the admin dashboard.` });
}
