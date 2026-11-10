import { allocate } from '@mansora/domain';
import type { Query } from '../db';
import { addDays, addMonths, FREQUENCY_MONTHS, monthlyEquivalent, type Frequency } from './dates';
import { OUTSTANDING_SQL, RECEIVABLE_STATUSES, today, type Billing } from './core';
import { netAmount } from './subscriptions';

const LIVE = ['active', 'payment_due', 'payment_failed', 'overdue', 'past_due'];
const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n * 10_000) / d)); // basis points

/**
 * Definitions (shown on screen and in the runbook):
 *  Cash collected  = payments actually received (provider-confirmed or recorded by hand), sandbox payments excluded.
 *  Invoiced        = invoices issued, whether or not they have been paid. Never mixed with cash.
 *  Net collected   = cash collected - refunds. Net settled = net collected - provider fees.
 *  MRR             = monthly equivalent of running subscriptions' agreed amounts after approved discounts.
 */
export async function revenueSummary(b: Billing, q: Query, from: string, to: string) {
  const day = today(b), monthStart = `${day.slice(0, 7)}-01`, nextMonth = addMonths(monthStart, 1);
  const end = addDays(to, 1);
  const subs = await q(`SELECT status, agreed_amount, discount_bps, billing_frequency, renewal_date FROM client_subscriptions`);
  const running = subs.filter((s: any) => LIVE.includes(s.status));
  const mrr = running.reduce((t: number, s: any) => t + monthlyEquivalent(netAmount(s), s.billing_frequency as Frequency), 0);
  const cash = async (a: string, z: string) => {
    const [p] = await q(`SELECT COALESCE(SUM(amount), 0)::bigint AS gross, COALESCE(SUM(fee), 0)::bigint AS fees, COUNT(*)::bigint AS n FROM billing_payments WHERE sandbox = false AND received_at >= $1::date AND received_at < $2::date`, [a, z]);
    const [r] = await q(`SELECT COALESCE(SUM(r.amount), 0)::bigint AS refunds FROM billing_refunds r JOIN billing_payments p ON p.id = r.payment_id WHERE p.sandbox = false AND r.status = 'completed' AND r.created_at >= $1::date AND r.created_at < $2::date`, [a, z]);
    return { gross: p.gross, refunds: r.refunds, fees: p.fees, net: p.gross - r.refunds, netSettled: p.gross - r.refunds - p.fees, payments: p.n };
  };
  const [exp] = await q(`SELECT COALESCE(SUM(i.total - i.amount_credited - i.amount_written_off), 0)::bigint AS expected, COALESCE(SUM(i.amount_paid - i.amount_refunded), 0)::bigint AS collected, COALESCE(SUM(${OUTSTANDING_SQL}), 0)::bigint AS to_collect
    FROM invoices i WHERE i.status IN ('sent','partially_paid','paid','disputed') AND i.due_date >= $1::date AND i.due_date < $2::date`, [monthStart, nextMonth]);
  const [rec] = await q(`SELECT COALESCE(SUM(${OUTSTANDING_SQL}), 0)::bigint AS total, COALESCE(SUM(CASE WHEN i.due_date < $1::date THEN ${OUTSTANDING_SQL} ELSE 0 END), 0)::bigint AS overdue, COUNT(*)::bigint AS n
    FROM invoices i WHERE i.status IN ${RECEIVABLE_STATUSES}`, [day]);
  const [att] = await q(`SELECT COUNT(*) FILTER (WHERE status = 'successful')::bigint AS ok, COUNT(*) FILTER (WHERE status = 'failed')::bigint AS bad FROM payment_attempts
    WHERE sandbox = false AND status IN ('successful','failed') AND completed_at >= $1::date AND completed_at < $2::date`, [from, end]);
  const [inv] = await q(`SELECT COALESCE(SUM(total - amount_credited - amount_written_off), 0)::bigint AS invoiced, COUNT(*)::bigint AS n FROM invoices WHERE status NOT IN ('draft','cancelled') AND issue_date >= $1::date AND issue_date < $2::date`, [from, end]);
  const months: { month: string; invoiced: number; collected: number }[] = [];
  for (let k = 11; k >= 0; k--) {
    const m = addMonths(monthStart, -k), n = addMonths(m, 1);
    const [i] = await q(`SELECT COALESCE(SUM(total - amount_credited - amount_written_off), 0)::bigint AS v FROM invoices WHERE status NOT IN ('draft','cancelled') AND issue_date >= $1::date AND issue_date < $2::date`, [m, n]);
    months.push({ month: m.slice(0, 7), invoiced: i.v, collected: (await cash(m, n)).net });
  }
  const byClient = await q(`SELECT t.id, t.name, COALESCE(SUM(p.amount), 0)::bigint AS gross, COALESCE(SUM(p.amount_refunded), 0)::bigint AS refunded FROM billing_payments p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.sandbox = false AND p.received_at >= $1::date AND p.received_at < $2::date GROUP BY t.id, t.name ORDER BY 3 DESC`, [from, end]);
  // Revenue by service: each payment is split across the services on the invoices it paid, in proportion to their lines.
  const allocs = await q(`SELECT a.invoice_id, (a.amount - a.refunded) AS net FROM payment_allocations a JOIN billing_payments p ON p.id = a.payment_id WHERE p.sandbox = false AND p.received_at >= $1::date AND p.received_at < $2::date`, [from, end]);
  const perInvoice = new Map<string, number>();
  for (const a of allocs) perInvoice.set(a.invoice_id, (perInvoice.get(a.invoice_id) ?? 0) + a.net);
  const collectedByService: Record<string, number> = {};
  if (perInvoice.size) {
    const lines = await q(`SELECT invoice_id, service_code, line_total FROM invoice_line_items WHERE invoice_id = ANY($1) ORDER BY invoice_id, position`, [[...perInvoice.keys()]]);
    for (const [invoiceId, net] of perInvoice) {
      const ls = lines.filter((l: any) => l.invoice_id === invoiceId);
      if (!ls.length || net <= 0) continue;
      const parts = allocate(net, ls.map((l: any) => l.line_total));
      ls.forEach((l: any, i: number) => { collectedByService[l.service_code] = (collectedByService[l.service_code] ?? 0) + parts[i]; });
    }
  }
  const invoicedByService = await q(`SELECT l.service_code, COALESCE(SUM(l.line_total), 0)::bigint AS total FROM invoice_line_items l JOIN invoices i ON i.id = l.invoice_id WHERE i.status NOT IN ('draft','cancelled') AND i.issue_date >= $1::date AND i.issue_date < $2::date GROUP BY 1 ORDER BY 2 DESC`, [from, end]);
  const open = await q(`SELECT i.due_date, ${OUTSTANDING_SQL} AS owed FROM invoices i WHERE i.status IN ${RECEIVABLE_STATUSES} AND ${OUTSTANDING_SQL} > 0`);
  const ageing = { notYetDue: 0, d1_7: 0, d8_14: 0, d15_30: 0, d31plus: 0 };
  for (const r of open) {
    const over = Math.round((Date.parse(day) - Date.parse(r.due_date)) / 86_400_000);
    if (over <= 0) ageing.notYetDue += r.owed; else if (over <= 7) ageing.d1_7 += r.owed; else if (over <= 14) ageing.d8_14 += r.owed; else if (over <= 30) ageing.d15_30 += r.owed; else ageing.d31plus += r.owed;
  }
  const [set] = await q(`SELECT COALESCE(SUM(net), 0)::bigint AS net, COUNT(*)::bigint AS n FROM settlements WHERE settled_on >= $1::date AND settled_on < $2::date`, [from, end]);
  const [excs] = await q(`SELECT COUNT(*)::bigint AS n FROM billing_exceptions WHERE status = 'open'`);
  const [refunds] = await q(`SELECT COALESCE(SUM(r.amount), 0)::bigint AS total, COUNT(*)::bigint AS n FROM billing_refunds r JOIN billing_payments p ON p.id = r.payment_id WHERE p.sandbox = false AND r.status = 'completed' AND r.created_at >= $1::date AND r.created_at < $2::date`, [from, end]);
  const [sbx] = await q(`SELECT COUNT(*)::bigint AS n FROM billing_payments WHERE sandbox = true`);
  const renewals = running.filter((s: any) => s.renewal_date && s.renewal_date >= day && s.renewal_date <= addDays(day, 30)).length;
  return {
    asOf: day, range: { from, to },
    mrr, arr: mrr * 12,
    thisMonth: { collected: await cash(monthStart, nextMonth), expected: exp.expected, alreadyCollected: exp.collected, stillToCollect: exp.to_collect },
    period: { cash: await cash(from, end), invoiced: inv.invoiced, invoices: inv.n, refunds: refunds.total, refundCount: refunds.n, settledByProvider: set.net, settlements: set.n },
    receivables: { outstanding: rec.total, overdue: rec.overdue, invoices: rec.n, ageing },
    attempts: { successful: att.ok, failed: att.bad, successRateBps: rate(att.ok, att.ok + att.bad), failureRateBps: rate(att.bad, att.ok + att.bad) },
    subscriptions: { active: running.length, cancelled: subs.filter((s: any) => s.status === 'cancelled').length, upcomingRenewals: renewals, total: subs.length },
    months, byClient, collectedByService, invoicedByService,
    openExceptions: excs.n, sandboxPaymentsExcluded: sbx.n,
  };
}

