import { randomBytes, randomUUID } from 'node:crypto';
import { allocate } from '@mansora/domain';
import type { Query } from '../db';
import { asHttp, audit, billingContact, fail, loadSettings, nextNumber, nowIso, openException, outstanding, payUrl, queueEmail, seal, today, unseal, type Actor, type Billing } from './core';
import { openDispute, refreshInvoice } from './invoices';
import { ProviderError, SignatureError, type VerifyResult } from './providers/types';
import { cancelMandateLocal, maybeActivate, netAmount, onInvoicePaid, recomputeSubscription } from './subscriptions';

const money = (n: number) => `GH₵${(n / 100).toFixed(2)}`;
const IN_FLIGHT = ['initiated', 'awaiting_customer', 'pending'];
const PAYABLE = ['sent', 'partially_paid', 'disputed'];

// ---------------------------------------------------------------- recording money
export interface PaymentInput {
  tenantId: string; amount: number; method: 'momo' | 'card' | 'bank' | 'cash' | 'other'; provider?: string | null; attemptId?: string | null;
  providerTxnId?: string | null; reference?: string | null; fee?: number; sandbox?: boolean; receivedAt: string; recordedBy?: string | null; notes?: string | null;
  allocations: { invoiceId: string; amount: number }[];
  /** Provider payments are capped at what is owed and any excess is flagged; manual payments above the balance are refused. */
  capToOutstanding?: boolean; actor: Actor;
}

/** The one place money is recorded. Payment, allocations, invoice balances, subscription state and receipt commit together. */
export async function applyPayment(b: Billing, q: Query, p: PaymentInput): Promise<{ paymentId: string; receiptNumber: string; allocated: number; unallocated: number }> {
  if (!Number.isSafeInteger(p.amount) || p.amount <= 0) fail(400, 'INVALID_AMOUNT', 'Enter an amount above zero');
  if (new Set(p.allocations.map((a) => a.invoiceId)).size !== p.allocations.length) fail(400, 'DUPLICATE_ALLOCATION', 'Each invoice can appear only once in a payment');
  let remaining = p.amount;
  const applied: { inv: any; amt: number }[] = [];
  for (const a of p.allocations) {
    if (!Number.isSafeInteger(a.amount) || a.amount <= 0) fail(400, 'INVALID_AMOUNT', 'Allocation amounts must be above zero');
    const [inv] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [a.invoiceId]);
    if (!inv || inv.tenant_id !== p.tenantId) fail(404, 'NOT_FOUND', 'Invoice not found');
    if (!PAYABLE.includes(inv.status)) fail(409, 'NOT_PAYABLE', `Invoice ${inv.number ?? ''} is ${inv.status.replace(/_/g, ' ')} and cannot receive a payment`);
    const out = outstanding(inv);
    let amt = Math.min(a.amount, remaining);
    if (amt > out) {
      if (!p.capToOutstanding) fail(409, 'EXCEEDS_BALANCE', `Invoice ${inv.number} only has ${money(out)} outstanding`);
      amt = Math.max(0, out);
    }
    if (amt > 0) { applied.push({ inv, amt }); remaining -= amt; }
  }
  if (!applied.length && !p.capToOutstanding) fail(409, 'NOTHING_TO_ALLOCATE', 'Choose an invoice that is still owed');
  const paymentId = randomUUID();
  const receipt = await nextNumber(q, 'receipt', 'RCT', Number(p.receivedAt.slice(0, 4)));
  await q(`INSERT INTO billing_payments (id, tenant_id, method, provider, attempt_id, provider_txn_id, reference, amount, fee, sandbox, received_at, receipt_number, recorded_by, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [paymentId, p.tenantId, p.method, p.provider ?? null, p.attemptId ?? null, p.providerTxnId ?? null, p.reference ?? null, p.amount, p.fee ?? 0, p.sandbox ?? false, p.receivedAt, receipt, p.recordedBy ?? null, p.notes ?? null]);
  for (const { inv, amt } of applied) {
    await q(`INSERT INTO payment_allocations (id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)`, [randomUUID(), paymentId, inv.id, amt]);
    await q(`UPDATE invoices SET amount_paid = amount_paid + $2 WHERE id = $1`, [inv.id, amt]);
    await refreshInvoice(b, q, inv.id);
  }
  for (const { inv } of applied) if (inv.subscription_id) await onInvoicePaid(b, q, inv.subscription_id, p.actor);
  const allocated = p.amount - remaining;
  await audit(q, { actor: p.actor, action: 'payment.recorded', entityType: 'payment', entityId: paymentId, tenantId: p.tenantId, detail: { receipt, amount: p.amount, method: p.method, provider: p.provider ?? 'manual', sandbox: p.sandbox ?? false, allocations: applied.map((a) => ({ invoice: a.inv.number, amount: a.amt })) } });
  if (remaining > 0) await openException(q, { key: `unallocated:${paymentId}`, kind: 'unallocated_payment', tenantId: p.tenantId, paymentId, detail: `${money(remaining)} of payment ${receipt} was not applied to any invoice (nothing owed, or the invoice was already settled).` });
  const c = await billingContact(q, p.tenantId);
  await queueEmail(q, { tenantId: p.tenantId, to: c.email, kind: 'receipt', subject: `Receipt ${receipt}`, body: `Hello ${c.name},\n\nWe received ${money(p.amount)}${p.sandbox ? ' (SANDBOX TEST)' : ''}. Receipt ${receipt}.\n\nThank you.` });
  return { paymentId, receiptNumber: receipt, allocated, unallocated: remaining };
}

// ---------------------------------------------------------------- refunds
/** Money back to a client. Provider refunds complete when the provider confirms; manual ones are recorded as completed. */
export async function refundPayment(b: Billing, paymentId: string, o: { amount: number; reason: string; viaProvider: boolean; actor: Actor }): Promise<{ refundId: string; status: string }> {
  const prepared = await b.db.platform(async (q) => {
    const [p] = await q(`SELECT * FROM billing_payments WHERE id = $1 FOR UPDATE`, [paymentId]);
    if (!p) fail(404, 'NOT_FOUND', 'Payment not found');
    const [pend] = await q(`SELECT COALESCE(SUM(amount), 0)::bigint AS n FROM billing_refunds WHERE payment_id = $1 AND status = 'pending_provider'`, [paymentId]);
    const available = p.amount - p.amount_refunded - pend.n;
    if (!Number.isSafeInteger(o.amount) || o.amount <= 0) fail(400, 'INVALID_AMOUNT', 'Enter a refund amount');
    if (o.amount > available) fail(409, 'REFUND_EXCEEDS_PAYMENT', `Only ${money(available)} of this payment can still be refunded`);
    const refundId = randomUUID();
    const viaProvider = o.viaProvider && !!p.provider;
    await q(`INSERT INTO billing_refunds (id, payment_id, amount, reason, status, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [refundId, paymentId, o.amount, o.reason, viaProvider ? 'pending_provider' : 'completed', o.actor.type === 'admin' ? o.actor.id : null, nowIso(b)]);
    if (!viaProvider) await applyRefundEffect(b, q, refundId, o.actor);
    await audit(q, { actor: o.actor, action: 'refund.recorded', entityType: 'payment', entityId: paymentId, tenantId: p.tenant_id, detail: { refundId, amount: o.amount, reason: o.reason, viaProvider } });
    return { refundId, viaProvider, payment: p };
  });
  if (!prepared.viaProvider) return { refundId: prepared.refundId, status: 'completed' };
  try {
    const provider = b.providers.get(prepared.payment.provider);
    if (!provider.refund) throw new ProviderError('UNSUPPORTED', 'This provider does not support refunds through Mansora. Refund it in the provider dashboard and record it manually.');
    const r = await provider.refund({ transactionRef: prepared.payment.reference ?? prepared.payment.provider_txn_id, amount: o.amount, reason: o.reason });
    await b.db.platform(async (q) => {
      await q(`UPDATE billing_refunds SET provider_ref = $2 WHERE id = $1`, [prepared.refundId, r.ref]);
      if (r.status === 'completed') await completeRefund(b, q, prepared.refundId, o.actor);
      else if (r.status === 'failed') await q(`UPDATE billing_refunds SET status = 'failed' WHERE id = $1`, [prepared.refundId]);
    });
    return { refundId: prepared.refundId, status: r.status === 'failed' ? 'failed' : r.status === 'completed' ? 'completed' : 'pending_provider' };
  } catch (e) {
    // Only a definite refusal means no money moved. A timeout or network error may have reached the provider,
    // so the refund stays pending and an administrator checks it rather than refunding twice.
    const refused = e instanceof ProviderError && !e.retryable;
    await b.db.platform(async (q) => {
      if (refused) await q(`UPDATE billing_refunds SET status = 'failed' WHERE id = $1`, [prepared.refundId]);
      else await openException(q, { key: `refund-unknown:${prepared.refundId}`, kind: 'provider_error', tenantId: prepared.payment.tenant_id, paymentId: prepared.payment.id,
        detail: `A refund of ${money(o.amount)} was sent to ${prepared.payment.provider} but no answer came back (${(e as Error).message}). Check it in the provider dashboard before trying again.` });
    });
    return asHttp(e);
  }
}

