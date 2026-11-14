import { randomUUID } from 'node:crypto';
import { mulDivRound } from '@mansora/domain';
import type { Query } from '../db';
import { addDays } from './dates';
import { audit, billingContact, fail, loadSettings, nextNumber, nowIso, outstanding, payUrl, queueEmail, today, displayStatus, type Actor, type Billing } from './core';

export interface LineInput { description: string; quantity: number; unitPrice: number; discount?: number; serviceCode?: string }
const money = (n: number) => `GH₵${(n / 100).toFixed(2)}`;

/** Exact integer pricing. Totals can never disagree with their lines. */
export function priceInvoice(lines: LineInput[], extraDiscount = 0, taxBps = 0) {
  if (!lines.length) fail(400, 'EMPTY_INVOICE', 'An invoice needs at least one line');
  let subtotal = 0, lineDiscounts = 0, net = 0;
  const priced = lines.map((l, i) => {
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) fail(400, 'INVALID_QUANTITY', `Line ${i + 1}: quantity must be a whole number above zero`);
    if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0) fail(400, 'INVALID_AMOUNT', `Line ${i + 1}: price must be a whole number of pesewas`);
    const gross = l.quantity * l.unitPrice, discount = l.discount ?? 0;
    if (!Number.isSafeInteger(discount) || discount < 0 || discount > gross) fail(400, 'INVALID_DISCOUNT', `Line ${i + 1}: discount cannot exceed the line amount`);
    subtotal += gross; lineDiscounts += discount; net += gross - discount;
    return { ...l, discount, lineTotal: gross - discount, serviceCode: l.serviceCode ?? 'other' };
  });
  if (!Number.isSafeInteger(extraDiscount) || extraDiscount < 0 || extraDiscount > net) fail(400, 'INVALID_DISCOUNT', 'The invoice discount cannot exceed the invoice amount');
  const taxable = net - extraDiscount;
  const tax = mulDivRound(taxable, taxBps, 10_000);
  return { priced, subtotal, discountTotal: lineDiscounts + extraDiscount, taxTotal: tax, total: taxable + tax };
}

export interface NewInvoice {
  tenantId: string; subscriptionId?: string | null; lines: LineInput[]; extraDiscount?: number; taxBps?: number; dueDate?: string | null; notes?: string | null;
  periodStart?: string | null; periodEnd?: string | null; idempotencyKey?: string | null; isInitial?: boolean; issue?: boolean; actor: Actor;
}

export async function createInvoice(b: Billing, q: Query, i: NewInvoice): Promise<{ id: string; created: boolean }> {
  const [tenant] = await q(`SELECT id, status FROM tenants WHERE id = $1`, [i.tenantId]);
  if (!tenant) fail(404, 'NOT_FOUND', 'Client not found');
  if (tenant.status === 'closed') fail(409, 'CLIENT_CLOSED', 'This client account is closed');
  const p = priceInvoice(i.lines, i.extraDiscount ?? 0, i.taxBps ?? 0);
  const id = randomUUID();
  const rows = await q(
    `INSERT INTO invoices (id, tenant_id, subscription_id, status, is_initial, due_date, period_start, period_end, subtotal, discount_total, tax_bps, tax_total, total, notes, idempotency_key, created_by, created_at)
     VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [id, i.tenantId, i.subscriptionId ?? null, i.isInitial ?? false, i.dueDate ?? null, i.periodStart ?? null, i.periodEnd ?? null, p.subtotal, p.discountTotal, i.taxBps ?? 0, p.taxTotal, p.total, i.notes ?? null, i.idempotencyKey ?? null, i.actor.type === 'admin' ? i.actor.id : null, nowIso(b)],
  );
  if (!rows.length) { // the same billing period was already invoiced: return that invoice, create nothing
    const [existing] = await q(`SELECT id FROM invoices WHERE idempotency_key = $1`, [i.idempotencyKey]);
    return { id: existing.id, created: false };
  }
  let pos = 0;
  for (const l of p.priced) {
    await q(`INSERT INTO invoice_line_items (id, invoice_id, position, description, service_code, quantity, unit_price, discount, line_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), id, pos++, l.description, l.serviceCode, l.quantity, l.unitPrice, l.discount, l.lineTotal]);
  }
  await audit(q, { actor: i.actor, action: 'invoice.created', entityType: 'invoice', entityId: id, tenantId: i.tenantId, detail: { total: p.total, lines: i.lines.length, idempotencyKey: i.idempotencyKey ?? null } });
  if (i.issue) await issueInvoice(b, q, id, i.actor);
  return { id, created: true };
}