export type CollectionFilter = 'all' | 'active' | 'pending_mandate' | 'upcoming' | 'paid' | 'overdue' | 'failed' | 'cancelled' | 'disputed';
export async function collectionsTable(b: Billing, q: Query, filter: CollectionFilter) {
  const day = today(b);
  const rows = await q(`SELECT t.id AS tenant_id, t.name AS client, s.id AS subscription_id, s.status AS subscription_status, s.agreed_amount, s.discount_bps, s.billing_frequency, s.renewal_date,
      s.payment_method, s.cancel_requested_at, p.name AS plan, m.status AS mandate_status, m.masked AS mandate_masked,
      (SELECT MAX(x.received_at) FROM billing_payments x WHERE x.tenant_id = t.id AND x.sandbox = false) AS last_payment,
      COALESCE((SELECT SUM(${OUTSTANDING_SQL}) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ${RECEIVABLE_STATUSES}), 0)::bigint AS outstanding,
      (SELECT MIN(i.due_date) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ('sent','partially_paid','disputed') AND i.due_date < $1::date) AS oldest_overdue,
      (SELECT MIN(i.due_date) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ('sent','partially_paid')) AS next_due,
      (SELECT a.status FROM payment_attempts a WHERE a.tenant_id = t.id ORDER BY a.created_at DESC LIMIT 1) AS last_attempt,
      EXISTS (SELECT 1 FROM disputes d WHERE d.tenant_id = t.id AND d.status = 'open') AS disputed,
      (SELECT i.id FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ${RECEIVABLE_STATUSES} ORDER BY i.due_date LIMIT 1) AS oldest_invoice_id
    FROM tenants t LEFT JOIN client_subscriptions s ON s.tenant_id = t.id LEFT JOIN service_plans p ON p.id = s.plan_id LEFT JOIN payment_mandates m ON m.id = s.mandate_id
    WHERE s.id IS NOT NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = t.id AND i.status <> 'draft') ORDER BY t.name`, [day]);
  const out = rows.map((r: any) => {
    const daysOverdue = r.oldest_overdue ? Math.round((Date.parse(day) - Date.parse(r.oldest_overdue)) / 86_400_000) : 0;
    const live = LIVE.includes(r.subscription_status);
    const nextPayment = r.next_due ?? r.renewal_date;
    const tags: string[] = [];
    if (live) tags.push('active');
    if (r.subscription_status && !['cancelled', 'expired', 'draft', 'paused'].includes(r.subscription_status) && r.payment_method !== 'manual' && r.mandate_status !== 'active') tags.push('pending_mandate');
    if (live && nextPayment && nextPayment >= day && nextPayment <= addDays(day, 7)) tags.push('upcoming');
    if (live && r.outstanding === 0) tags.push('paid');
    if (daysOverdue > 0) tags.push('overdue');
    if (r.last_attempt === 'failed' && r.outstanding > 0) tags.push('failed');
    if (r.subscription_status === 'cancelled') tags.push('cancelled');
    if (r.disputed) tags.push('disputed');
    const fee = r.agreed_amount == null ? null : netAmount(r);
    return { ...r, monthly_fee: fee == null ? null : monthlyEquivalent(fee, r.billing_frequency as Frequency), period_fee: fee, next_payment: nextPayment, days_overdue: daysOverdue, tags };
  });
  return filter === 'all' ? out : out.filter((r: any) => r.tags.includes(filter));
}

/** Spreadsheet-safe CSV: values that start with = + - @ are neutralised so they cannot run as formulas. */
export function toCsv(rows: unknown[][]): string {
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
export const cedis = (n: number | null | undefined) => (n == null ? '' : (n / 100).toFixed(2));