export async function completeRefund(b: Billing, q: Query, refundId: string, actor: Actor): Promise<void> {
  const [r] = await q(`SELECT * FROM billing_refunds WHERE id = $1 FOR UPDATE`, [refundId]);
  if (!r || r.status === 'completed') return;
  await q(`UPDATE billing_refunds SET status = 'completed' WHERE id = $1`, [refundId]);
  await applyRefundEffect(b, q, refundId, actor);
}

/** Money returned reduces what the client is treated as having paid; any part that was never applied to an invoice reopens nothing. */
async function applyRefundEffect(b: Billing, q: Query, refundId: string, actor: Actor): Promise<void> {
  const [r] = await q(`SELECT * FROM billing_refunds WHERE id = $1`, [refundId]);
  const [p] = await q(`SELECT * FROM billing_payments WHERE id = $1 FOR UPDATE`, [r.payment_id]);
  const allocs = await q(`SELECT * FROM payment_allocations WHERE payment_id = $1 ORDER BY id FOR UPDATE`, [p.id]);
  const allocated = allocs.reduce((t: number, a: any) => t + a.amount, 0);
  const unallocatedPool = p.amount - allocated;
  const before = p.amount_refunded, after = before + r.amount;
  const toInvoices = Math.max(0, after - unallocatedPool) - Math.max(0, before - unallocatedPool);
  if (toInvoices > 0) {
    const shares = allocate(toInvoices, allocs.map((a: any) => a.amount - a.refunded));
    for (let i = 0; i < allocs.length; i++) {
      if (!shares[i]) continue;
      await q(`UPDATE payment_allocations SET refunded = refunded + $2 WHERE id = $1`, [allocs[i].id, shares[i]]);
      await q(`UPDATE invoices SET amount_refunded = amount_refunded + $2 WHERE id = $1`, [allocs[i].invoice_id, shares[i]]);
      const inv = await refreshInvoice(b, q, allocs[i].invoice_id);
      if (inv.subscription_id) await recomputeSubscription(b, q, inv.subscription_id, actor);
    }
  }
  // The refunded amount is always recorded; a disputed payment keeps its disputed status.
  await q(`UPDATE billing_payments SET amount_refunded = $2, status = CASE WHEN status = 'disputed' THEN status WHEN $2 >= amount THEN 'refunded' ELSE 'partially_refunded' END WHERE id = $1`, [p.id, after]);
  await audit(q, { actor, action: 'refund.completed', entityType: 'payment', entityId: p.id, tenantId: p.tenant_id, detail: { refundId, amount: r.amount, appliedToInvoices: toInvoices } });
}