export async function issueInvoice(b: Billing, q: Query, id: string, actor: Actor): Promise<void> {
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
  if (!inv) fail(404, 'NOT_FOUND', 'Invoice not found');
  if (inv.status !== 'draft') fail(409, 'NOT_DRAFT', 'Only a draft invoice can be issued');
  if (inv.total <= 0) fail(409, 'ZERO_INVOICE', 'An invoice with nothing to pay cannot be issued');
  const s = await loadSettings(q);
  const issueDate = today(b);
  const due = inv.due_date ?? addDays(issueDate, s.defaultDueDays);
  const number = await nextNumber(q, 'invoice', 'INV', Number(issueDate.slice(0, 4)));
  await q(`UPDATE invoices SET status = 'sent', number = $2, issue_date = $3, due_date = $4, sent_at = $5 WHERE id = $1`, [id, number, issueDate, due, nowIso(b)]);
  await audit(q, { actor, action: 'invoice.issued', entityType: 'invoice', entityId: id, tenantId: inv.tenant_id, detail: { number, dueDate: due, total: inv.total } });
  const c = await billingContact(q, inv.tenant_id);
  await queueEmail(q, {
    tenantId: inv.tenant_id, to: c.email, invoiceId: id, kind: 'invoice_issued', subject: `Invoice ${number} from ${s.issuer.name}`,
    body: [
      `Hello ${c.name},`,
      `Your Mansora invoice is ready. You can pay it online by card or Mobile Money.`,
      [`Invoice: ${number}`, `Business: ${c.business}`, ...(inv.period_start && inv.period_end ? [`Period: ${String(inv.period_start).slice(0, 10)} to ${String(inv.period_end).slice(0, 10)}`] : []), `Amount due: ${money(inv.total)}`, `Due date: ${due}`].join('\n'),
      `Pay securely here: ${payUrl(b, id)}`,
      s.issuer.paymentInstructions,
      `Thank you,\n${s.issuer.name}`,
    ].filter(Boolean).join('\n\n'),
  });
}

/** Recompute an invoice's status from its money fields. Draft, cancelled, written-off and disputed invoices keep their status. */
export async function refreshInvoice(b: Billing, q: Query, id: string): Promise<any> {
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
  if (!inv) fail(404, 'NOT_FOUND', 'Invoice not found');
  if (['draft', 'cancelled', 'written_off', 'disputed'].includes(inv.status)) return inv;
  const out = outstanding(inv);
  const status = out <= 0 ? 'paid' : inv.amount_paid - inv.amount_refunded > 0 ? 'partially_paid' : 'sent';
  if (status !== inv.status) await q(`UPDATE invoices SET status = $2, paid_at = $3 WHERE id = $1`, [id, status, status === 'paid' ? nowIso(b) : null]);
  return { ...inv, status };
}

export async function getInvoice(b: Billing, q: Query, id: string): Promise<any> {
  const [inv] = await q(`SELECT i.*, t.name AS tenant_name, s.status AS subscription_status FROM invoices i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN client_subscriptions s ON s.id = i.subscription_id WHERE i.id = $1`, [id]);
  if (!inv) fail(404, 'NOT_FOUND', 'Invoice not found');
  const day = today(b);
  const [lines, payments, attempts, reminders, credits, disputes, history] = await Promise.all([
    q(`SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY position`, [id]),
    q(`SELECT p.id, p.receipt_number, p.method, p.provider, p.sandbox, p.received_at, p.status, p.reference, a.amount AS allocated, p.amount, p.amount_refunded FROM payment_allocations a JOIN billing_payments p ON p.id = a.payment_id WHERE a.invoice_id = $1 ORDER BY p.received_at`, [id]),
    q(`SELECT id, kind, provider, status, amount, attempt_no, failure_reason, created_at, completed_at, sandbox FROM payment_attempts WHERE invoice_id = $1 ORDER BY created_at`, [id]),
    q(`SELECT step, status, due_on, created_at FROM collection_reminders WHERE invoice_id = $1 ORDER BY created_at`, [id]),
    q(`SELECT * FROM credit_notes WHERE invoice_id = $1 ORDER BY created_at`, [id]),
    q(`SELECT * FROM disputes WHERE invoice_id = $1 ORDER BY opened_at`, [id]),
    q(`SELECT actor_type, action, detail, occurred_at FROM billing_audit_logs WHERE entity_type = 'invoice' AND entity_id = $1 ORDER BY occurred_at`, [id]),
  ]);
  return { ...inv, outstanding: outstanding(inv), display_status: displayStatus(inv, day), days_overdue: inv.due_date && outstanding(inv) > 0 && inv.due_date < day ? Math.round((Date.parse(day) - Date.parse(inv.due_date)) / 86_400_000) : 0, lines, payments, attempts, reminders, credit_notes: credits, disputes, history, pay_url: ['sent', 'partially_paid', 'disputed'].includes(inv.status) ? payUrl(b, id) : null };
}

async function lockForChange(q: Query, id: string): Promise<any> {
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
  if (!inv) fail(404, 'NOT_FOUND', 'Invoice not found');
  return inv;
}

