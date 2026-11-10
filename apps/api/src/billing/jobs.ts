import { randomUUID } from 'node:crypto';
import type { Query } from '../db';
import { addDays, FREQUENCY_MONTHS, nextBoundary, type Frequency } from './dates';
import { audit, billingContact, deliverQueued, loadSettings, nowIso, openException, outstanding, payUrl, queueEmail, REMINDER_STEPS, today, type Actor, type Billing, type ReminderStep } from './core';
import { createInvoice } from './invoices';
import { chargeInvoice, settleAttempt } from './payments';
import { cancelMandateLocal, periodLines, recomputeSubscription, transition } from './subscriptions';
import { cancelMandateAtProvider } from './payments';

const SYSTEM: Actor = { type: 'system' };
const money = (n: number) => `GH₵${(n / 100).toFixed(2)}`;

// ---------------------------------------------------------------- the daily billing cycle
export interface CycleResult { invoicesCreated: number; subscriptionsCancelled: number; chargesInitiated: number; chargesSkipped: Record<string, number>; errors: string[] }

/**
 * Safe to run any number of times a day, concurrently or after a crash:
 *  - a billing period is invoiced at most once (unique idempotency key per subscription and period);
 *  - an invoice has at most one in-flight payment request (partial unique index);
 *  - a charge's attempt row is committed before the provider is contacted.
 */
export async function runBillingCycle(b: Billing): Promise<CycleResult> {
  const out: CycleResult = { invoicesCreated: 0, subscriptionsCancelled: 0, chargesInitiated: 0, chargesSkipped: {}, errors: [] };
  const day = today(b);
  const s = await b.db.platform(loadSettings);

  // 1. Invoice every subscription whose next billing date is within the lead time.
  const due = await b.db.platform((q) => q(`SELECT id FROM client_subscriptions WHERE status IN ('trial','active','payment_due','payment_failed','overdue','past_due')
    AND renewal_date IS NOT NULL AND renewal_date <= ($1::date + $2::int) ORDER BY renewal_date`, [day, s.invoiceLeadDays]));
  for (const { id } of due) {
    try {
      const revoke = await b.db.platform(async (q) => {
        const [sub] = await q(`SELECT * FROM client_subscriptions WHERE id = $1 FOR UPDATE`, [id]);
        if (!sub || !sub.renewal_date || sub.renewal_date > addDays(day, s.invoiceLeadDays)) return undefined;
        if (sub.cancel_at_period_end && sub.renewal_date <= day) {
          await transition(b, q, id, 'cancelled', SYSTEM, 'Cancelled at the end of the paid period, as requested');
          out.subscriptionsCancelled++;
          return { info: await cancelMandateLocal(b, q, sub.mandate_id, 'Subscription ended', SYSTEM), tenantId: sub.tenant_id };
        }
        const [plan] = await q(`SELECT * FROM service_plans WHERE id = $1`, [sub.plan_id]);
        const next = nextBoundary(sub.billing_anchor ?? sub.renewal_date, sub.renewal_date, FREQUENCY_MONTHS[sub.billing_frequency as Frequency]);
        const r = await createInvoice(b, q, {
          tenantId: sub.tenant_id, subscriptionId: id, lines: periodLines(plan, sub, sub.renewal_date, next), dueDate: sub.renewal_date,
          periodStart: sub.renewal_date, periodEnd: addDays(next, -1), issue: true, actor: SYSTEM, idempotencyKey: `sub:${id}:${sub.renewal_date}`,
        });
        if (r.created) out.invoicesCreated++;
        await q(`UPDATE client_subscriptions SET renewal_date = $2, updated_at = $3 WHERE id = $1`, [id, next, nowIso(b)]);
        if (sub.status === 'trial') await transition(b, q, id, 'payment_due', SYSTEM, 'Trial ended');
        await recomputeSubscription(b, q, id, SYSTEM);
        return undefined;
      });
      if (revoke?.info) await cancelMandateAtProvider(b, revoke.info, revoke.tenantId);
    } catch (e) { out.errors.push(`subscription ${id}: ${(e as Error).message}`); }
  }

  // 2. Collect invoices that are due from clients who authorised automatic payment.
  const candidates = await b.db.platform((q) => q(`SELECT i.id FROM invoices i JOIN client_subscriptions s ON s.id = i.subscription_id JOIN payment_mandates m ON m.id = s.mandate_id AND m.status = 'active'
    WHERE i.status IN ('sent','partially_paid') AND i.due_date <= $1::date ORDER BY i.due_date`, [day]));
  for (const { id } of candidates) {
    try {
      const r = await chargeInvoice(b, id, { actor: SYSTEM });
      if (r.result === 'initiated') out.chargesInitiated++;
      else out.chargesSkipped[r.reason ?? 'other'] = (out.chargesSkipped[r.reason ?? 'other'] ?? 0) + 1;
    } catch (e) { out.errors.push(`invoice ${id}: ${(e as Error).message}`); }
  }

  // 3. Keep subscription statuses honest (a subscription becomes overdue only once an invoice is past due).
  const live = await b.db.platform((q) => q(`SELECT id FROM client_subscriptions WHERE status IN ('active','payment_due','payment_failed','overdue','past_due')`));
  for (const { id } of live) {
    try { await b.db.platform((q) => recomputeSubscription(b, q, id, SYSTEM)); } catch (e) { out.errors.push(`subscription ${id}: ${(e as Error).message}`); }
  }
  return out;
}