// ---------------------------------------------------------------- starting a payment
async function inFlight(q: Query, invoiceId: string): Promise<any | undefined> {
  return (await q(`SELECT * FROM payment_attempts WHERE invoice_id = $1 AND status = ANY($2)`, [invoiceId, IN_FLIGHT]))[0];
}
const newReference = (number: string | null, n: number) => `MNS-${(number ?? 'DRAFT').replace(/[^A-Za-z0-9-]/g, '')}-${n}-${randomBytes(3).toString('hex')}`;
async function failAttemptStart(b: Billing, attemptId: string, reason: string) {
  await b.db.platform((q) => q(`UPDATE payment_attempts SET status = 'failed', failure_reason = $2, updated_at = $3, completed_at = $3 WHERE id = $1 AND status = 'initiated'`, [attemptId, reason.slice(0, 300), nowIso(b)]));
}

/** A one-off payment: the client is sent to the provider's secure page. The result is only trusted once verified with the provider. */
export async function startCheckout(b: Billing, o: { tenantId: string; invoiceId: string; actor: Actor }): Promise<{ url: string; attemptId: string; reused: boolean; sandbox: boolean }> {
  const prep = await b.db.platform(async (q) => {
    const [inv] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [o.invoiceId]);
    if (!inv || inv.tenant_id !== o.tenantId) fail(404, 'NOT_FOUND', 'Invoice not found');
    const out = outstanding(inv);
    if (!['sent', 'partially_paid'].includes(inv.status) || out <= 0) fail(409, 'NOT_PAYABLE', 'This invoice is not waiting for payment');
    const live = await inFlight(q, inv.id);
    if (live) {
      if (live.kind !== 'mandate_charge' && live.status === 'awaiting_customer' && live.checkout_url) return { reuse: { url: live.checkout_url, attemptId: live.id, sandbox: live.sandbox } };
      fail(409, 'PAYMENT_IN_PROGRESS', 'A payment for this invoice is already being processed. It will update here when the provider confirms it.');
    }
    const c = await billingContact(q, o.tenantId);
    if (!c.email) fail(409, 'NO_EMAIL', 'Add a billing email address for this client before taking a payment.');
    let provider;
    try { provider = b.providers.forCheckout(); } catch (e) { asHttp(e); }
    const [cnt] = await q(`SELECT COUNT(*)::bigint AS n FROM payment_attempts WHERE invoice_id = $1`, [inv.id]);
    const n = cnt.n + 1, id = randomUUID(), reference = newReference(inv.number, n);
    await q(`INSERT INTO payment_attempts (id, tenant_id, invoice_id, provider, kind, amount, status, reference, idempotency_key, attempt_no, sandbox, requested_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'checkout', $5, 'initiated', $6, $7, $8, $9, $10, $11, $11)`,
      [id, o.tenantId, inv.id, provider!.caps.id, out, reference, `checkout:${inv.id}:${n}`, n, provider!.caps.sandbox, o.actor.type, nowIso(b)]);
    return { id, reference, provider: provider!, amount: out, email: c.email, number: inv.number, sandbox: provider!.caps.sandbox };
  });
  if ('reuse' in prep && prep.reuse) return { ...prep.reuse, reused: true };
  const p = prep as any;
  try {
    const r = await p.provider.createCheckout({ reference: p.reference, amount: p.amount, currency: 'GHS', email: p.email, description: `Invoice ${p.number}`, callbackUrl: `${b.env.publicBaseUrl}/pay/done`, metadata: { invoice: p.number, attempt: p.id } });
    await b.db.platform((q) => q(`UPDATE payment_attempts SET status = 'awaiting_customer', checkout_url = $2, updated_at = $3 WHERE id = $1`, [p.id, r.url, nowIso(b)]));
    return { url: r.url, attemptId: p.id, reused: false, sandbox: p.sandbox };
  } catch (e) {
    await failAttemptStart(b, p.id, (e as Error).message);
    return asHttp(e);
  }
}