export async function cancelInvoice(b: Billing, q: Query, id: string, reason: string, actor: Actor): Promise<void> {
  const inv = await lockForChange(q, id);
  if (!['draft', 'sent'].includes(inv.status) || inv.amount_paid > 0) fail(409, 'CANNOT_CANCEL', 'Only an unpaid invoice can be cancelled. Use a credit note for one that has payments.');
  const [live] = await q(`SELECT 1 FROM payment_attempts WHERE invoice_id = $1 AND status IN ('initiated','awaiting_customer','pending')`, [id]);
  if (live) fail(409, 'PAYMENT_IN_PROGRESS', 'A payment is in progress for this invoice. Wait for it to finish or fail first.');
  await q(`UPDATE invoices SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`, [id, nowIso(b)]);
  await audit(q, { actor, action: 'invoice.cancelled', entityType: 'invoice', entityId: id, tenantId: inv.tenant_id, detail: { reason } });
}

export async function writeOffInvoice(b: Billing, q: Query, id: string, reason: string, actor: Actor): Promise<void> {
  const inv = await lockForChange(q, id);
  if (!['sent', 'partially_paid', 'disputed'].includes(inv.status)) fail(409, 'CANNOT_WRITE_OFF', 'Only an invoice that is owed can be written off');
  const out = outstanding(inv);
  if (out <= 0) fail(409, 'NOTHING_OWED', 'Nothing is owed on this invoice');
  await q(`UPDATE invoices SET status = 'written_off', amount_written_off = amount_written_off + $2 WHERE id = $1`, [id, out]);
  await q(`UPDATE disputes SET status = 'resolved', resolution = 'Invoice written off', resolved_at = $2 WHERE invoice_id = $1 AND status = 'open'`, [id, nowIso(b)]);
  await audit(q, { actor, action: 'invoice.written_off', entityType: 'invoice', entityId: id, tenantId: inv.tenant_id, detail: { amount: out, reason } });
}

/** A credit note reduces what is owed. It never edits the issued invoice's lines or total. */
export async function creditNote(b: Billing, q: Query, id: string, amount: number, reason: string, actor: Actor): Promise<string> {
  const inv = await lockForChange(q, id);
  if (!['sent', 'partially_paid', 'disputed', 'paid'].includes(inv.status)) fail(409, 'CANNOT_CREDIT', 'This invoice cannot be credited');
  if (!Number.isSafeInteger(amount) || amount <= 0) fail(400, 'INVALID_AMOUNT', 'Enter a credit amount');
  if (amount > Math.max(0, outstanding(inv))) fail(409, 'CREDIT_EXCEEDS_BALANCE', 'A credit note cannot be more than the amount still owed. If money was paid, refund it first.');
  const number = await nextNumber(q, 'credit_note', 'CN', Number(today(b).slice(0, 4)));
  await q(`INSERT INTO credit_notes (id, invoice_id, number, amount, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), id, number, amount, reason, actor.type === 'admin' ? actor.id : null]);
  await q(`UPDATE invoices SET amount_credited = amount_credited + $2 WHERE id = $1`, [id, amount]);
  await refreshInvoice(b, q, id);
  await audit(q, { actor, action: 'invoice.credit_note', entityType: 'invoice', entityId: id, tenantId: inv.tenant_id, detail: { number, amount, reason } });
  return number;
}

export async function openDispute(b: Billing, q: Query, id: string, reason: string, opener: string, actor: Actor, paymentId?: string | null): Promise<void> {
  const inv = await lockForChange(q, id);
  if (!['sent', 'partially_paid', 'paid'].includes(inv.status)) fail(409, 'CANNOT_DISPUTE', 'This invoice cannot be disputed in its current state');
  const [open] = await q(`SELECT 1 FROM disputes WHERE invoice_id = $1 AND status = 'open'`, [id]);
  if (open) fail(409, 'ALREADY_DISPUTED', 'This invoice already has an open dispute');
  await q(`INSERT INTO disputes (id, tenant_id, invoice_id, payment_id, reason, opened_by, opened_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), inv.tenant_id, id, paymentId ?? null, reason, opener, nowIso(b)]);
  await q(`UPDATE invoices SET status = 'disputed', status_before_dispute = $2 WHERE id = $1`, [id, inv.status]);
  await audit(q, { actor, action: 'invoice.dispute_opened', entityType: 'invoice', entityId: id, tenantId: inv.tenant_id, detail: { reason, opener } });
}

export async function resolveDispute(b: Billing, q: Query, id: string, resolution: string, actor: Actor): Promise<void> {
  const inv = await lockForChange(q, id);
  if (inv.status !== 'disputed') fail(409, 'NOT_DISPUTED', 'This invoice has no open dispute');
  await q(`UPDATE disputes SET status = 'resolved', resolution = $2, resolved_at = $3 WHERE invoice_id = $1 AND status = 'open'`, [id, resolution, nowIso(b)]);
  await q(`UPDATE invoices SET status = COALESCE(status_before_dispute, 'sent'), status_before_dispute = NULL WHERE id = $1`, [id]);
  await refreshInvoice(b, q, id);
  await audit(q, { actor, action: 'invoice.dispute_resolved', entityType: 'invoice', entityId: id, tenantId: inv.tenant_id, detail: { resolution } });
}