// ---------------------------------------------------------------- reminders
const STEP_TEXT: Record<ReminderStep, { subject: (n: string) => string; lead: (due: string, auto: boolean) => string }> = {
  upcoming: { subject: (n) => `Upcoming payment: invoice ${n}`, lead: (due, auto) => `This is a friendly reminder that a payment is due on ${due}.${auto ? ' It will be collected automatically from your authorised payment method.' : ''}` },
  due: { subject: (n) => `Payment due today: invoice ${n}`, lead: () => 'Your payment is due today.' },
  overdue_1: { subject: (n) => `Invoice ${n} is overdue`, lead: (due) => `Invoice payment was due on ${due} and has not been received yet.` },
  overdue_2: { subject: (n) => `Second reminder: invoice ${n} is overdue`, lead: (due) => `This is a second reminder. The payment due on ${due} is still outstanding.` },
  escalate: { subject: (n) => `Escalation: invoice ${n}`, lead: () => '' },
  review: { subject: (n) => `Manual review needed: invoice ${n}`, lead: () => '' },
};

/** Sends at most one reminder per invoice per run (the most recent step reached), and none once the balance is paid, disputed or withdrawn. */
export async function runReminders(b: Billing): Promise<{ sent: number; skipped: number }> {
  const s = await b.db.platform(loadSettings);
  if (!s.reminders.enabled) return { sent: 0, skipped: 0 };
  const day = today(b);
  const invoices = await b.db.platform((q) => q(`SELECT i.*, (SELECT 1 FROM client_subscriptions c JOIN payment_mandates m ON m.id = c.mandate_id AND m.status = 'active' WHERE c.id = i.subscription_id) AS auto_debit
    FROM invoices i WHERE i.status IN ('sent','partially_paid') AND i.due_date IS NOT NULL`));
  let sent = 0, skipped = 0;
  for (const inv of invoices) {
    const from = Math.round((Date.parse(day) - Date.parse(inv.due_date)) / 86_400_000);
    const reached = REMINDER_STEPS.filter((st) => s.reminders.offsets[st] <= from);
    if (!reached.length) continue;
    await b.db.platform(async (q) => {
      const done = new Set((await q(`SELECT step FROM collection_reminders WHERE invoice_id = $1`, [inv.id])).map((r: any) => r.step));
      const todo = reached.filter((st) => !done.has(st));
      if (!todo.length) return;
      const latest = todo.reduce((a, c) => (s.reminders.offsets[c] > s.reminders.offsets[a] ? c : a));
      for (const st of todo) if (st !== latest) { await q(`INSERT INTO collection_reminders (id, invoice_id, step, due_on, status) VALUES ($1, $2, $3, $4, 'skipped')`, [randomUUID(), inv.id, st, day]); skipped++; }
      const c = await billingContact(q, inv.tenant_id);
      const owed = outstanding(inv), t = STEP_TEXT[latest];
      let nid: string;
      if (latest === 'escalate' || latest === 'review') {
        const admin = b.env.adminEmail ?? s.issuer.email ?? null;
        nid = await queueEmail(q, { tenantId: inv.tenant_id, to: admin, invoiceId: inv.id, kind: `reminder_${latest}`, subject: t.subject(inv.number), body: `${c.business} owes ${money(owed)} on invoice ${inv.number}, ${from} day(s) past due.\n${latest === 'review' ? 'Decide on any further collection action. Nothing is suspended automatically.' : 'Please follow up with the client.'}` });
        if (latest === 'review') await openException(q, { key: `review:${inv.id}`, kind: 'collection_review', tenantId: inv.tenant_id, invoiceId: inv.id, detail: `Invoice ${inv.number} (${money(owed)}) is ${from} days overdue. Decide on further action.` });
      } else {
        nid = await queueEmail(q, { tenantId: inv.tenant_id, to: c.email, invoiceId: inv.id, kind: `reminder_${latest}`, subject: t.subject(inv.number),
          body: `Hello ${c.name},\n\n${t.lead(inv.due_date, !!inv.auto_debit)}\n\nBusiness: ${c.business}\nInvoice: ${inv.number}\nAmount outstanding: ${money(owed)}\nDue date: ${inv.due_date}\n\nPay securely: ${payUrl(b, inv.id)}\n\nQuestions? Contact ${s.issuer.email || 'Mansora billing support'}.\n\n${s.issuer.name}` });
      }
      await q(`INSERT INTO collection_reminders (id, invoice_id, step, due_on, status, notification_id) VALUES ($1, $2, $3, $4, 'sent', $5)`, [randomUUID(), inv.id, latest, day, nid]);
      await audit(q, { actor: SYSTEM, action: 'reminder.sent', entityType: 'invoice', entityId: inv.id, tenantId: inv.tenant_id, detail: { step: latest, daysFromDue: from } });
      sent++;
    });
  }
  return { sent, skipped };
}