/** Ask a client to authorise future automatic payments. Nothing is ever charged later without a mandate recorded here. */
export async function startMandate(b: Billing, o: { tenantId: string; method: 'card' | 'momo'; phone?: string | null; actor: Actor }): Promise<{ url: string; mandateId: string; sandbox: boolean }> {
  const prep = await b.db.platform(async (q) => {
    const [sub] = await q(`SELECT * FROM client_subscriptions WHERE tenant_id = $1 FOR UPDATE`, [o.tenantId]);
    if (!sub || ['draft', 'cancelled', 'expired'].includes(sub.status)) fail(409, 'NO_SUBSCRIPTION', 'There is no subscription to set up automatic payments for.');
    const [active] = await q(`SELECT 1 FROM payment_mandates WHERE tenant_id = $1 AND status = 'active'`, [o.tenantId]);
    if (active) fail(409, 'ALREADY_AUTHORISED', 'Automatic payments are already set up. Cancel the current authorisation first to change it.');
    let provider;
    try { provider = b.providers.forMandate(o.method); } catch (e) { asHttp(e); }
    const c = await billingContact(q, o.tenantId);
    if (!c.email) fail(409, 'NO_EMAIL', 'Add a billing email address for this client first.');
    await q(`UPDATE payment_mandates SET status = 'expired', cancel_reason = 'Replaced by a new request' WHERE tenant_id = $1 AND status = 'pending'`, [o.tenantId]);
    const s = await loadSettings(q);
    let invoice: any = null;
    if (o.method === 'card') { // a card is authorised by paying a first invoice
      invoice = (await q(`SELECT * FROM invoices WHERE subscription_id = $1 AND status IN ('sent','partially_paid') ORDER BY is_initial DESC, due_date LIMIT 1`, [sub.id]))[0];
      if (!invoice) fail(409, 'NOTHING_TO_PAY', 'There is no invoice to pay yet. Mansora will invoice you first, and you can then set up automatic payments.');
      const live = await inFlight(q, invoice.id);
      if (live && live.kind !== 'mandate_charge' && ['initiated', 'awaiting_customer'].includes(live.status)) await q(`UPDATE payment_attempts SET status = 'cancelled', failure_reason = 'Replaced by automatic-payment setup', completed_at = $2, updated_at = $2 WHERE id = $1`, [live.id, nowIso(b)]);
      else if (live) fail(409, 'PAYMENT_IN_PROGRESS', 'A payment for this invoice is already being processed.');
    }
    const max = Math.max(netAmount(sub), invoice ? outstanding(invoice) : 0);
    const consent = `I authorise ${s.issuer.name} to collect up to ${money(max)} every ${sub.billing_frequency === 'monthly' ? 'month' : sub.billing_frequency === 'quarterly' ? 'quarter' : 'year'} from my ${o.method === 'card' ? 'card' : 'Mobile Money wallet'} for my subscription, until I cancel. I can cancel at any time.`;
    const mandateId = randomUUID(), mref = `MNS-MDT-${randomBytes(5).toString('hex')}`;
    await q(`INSERT INTO payment_mandates (id, tenant_id, subscription_id, provider, method, status, provider_ref, max_amount, frequency, consent_text, consent_at, sandbox)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11)`, [mandateId, o.tenantId, sub.id, provider!.caps.id, o.method, mref, max, sub.billing_frequency, consent, nowIso(b), provider!.caps.sandbox]);
    await q(`UPDATE client_subscriptions SET mandate_id = $2, payment_method = $3 WHERE id = $1`, [sub.id, mandateId, o.method]);
    let attemptId: string | null = null, reference = mref;
    if (invoice) {
      attemptId = randomUUID();
      reference = newReference(invoice.number, 0);
      await q(`INSERT INTO payment_attempts (id, tenant_id, invoice_id, mandate_id, provider, kind, amount, status, reference, idempotency_key, attempt_no, sandbox, requested_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'mandate_setup', $6, 'initiated', $7, $8, 0, $9, $10, $11, $11)`, [attemptId, o.tenantId, invoice.id, mandateId, provider!.caps.id, outstanding(invoice), reference, `mandate-setup:${mandateId}`, provider!.caps.sandbox, o.actor.type, nowIso(b)]);
    }
    await audit(q, { actor: o.actor, action: 'mandate.requested', entityType: 'mandate', entityId: mandateId, tenantId: o.tenantId, detail: { method: o.method, provider: provider!.caps.id, maxAmount: max, consent } });
    return { provider: provider!, mandateId, attemptId, reference, mref, invoice, email: c.email as string, max, sandbox: provider!.caps.sandbox, number: invoice?.number };
  });
  try {
    const r = await prep.provider.startMandate({ reference: prep.reference, amount: prep.invoice ? outstanding(prep.invoice) : prep.max, currency: 'GHS', email: prep.email, description: 'Subscription authorisation', callbackUrl: `${b.env.publicBaseUrl}/pay/done`, method: o.method, phone: o.phone ?? null, metadata: { mandate: prep.mandateId } });
    await b.db.platform(async (q) => {
      if (prep.attemptId) await q(`UPDATE payment_attempts SET status = 'awaiting_customer', checkout_url = $2, updated_at = $3 WHERE id = $1`, [prep.attemptId, r.url, nowIso(b)]);
      await q(`UPDATE payment_mandates SET provider_ref = $2 WHERE id = $1`, [prep.mandateId, r.providerRef]);
    });
    return { url: r.url, mandateId: prep.mandateId, sandbox: prep.sandbox };
  } catch (e) {
    await b.db.platform(async (q) => {
      await q(`UPDATE payment_mandates SET status = 'failed', cancel_reason = $2 WHERE id = $1`, [prep.mandateId, (e as Error).message.slice(0, 300)]);
      if (prep.attemptId) await q(`UPDATE payment_attempts SET status = 'failed', failure_reason = $2, completed_at = $3, updated_at = $3 WHERE id = $1`, [prep.attemptId, (e as Error).message.slice(0, 300), nowIso(b)]);
    });
    return asHttp(e);
  }
}

export async function activateMandate(b: Billing, q: Query, mandateId: string, auth: { token: string; masked: string }, actor: Actor): Promise<void> {
  const [m] = await q(`SELECT * FROM payment_mandates WHERE id = $1 FOR UPDATE`, [mandateId]);
  if (!m || m.status === 'active' || m.status === 'cancelled') return;
  await q(`UPDATE payment_mandates SET status = 'active', token_encrypted = $2, masked = $3, approved_at = $4 WHERE id = $1`, [mandateId, seal(b, auth.token, `mandate:${mandateId}`), auth.masked, nowIso(b)]);
  await audit(q, { actor, action: 'mandate.approved', entityType: 'mandate', entityId: mandateId, tenantId: m.tenant_id, detail: { provider: m.provider, method: m.method, masked: auth.masked, maxAmount: m.max_amount, frequency: m.frequency } });
  if (m.subscription_id) {
    await q(`UPDATE client_subscriptions SET mandate_id = $2, payment_method = $3 WHERE id = $1`, [m.subscription_id, mandateId, m.method]);
    await maybeActivate(b, q, m.subscription_id, actor);
  }
  const [sub] = await q(`SELECT s.renewal_date, p.name FROM client_subscriptions s JOIN service_plans p ON p.id = s.plan_id WHERE s.id = $1`, [m.subscription_id]);
  const c = await billingContact(q, m.tenant_id), st = await loadSettings(q);
  await queueEmail(q, { tenantId: m.tenant_id, to: c.email, kind: 'mandate_confirmed', subject: 'Automatic payments are set up', body:
    `Hello ${c.name},\n\nAutomatic payments are set up for ${sub?.name ?? 'your subscription'}.\nAmount: up to ${money(m.max_amount)} per ${m.frequency.replace('ly', '')}.\nPaid from: ${m.masked}.\nNext payment date: ${sub?.renewal_date ?? 'to be confirmed'}.\n\nTo cancel, open Billing & Payments in your Mansora app, or contact ${st.issuer.email || 'Mansora billing support'}.` });
}

export async function cancelMandateAtProvider(b: Billing, info: { provider: string; token: string | null; providerRef: string | null } | null, tenantId: string): Promise<void> {
  if (!info) return;
  try {
    const p = b.providers.find(info.provider);
    if (p?.cancelMandate) await p.cancelMandate({ token: info.token, providerRef: info.providerRef });
  } catch (e) {
    await b.db.platform((q) => openException(q, { key: `cancel-provider:${info.providerRef ?? info.provider}:${tenantId}`, kind: 'provider_error', tenantId, detail: `The authorisation was cancelled in Mansora, so it will not be charged, but cancelling it at ${info.provider} failed: ${(e as Error).message}. Revoke it in the provider dashboard.` }));
  }
}

// ---------------------------------------------------------------- automatic collection
/**
 * Collect one invoice from an active authorisation. The attempt row is committed BEFORE the provider is called, and the database allows only
 * one in-flight attempt per invoice, so a repeated or concurrent run cannot charge twice. An accepted request is never treated as paid.
 */