/** An administrator sends a reminder now, regardless of the schedule. */
export async function sendReminderNow(b: Billing, q: Query, invoiceId: string, actor: Actor): Promise<void> {
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  if (!inv || !['sent', 'partially_paid'].includes(inv.status)) throw Object.assign(new Error('Only an invoice that is owed can be chased'), { statusCode: 409 });
  const s = await loadSettings(q), c = await billingContact(q, inv.tenant_id);
  await queueEmail(q, { tenantId: inv.tenant_id, to: c.email, invoiceId, kind: 'reminder_manual', subject: `Reminder: invoice ${inv.number}`,
    body: `Hello ${c.name},\n\nInvoice ${inv.number} has ${money(outstanding(inv))} outstanding (due ${inv.due_date}).\n\nPay securely: ${payUrl(b, invoiceId)}\n\n${s.issuer.name}` });
  await audit(q, { actor, action: 'reminder.sent_manually', entityType: 'invoice', entityId: invoiceId, tenantId: inv.tenant_id });
}

// ---------------------------------------------------------------- reconciliation
/**
 * Compares Mansora's records with the providers' and with themselves, and puts every disagreement in the exception queue.
 * It also settles attempts that were left waiting (a lost webhook, a crash), always by asking the provider.
 */
export async function runReconciliation(b: Billing): Promise<{ settled: number; exceptions: number }> {
  let settled = 0;
  const before = (await b.db.platform((q) => q(`SELECT COUNT(*)::bigint AS n FROM billing_exceptions`)))[0].n;
  const stuck = await b.db.platform((q) => q(`SELECT id FROM payment_attempts WHERE status IN ('initiated','awaiting_customer','pending') AND updated_at < $1::timestamptz - interval '10 minutes'`, [nowIso(b)]));
  for (const { id } of stuck) { const r = await settleAttempt(b, id, SYSTEM).catch(() => null); if (r && ['successful', 'failed', 'cancelled'].includes(r.status)) settled++; }
  await b.db.platform(async (q) => {
    for (const r of await q(`SELECT i.id, i.number, i.tenant_id, i.amount_paid, COALESCE(SUM(a.amount), 0)::bigint AS allocated FROM invoices i LEFT JOIN payment_allocations a ON a.invoice_id = i.id GROUP BY i.id HAVING i.amount_paid <> COALESCE(SUM(a.amount), 0)`)) {
      await openException(q, { key: `balance:${r.id}`, kind: 'balance_mismatch', tenantId: r.tenant_id, invoiceId: r.id, detail: `Invoice ${r.number}: recorded as paid ${r.amount_paid} but payments allocated to it total ${r.allocated}.` });
    }
    for (const r of await q(`SELECT p.id, p.receipt_number, p.tenant_id, p.amount, COALESCE(SUM(a.amount), 0)::bigint AS allocated FROM billing_payments p LEFT JOIN payment_allocations a ON a.payment_id = p.id GROUP BY p.id HAVING p.amount > COALESCE(SUM(a.amount), 0)`)) {
      await openException(q, { key: `unallocated:${r.id}`, kind: 'unallocated_payment', tenantId: r.tenant_id, paymentId: r.id, detail: `Payment ${r.receipt_number}: ${r.amount - r.allocated} of ${r.amount} is not applied to an invoice.` });
    }
    for (const r of await q(`SELECT s.id, s.reference, s.net, COALESCE(SUM(p.amount - p.fee), 0)::bigint AS payments_net FROM settlements s LEFT JOIN billing_payments p ON p.settlement_id = s.id GROUP BY s.id HAVING s.net <> COALESCE(SUM(p.amount - p.fee), 0)`)) {
      await openException(q, { key: `settlement:${r.id}`, kind: 'settlement_mismatch', detail: `Settlement ${r.reference}: the provider paid out ${r.net} but the payments linked to it add up to ${r.payments_net} after fees.` });
    }
  });
  const after = (await b.db.platform((q) => q(`SELECT COUNT(*)::bigint AS n FROM billing_exceptions`)))[0].n;
  return { settled, exceptions: after - before };
}

export async function runDaily(b: Billing) {
  const cycle = await runBillingCycle(b);
  const reminders = await runReminders(b);
  const reconciliation = await runReconciliation(b);
  const email = await deliverQueued(b);
  return { cycle, reminders, reconciliation, email };
}