export async function chargeInvoice(b: Billing, invoiceId: string, o: { force?: boolean; actor: Actor }): Promise<{ result: 'skipped' | 'initiated'; reason?: string; attemptId?: string }> {
  const s = await b.db.platform(loadSettings);
  const prep = await b.db.platform(async (q): Promise<any> => {
    const [inv] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    if (!inv) fail(404, 'NOT_FOUND', 'Invoice not found');
    const skip = (reason: string) => ({ skip: reason });
    if (!['sent', 'partially_paid'].includes(inv.status)) return skip(inv.status === 'disputed' ? 'disputed' : 'not_payable');
    const out = outstanding(inv);
    if (out <= 0) return skip('nothing_owed');
    if (!inv.subscription_id) return skip('no_subscription');
    const [m] = await q(`SELECT m.* FROM payment_mandates m JOIN client_subscriptions s ON s.mandate_id = m.id WHERE s.id = $1 AND m.status = 'active'`, [inv.subscription_id]);
    if (!m) return skip('no_active_mandate');
    if (await inFlight(q, invoiceId)) return skip('in_flight');
    const hist = await q(`SELECT status, completed_at FROM payment_attempts WHERE invoice_id = $1 AND kind = 'mandate_charge' ORDER BY attempt_no`, [invoiceId]);
    if (!o.force) {
      if (hist.length >= s.maxAttempts) return skip('max_attempts');
      const last = hist[hist.length - 1];
      if (last?.completed_at && Date.parse(nowIso(b)) < Date.parse(last.completed_at) + s.retryDays * 86_400_000) return skip('retry_not_due');
    }
    if (out > m.max_amount) {
      await openException(q, { key: `mandate-limit:${invoiceId}`, kind: 'mandate_limit', tenantId: inv.tenant_id, invoiceId, detail: `Invoice ${inv.number} is ${money(out)}, above the ${money(m.max_amount)} the client authorised. Ask them to authorise automatic payments again.` });
      return skip('mandate_limit');
    }
    const c = await billingContact(q, inv.tenant_id);
    if (!c.email) return skip('no_email');
    const provider = b.providers.find(m.provider);
    if (!provider) return skip('unknown_provider');
    const n = hist.length + 1, id = randomUUID(), reference = newReference(inv.number, n);
    try {
      await q(`INSERT INTO payment_attempts (id, tenant_id, invoice_id, mandate_id, provider, kind, amount, status, reference, idempotency_key, attempt_no, sandbox, requested_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'mandate_charge', $6, 'initiated', $7, $8, $9, $10, $11, $12, $12)`, [id, inv.tenant_id, invoiceId, m.id, m.provider, out, reference, `charge:${invoiceId}:${n}`, n, m.sandbox, o.actor.type, nowIso(b)]);
    } catch (e: any) {
      if (e?.code === '23505') return skip('in_flight');
      throw e;
    }
    await audit(q, { actor: o.actor, action: 'collection.initiated', entityType: 'invoice', entityId: invoiceId, tenantId: inv.tenant_id, detail: { attempt: n, amount: out, provider: m.provider, reference } });
    return { id, reference, amount: out, email: c.email, provider, token: unseal(b, m.token_encrypted, `mandate:${m.id}`), tenantId: inv.tenant_id };
  });
  if (prep.skip) return { result: 'skipped', reason: prep.skip };
  try {
    const r = await prep.provider.charge({ token: prep.token, reference: prep.reference, amount: prep.amount, currency: 'GHS', email: prep.email });
    if (r.status === 'failed') {
      await b.db.platform(async (q) => failAttempt(b, q, prep.id, r.reason ?? 'The payment was declined', o.actor));
      return { result: 'initiated', attemptId: prep.id, reason: 'declined' };
    }
    await b.db.platform((q) => q(`UPDATE payment_attempts SET status = 'pending', updated_at = $2 WHERE id = $1`, [prep.id, nowIso(b)]));
  } catch (e) {
    // The outcome is unknown, so the attempt stays pending (it is NOT retried blindly) and reconciliation asks the provider.
    await b.db.platform(async (q) => {
      await q(`UPDATE payment_attempts SET status = 'pending', failure_reason = $2, updated_at = $3 WHERE id = $1`, [prep.id, `No clear answer from the provider: ${(e as Error).message}`.slice(0, 300), nowIso(b)]);
      await openException(q, { key: `provider-error:${prep.id}`, kind: 'provider_error', tenantId: prep.tenantId, attemptId: prep.id, detail: `Collection request ${prep.reference} got no clear answer from the provider. It will be checked automatically; do not charge again by hand.` });
    });
  }
  await settleAttempt(b, prep.id, o.actor);
  return { result: 'initiated', attemptId: prep.id };
}

export async function failAttempt(b: Billing, q: Query, attemptId: string, reason: string, actor: Actor): Promise<void> {
  const [a] = await q(`SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attemptId]);
  if (!a || ['successful', 'failed', 'cancelled'].includes(a.status)) return;
  await q(`UPDATE payment_attempts SET status = 'failed', failure_reason = $2, completed_at = $3, updated_at = $3 WHERE id = $1`, [attemptId, reason.slice(0, 300), nowIso(b)]);
  await audit(q, { actor, action: 'payment.failed', entityType: 'payment_attempt', entityId: attemptId, tenantId: a.tenant_id, detail: { reason, invoiceId: a.invoice_id, kind: a.kind } });
  if (a.kind === 'mandate_setup' && a.mandate_id) await q(`UPDATE payment_mandates SET status = 'failed', cancel_reason = $2 WHERE id = $1 AND status = 'pending'`, [a.mandate_id, reason.slice(0, 300)]);
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1`, [a.invoice_id]);
  if (inv?.subscription_id) await recomputeSubscription(b, q, inv.subscription_id, actor);
  const c = await billingContact(q, a.tenant_id);
  await queueEmail(q, { tenantId: a.tenant_id, to: c.email, invoiceId: a.invoice_id, kind: 'payment_failed', subject: `Payment for invoice ${inv?.number ?? ''} did not go through`,
    body: `Hello ${c.name},\n\nWe could not collect ${money(a.amount)} for invoice ${inv?.number ?? ''}: ${reason}.\n\nYou can pay securely here: ${payUrl(b, a.invoice_id)}\n\nIf you need help, reply to this email.` });
}

/**
 * Settle an attempt by asking the provider itself for the truth. The only way an attempt becomes successful. Safe to call any number of times.
 */
export async function settleAttempt(b: Billing, attemptId: string, actor: Actor): Promise<{ status: string; detail?: string }> {
  const [a] = await b.db.platform((q) => q(`SELECT * FROM payment_attempts WHERE id = $1`, [attemptId]));
  if (!a) fail(404, 'NOT_FOUND', 'Payment attempt not found');
  // A cancelled (abandoned) attempt is still checked: the client may have completed it later.
  if (['successful', 'failed'].includes(a.status)) return { status: a.status };
  const provider = b.providers.find(a.provider);
  if (!provider) return { status: a.status, detail: 'Unknown provider' };
  let v: VerifyResult;
  try {
    v = await provider.verify(a.reference);
  } catch (e) {
    await b.db.platform((q) => openException(q, { key: `verify:${a.id}:${today(b)}`, kind: 'provider_error', tenantId: a.tenant_id, attemptId: a.id, invoiceId: a.invoice_id, detail: `Could not confirm payment ${a.reference} with ${a.provider}: ${(e as Error).message}. It stays pending and will be checked again.` }));
    return { status: a.status, detail: (e as Error).message };
  }
  return b.db.platform((q) => applyVerification(b, q, a.id, v, actor));
}

async function applyVerification(b: Billing, q: Query, attemptId: string, v: VerifyResult, actor: Actor): Promise<{ status: string; detail?: string }> {
  const [a] = await q(`SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attemptId]);
  if (['successful', 'failed'].includes(a.status)) return { status: a.status };
  // An attempt given up as abandoned can still be completed by the client later; the money must then be recorded.
  if (a.status === 'cancelled' && v.status !== 'successful') return { status: a.status };
  if (a.status === 'cancelled') await openException(q, { key: `late-success:${a.id}`, kind: 'late_payment', tenantId: a.tenant_id, attemptId: a.id, invoiceId: a.invoice_id,
    detail: `Payment ${a.reference} was marked abandoned but the provider later confirmed it. It has been recorded; check the invoice.` });
  const ageMs = Date.parse(nowIso(b)) - Date.parse(a.created_at);
  if (v.status === 'successful') {
    if (v.amount !== a.amount || (v.currency ?? 'GHS') !== a.currency) {
      await openException(q, { key: `mismatch:${a.id}`, kind: 'amount_mismatch', tenantId: a.tenant_id, attemptId: a.id, invoiceId: a.invoice_id, detail: `Provider reports ${v.amount} ${v.currency} for ${a.reference} but ${a.amount} ${a.currency} was requested. Nothing was recorded as paid.` });
      await q(`UPDATE payment_attempts SET status = 'pending', failure_reason = 'Provider amount does not match the request', updated_at = $2 WHERE id = $1`, [a.id, nowIso(b)]);
      return { status: 'pending', detail: 'amount mismatch' };
    }
    const method = v.channel === 'mobile_money' ? 'momo' : v.channel === 'bank' ? 'bank' : v.channel === 'card' || a.kind !== 'checkout' ? 'card' : 'other';
    // If the invoice was settled or withdrawn while this payment was in flight, the money is still recorded, but unallocated and flagged for review.
    const [target] = await q(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [a.invoice_id]);
    const payable = !!target && PAYABLE.includes(target.status) && outstanding(target) > 0;
    await applyPayment(b, q, { tenantId: a.tenant_id, amount: a.amount, method, provider: a.provider, attemptId: a.id, providerTxnId: v.txnId ?? a.reference, reference: a.reference, fee: v.fee ?? 0, sandbox: a.sandbox, receivedAt: nowIso(b), allocations: payable ? [{ invoiceId: a.invoice_id, amount: a.amount }] : [], capToOutstanding: true, actor });
    await q(`UPDATE payment_attempts SET status = 'successful', provider_txn_id = $2, completed_at = $3, updated_at = $3, failure_reason = NULL WHERE id = $1`, [a.id, v.txnId ?? a.reference, nowIso(b)]);
    if (a.mandate_id) {
      if (v.authorization?.reusable) await activateMandate(b, q, a.mandate_id, { token: v.authorization.token, masked: v.authorization.masked }, actor);
      else if (a.kind === 'mandate_setup') {
        await q(`UPDATE payment_mandates SET status = 'failed', cancel_reason = 'The provider did not return a reusable authorisation' WHERE id = $1 AND status = 'pending'`, [a.mandate_id]);
        await openException(q, { key: `mandate-not-reusable:${a.mandate_id}`, kind: 'mandate_failed', tenantId: a.tenant_id, attemptId: a.id, detail: 'The payment succeeded but the provider did not allow future automatic charges on this payment method. The client can pay by link or try another card.' });
      }
    }
    return { status: 'successful' };
  }
  if (v.status === 'failed') { await failAttempt(b, q, a.id, v.failureReason ?? 'The payment was not completed', actor); return { status: 'failed' }; }
  if (v.status === 'not_found') {
    if (a.status === 'awaiting_customer' && ageMs > 24 * 3_600_000) { await q(`UPDATE payment_attempts SET status = 'cancelled', failure_reason = 'The client did not complete the payment', completed_at = $2, updated_at = $2 WHERE id = $1`, [a.id, nowIso(b)]); return { status: 'cancelled' }; }
    if (a.status !== 'awaiting_customer' && ageMs > 2 * 3_600_000) { await failAttempt(b, q, a.id, 'The provider has no record of this payment', actor); return { status: 'failed' }; }
  }
  if (v.status === 'pending' && a.status === 'initiated') await q(`UPDATE payment_attempts SET status = 'pending', updated_at = $2 WHERE id = $1`, [a.id, nowIso(b)]);
  return { status: a.status };
}

// ---------------------------------------------------------------- webhooks
export async function processWebhook(b: Billing, providerId: string, raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ status: number; body: Record<string, unknown> }> {
  const provider = b.providers.find(providerId);
  if (!provider) return { status: 404, body: { code: 'UNKNOWN_PROVIDER' } };
  let ev;
  try {
    ev = provider.parseWebhook(raw, headers);
  } catch (e) {
    if (e instanceof SignatureError) {
      await b.db.platform((q) => audit(q, { actor: { type: 'provider' }, action: 'webhook.rejected', entityType: 'webhook', entityId: providerId, detail: { reason: 'invalid signature' } }));
      return { status: 401, body: { code: 'INVALID_SIGNATURE' } };
    }
    return { status: 400, body: { code: 'INVALID_EVENT' } };
  }
  const actor: Actor = { type: 'provider', id: providerId };
  const fresh = await b.db.platform(async (q) => {
    const ins = await q(`INSERT INTO billing_events (id, provider, event_id, type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`, [randomUUID(), providerId, ev.eventId, ev.type, raw.toString('utf8')]);
    if (ins.length) return true;
    const [prev] = await q(`SELECT outcome FROM billing_events WHERE provider = $1 AND event_id = $2`, [providerId, ev.eventId]);
    return !['applied', 'ignored'].includes(prev.outcome); // a repeat of a finished event is acknowledged and ignored; an unfinished one is retried
  });
  if (!fresh) return { status: 200, body: { duplicate: true } };
  let outcome = 'applied', detail = '';
  try {
    if (ev.type === 'payment.success' || ev.type === 'payment.failed') {
      const [a] = await b.db.platform((q) => q(`SELECT id, provider FROM payment_attempts WHERE reference = $1`, [ev.reference ?? '']));
      if (!a || a.provider !== providerId) {
        outcome = 'ignored'; detail = 'Unknown payment reference';
        await b.db.platform((q) => openException(q, { key: `unknown-ref:${providerId}:${ev.eventId}`, kind: 'unknown_reference', detail: `Webhook ${ev.eventId} from ${providerId} references ${ev.reference ?? '(none)'}, which Mansora never requested.` }));
      } else {
        // Authoritative: verified with the provider, never trusted from the webhook body. If the provider does not yet confirm, the event
        // stays open ('deferred') so a redelivery is processed again, and reconciliation will settle it regardless.
        const r = await settleAttempt(b, a.id, actor);
        detail = r.status;
        if (!['successful', 'failed', 'cancelled'].includes(r.status)) outcome = 'deferred';
      }
    } else if (ev.type === 'mandate.approved') {
      const done = await b.db.platform(async (q) => {
        const [m] = await q(`SELECT id FROM payment_mandates WHERE provider = $1 AND provider_ref = $2`, [providerId, ev.mandateRef ?? '']);
        if (!m || !ev.authorization) return false;
        await activateMandate(b, q, m.id, ev.authorization, actor);
        return true;
      });
      if (!done) { outcome = 'ignored'; detail = 'Unknown mandate'; }
    } else if (ev.type === 'mandate.cancelled') {
      await b.db.platform(async (q) => {
        const [m] = await q(`SELECT id FROM payment_mandates WHERE provider = $1 AND provider_ref = $2`, [providerId, ev.mandateRef ?? '']);
        if (m) await cancelMandateLocal(b, q, m.id, 'Cancelled at the provider', actor);
      });
    } else if (ev.type === 'refund.processed') {
      await b.db.platform(async (q) => {
        // Providers identify a processed refund either by the refund's own id or by the original transaction's reference.
        const d = (ev.raw as any)?.data ?? {};
        const refs = [ev.reference, d.id, d.refund_reference].filter((v) => v != null && v !== '').map(String);
        let [r] = await q(`SELECT id FROM billing_refunds WHERE provider_ref = ANY($1::text[]) AND status = 'pending_provider' ORDER BY created_at LIMIT 1`, [refs]);
        if (!r && ev.reference) {
          const amount = Number.isSafeInteger(Number(d.amount)) ? Number(d.amount) : null;
          [r] = await q(`SELECT r.id FROM billing_refunds r JOIN billing_payments p ON p.id = r.payment_id
            WHERE p.reference = $1 AND r.status = 'pending_provider' AND ($2::bigint IS NULL OR r.amount = $2) ORDER BY r.created_at LIMIT 1`, [ev.reference, amount]);
        }
        if (r) await completeRefund(b, q, r.id, actor);
      });
    } else if (ev.type === 'dispute.opened') {
      await b.db.platform(async (q) => {
        const [p] = await q(`SELECT p.*, (SELECT invoice_id FROM payment_allocations WHERE payment_id = p.id ORDER BY amount DESC LIMIT 1) AS invoice_id FROM billing_payments p WHERE p.reference = $1 OR p.provider_txn_id = $1`, [ev.reference ?? '']);
        if (!p) { outcome = 'ignored'; detail = 'Unknown payment'; return; }
        await q(`UPDATE billing_payments SET status = 'disputed' WHERE id = $1`, [p.id]);
        if (p.invoice_id) await openDispute(b, q, p.invoice_id, 'Dispute opened by the payment provider', 'provider', actor, p.id).catch(() => {});
        await openException(q, { key: `dispute:${p.id}`, kind: 'dispute', tenantId: p.tenant_id, paymentId: p.id, detail: `The provider opened a dispute on payment ${p.receipt_number}. Respond with the provider and resolve the invoice dispute here.` });
      });
    } else { outcome = 'ignored'; detail = 'Event type not used'; }
  } catch (e) {
    outcome = 'error'; detail = String((e as Error).message).slice(0, 300);
  }
  await b.db.platform((q) => q(`UPDATE billing_events SET outcome = $3, detail = $4 WHERE provider = $1 AND event_id = $2`, [providerId, ev.eventId, outcome, detail]));
  // A processing error returns 500 so the provider delivers the event again; the unfinished event is retried.
  return outcome === 'error' ? { status: 500, body: { code: 'PROCESSING_ERROR' } } : { status: 200, body: { received: true, outcome } };
}
