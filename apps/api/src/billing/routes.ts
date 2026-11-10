import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RateLimiter, sha256 } from '../security';
import { asHttp, audit, displayStatus, fail, loadSettings, nowIso, openException, outstanding, payUrl, readPayToken, saveSettings, today, REMINDER_STEPS, type Actor, type Billing } from './core';
import { addDays } from './dates';
import { invoiceHtml, receiptHtml } from './documents';
import { cancelInvoice, createInvoice, creditNote, getInvoice, issueInvoice, openDispute, resolveDispute, writeOffInvoice } from './invoices';
import { runBillingCycle, runDaily, runReconciliation, runReminders, sendReminderNow } from './jobs';
import { applyPayment, cancelMandateAtProvider, chargeInvoice, processWebhook, refundPayment, startCheckout, startMandate } from './payments';
import { cedis, collectionsTable, revenueSummary, toCsv, type CollectionFilter } from './reports';
import { activateManually, cancelMandateLocal, cancelSubscription, changePlan, createSubscription, pauseSubscription, requestCancellation, resumeSubscription, setDiscount, setRenewalDate, submitSubscription } from './subscriptions';
import { SandboxProvider } from './providers/sandbox';

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().nonnegative().max(100_000_000_000);
const text = (n = 300) => z.string().trim().min(1).max(n);
const line = z.object({ description: text(200), quantity: z.number().int().positive().max(100_000), unitPrice: money, discount: money.optional(), serviceCode: z.string().max(40).optional() });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cedi = (n: number) => `GH₵${(n / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function registerBillingRoutes(app: FastifyInstance, b: Billing): void {
  const { db } = b;

  async function admin(req: FastifyRequest): Promise<Actor & { name: string }> {
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('Bearer ')) fail(401, 'UNAUTHENTICATED', 'Please sign in');
    const [a] = await db.platform((q) => q(`SELECT a.id, a.name FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'`, [sha256(h.slice(7))]));
    return a ? { type: 'admin', id: a.id, name: a.name } : fail(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  async function device(req: FastifyRequest): Promise<{ id: string; tenantId: string }> {
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('Bearer ')) fail(401, 'UNAUTHENTICATED', 'Device token required');
    const [d] = await db.platform((q) => q(`SELECT d.id, d.tenant_id, d.status, t.status AS tenant_status FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE d.token_hash = $1`, [sha256(h.slice(7))]));
    if (!d || d.status !== 'active' || d.tenant_status === 'closed') fail(401, 'DEVICE_NOT_AUTHORISED', 'This laptop is not authorised. Contact Mansora support.');
    return { id: d.id, tenantId: d.tenant_id };
  }
  const A = '/v1/admin/billing';
  const run = (fn: (q: any) => Promise<any>): Promise<any> => db.platform(fn);

  // ================================================================ settings, providers, accounts
  app.get(`${A}/providers`, async (req) => {
    await admin(req);
    return {
      providers: b.providers.list().map((p) => ({
        id: p.caps.id, label: p.caps.label, configured: p.configured(), sandbox: p.caps.sandbox, verifiedAgainstProvider: p.caps.verified,
        capabilities: { oneOff: p.caps.oneOff, recurringCard: p.caps.recurringCard, recurringMomo: p.caps.recurringMomo, refunds: p.caps.refunds },
        blocker: p.caps.id === 'hubtel' ? 'Needs a Hubtel merchant account and written confirmation of the recurring Mobile Money API, mandate rules and fees.' : p.caps.id === 'paystack' && !p.configured() ? 'Set PAYSTACK_SECRET_KEY (use a test key first).' : null,
      })),
      email: { configured: b.email.configured(), blocker: b.email.configured() ? null : 'No email provider is connected. Messages are queued and visible but not delivered.' },
      publicBaseUrl: b.env.publicBaseUrl,
    };
  });
  app.get(`${A}/settings`, async (req) => { await admin(req); return run((q) => loadSettings(q)); });
  app.put(`${A}/settings`, async (req) => {
    const a = await admin(req);
    const n = z.number().int();
    const body = z.object({
      invoiceLeadDays: n.min(0).max(60), defaultDueDays: n.min(0).max(120), maxAttempts: n.min(1).max(10), retryDays: n.min(1).max(30), activationPolicy: z.enum(['first_payment', 'mandate']),
      reminders: z.object({ enabled: z.boolean(), offsets: z.object(Object.fromEntries(REMINDER_STEPS.map((s) => [s, n.min(-30).max(180)])) as Record<(typeof REMINDER_STEPS)[number], z.ZodNumber>) }),
      issuer: z.object({ name: text(120), address: z.string().max(300), phone: z.string().max(40), email: z.string().max(160), tin: z.string().max(40), paymentInstructions: z.string().max(600) }),
    }).parse(req.body);
    await run(async (q) => { await saveSettings(q, body as any); await audit(q, { actor: a, action: 'settings.updated', entityType: 'settings', entityId: 'billing', detail: body }); });
    return { ok: true };
  });
  app.get(`${A}/merchant-accounts`, async (req) => { await admin(req); return run((q) => q(`SELECT * FROM merchant_payment_accounts WHERE owner_type = 'mansora' ORDER BY created_at`)); });
  app.post(`${A}/merchant-accounts`, async (req) => {
    const a = await admin(req);
    const body = z.object({ provider: z.enum(['paystack', 'hubtel', 'bank']), displayName: text(120), status: z.enum(['pending_verification', 'active', 'disabled']), settlementNote: z.string().max(300).optional() }).parse(req.body);
    return run(async (q) => {
      const rid = randomUUID();
      await q(`INSERT INTO merchant_payment_accounts (id, owner_type, provider, display_name, status, settlement_note) VALUES ($1, 'mansora', $2, $3, $4, $5) ON CONFLICT (provider) WHERE owner_type = 'mansora' DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status, settlement_note = EXCLUDED.settlement_note`, [rid, body.provider, body.displayName, body.status, body.settlementNote ?? null]);
      await audit(q, { actor: a, action: 'merchant_account.saved', entityType: 'merchant_account', entityId: body.provider, detail: { ...body } });
      return { ok: true };
    });
  });

  // ================================================================ subscriptions
  app.get(`${A}/subscriptions`, async (req) => {
    await admin(req);
    const { status } = z.object({ status: z.string().max(30).optional() }).parse(req.query);
    return run((q) => q(`SELECT s.*, t.name AS client, p.name AS plan, m.status AS mandate_status, m.masked AS mandate_masked,
        COALESCE((SELECT SUM((i.total - i.amount_credited - i.amount_written_off - (i.amount_paid - i.amount_refunded))) FROM invoices i WHERE i.subscription_id = s.id AND i.status IN ('sent','partially_paid','disputed')), 0)::bigint AS outstanding
      FROM client_subscriptions s JOIN tenants t ON t.id = s.tenant_id LEFT JOIN service_plans p ON p.id = s.plan_id LEFT JOIN payment_mandates m ON m.id = s.mandate_id
      ${status ? 'WHERE s.status = $1' : ''} ORDER BY t.name`, status ? [status] : []));
  });
  app.get(`${A}/subscriptions/:id`, async (req) => {
    await admin(req);
    const { id: sid } = z.object({ id }).parse(req.params);
    return run(async (q) => {
      const [s] = await q(`SELECT s.*, t.name AS client, p.name AS plan FROM client_subscriptions s JOIN tenants t ON t.id = s.tenant_id LEFT JOIN service_plans p ON p.id = s.plan_id WHERE s.id = $1`, [sid]);
      if (!s) fail(404, 'NOT_FOUND', 'Subscription not found');
      const history = await q(`SELECT actor_type, action, detail, occurred_at FROM billing_audit_logs WHERE entity_type = 'subscription' AND entity_id = $1 ORDER BY occurred_at`, [sid]);
      const mandates = await q(`SELECT id, provider, method, status, masked, max_amount, frequency, consent_text, consent_at, approved_at, cancelled_at, cancel_reason, sandbox FROM payment_mandates WHERE tenant_id = $1 ORDER BY created_at DESC`, [s.tenant_id]);
      const invoices = await q(`SELECT id, number, status, due_date, total, amount_paid, amount_refunded, amount_credited, amount_written_off FROM invoices WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 24`, [sid]);
      return { subscription: s, history, mandates, invoices: invoices.map((i: any) => ({ ...i, outstanding: outstanding(i) })) };
    });
  });
  app.post(`${A}/subscriptions`, async (req) => {
    const a = await admin(req);
    const body = z.object({ tenantId: id, planId: id, agreedAmount: money.nullish(), startDate: date.nullish(), discountBps: z.number().int().min(0).max(10_000).optional(), activationPolicy: z.enum(['first_payment', 'mandate']).optional(), paymentMethod: z.enum(['momo', 'card', 'bank', 'manual']).nullish(), prorationEnabled: z.boolean().optional() }).parse(req.body);
    return run(async (q) => ({ id: await createSubscription(b, q, body, a) }));
  });
  const sub = (path: string, schema: z.ZodType<any>, fn: (q: any, sid: string, body: any, a: Actor) => Promise<unknown>) =>
    app.post(`${A}/subscriptions/:id/${path}`, async (req) => {
      const a = await admin(req);
      const { id: sid } = z.object({ id }).parse(req.params);
      const body = schema.parse(req.body ?? {});
      return run(async (q) => (await fn(q, sid, body, a)) ?? { ok: true });
    });
  sub('submit', z.object({}), (q, sid, _b, a) => submitSubscription(b, q, sid, a));
  sub('activate', z.object({}), async (q, sid, _b, a) => activateManually(b, q, sid, a));
  sub('pause', z.object({ reason: text() }), (q, sid, body, a) => pauseSubscription(b, q, sid, body.reason, a));
  sub('resume', z.object({}), (q, sid, _b, a) => resumeSubscription(b, q, sid, a));
  sub('change-plan', z.object({ planId: id, agreedAmount: money.nullish() }), (q, sid, body, a) => changePlan(b, q, sid, body, a));
  sub('renewal-date', z.object({ date }), (q, sid, body, a) => setRenewalDate(b, q, sid, body.date, a));
  sub('discount', z.object({ discountBps: z.number().int().min(0).max(10_000), note: text(200) }), (q, sid, body, a) => setDiscount(b, q, sid, body.discountBps, body.note, a));
  app.post(`${A}/subscriptions/:id/cancel`, async (req) => {
    const a = await admin(req);
    const { id: sid } = z.object({ id }).parse(req.params);
    const body = z.object({ reason: text(), atPeriodEnd: z.boolean().default(false) }).parse(req.body);
    const r: any = await run((q) => cancelSubscription(b, q, sid, body, a));
    const [s] = await run((q) => q(`SELECT tenant_id FROM client_subscriptions WHERE id = $1`, [sid]));
    await cancelMandateAtProvider(b, r.revoke, s.tenant_id);
    return { ok: true };
  });

  // ================================================================ invoices
  app.get(`${A}/invoices`, async (req) => {
    await admin(req);
    const f = z.object({ status: z.string().max(30).optional(), tenantId: id.optional(), q: z.string().max(60).optional() }).parse(req.query);
    const day = today(b);
    const rows = await run((q) => q(`SELECT i.*, t.name AS client, (i.total - i.amount_credited - i.amount_written_off - (i.amount_paid - i.amount_refunded)) AS outstanding FROM invoices i JOIN tenants t ON t.id = i.tenant_id
      WHERE ($1::uuid IS NULL OR i.tenant_id = $1) AND ($2::text IS NULL OR i.number ILIKE '%' || $2 || '%' OR t.name ILIKE '%' || $2 || '%') ORDER BY COALESCE(i.issue_date, i.created_at::date) DESC, i.created_at DESC LIMIT 500`, [f.tenantId ?? null, f.q ?? null]));
    const out = rows.map((r: any) => ({ ...r, display_status: displayStatus(r, day), days_overdue: r.due_date && r.outstanding > 0 && ['sent', 'partially_paid'].includes(r.status) && r.due_date < day ? Math.round((Date.parse(day) - Date.parse(r.due_date)) / 86_400_000) : 0 }));
    return f.status ? out.filter((r: any) => r.display_status === f.status || r.status === f.status) : out;
  });
  app.post(`${A}/invoices`, async (req) => {
    const a = await admin(req);
    const body = z.object({ tenantId: id, lines: z.array(line).min(1).max(100), extraDiscount: money.optional(), taxBps: z.number().int().min(0).max(10_000).optional(), dueDate: date.nullish(), notes: z.string().max(1000).nullish(), issue: z.boolean().default(false) }).parse(req.body);
    return run(async (q) => ({ id: (await createInvoice(b, q, { ...body, actor: a })).id }));
  });
  app.get(`${A}/invoices/:id`, async (req) => { await admin(req); const { id: iid } = z.object({ id }).parse(req.params); return run((q) => getInvoice(b, q, iid)); });
  app.get(`${A}/invoices/:id/document`, async (req) => { await admin(req); const { id: iid } = z.object({ id }).parse(req.params); return run((q) => invoiceHtml(b, q, iid)); });
  const inv = (path: string, schema: z.ZodType<any>, fn: (q: any, iid: string, body: any, a: Actor) => Promise<unknown>) =>
    app.post(`${A}/invoices/:id/${path}`, async (req) => {
      const a = await admin(req);
      const { id: iid } = z.object({ id }).parse(req.params);
      const body = schema.parse(req.body ?? {});
      return run(async (q) => (await fn(q, iid, body, a)) ?? { ok: true });
    });
  inv('issue', z.object({}), (q, iid, _b, a) => issueInvoice(b, q, iid, a));
  inv('cancel', z.object({ reason: text() }), (q, iid, body, a) => cancelInvoice(b, q, iid, body.reason, a));
  inv('write-off', z.object({ reason: text() }), (q, iid, body, a) => writeOffInvoice(b, q, iid, body.reason, a));
  inv('credit-note', z.object({ amount: money, reason: text() }), async (q, iid, body, a) => ({ number: await creditNote(b, q, iid, body.amount, body.reason, a) }));
  inv('dispute', z.object({ reason: text() }), (q, iid, body, a) => openDispute(b, q, iid, body.reason, 'admin', a));
  inv('dispute/resolve', z.object({ resolution: text() }), (q, iid, body, a) => resolveDispute(b, q, iid, body.resolution, a));
  inv('remind', z.object({}), (q, iid, _b, a) => sendReminderNow(b, q, iid, a));
  inv('link', z.object({}), async (q, iid, _b, a) => {
    const [i] = await q(`SELECT tenant_id, status FROM invoices WHERE id = $1`, [iid]);
    if (!i || !['sent', 'partially_paid', 'disputed'].includes(i.status)) fail(409, 'NOT_PAYABLE', 'This invoice is not waiting for payment');
    await audit(q, { actor: a, action: 'payment_link.shared', entityType: 'invoice', entityId: iid, tenantId: i.tenant_id });
    return { url: payUrl(b, iid) };
  });
  inv('payment', z.object({ amount: money, method: z.enum(['momo', 'card', 'bank', 'cash', 'other']), reference: z.string().max(80).nullish(), receivedOn: date.nullish(), notes: z.string().max(300).nullish() }), async (q, iid, body, a) => {
    const [i] = await q(`SELECT tenant_id FROM invoices WHERE id = $1`, [iid]);
    if (!i) fail(404, 'NOT_FOUND', 'Invoice not found');
    if (body.receivedOn && body.receivedOn > today(b)) fail(400, 'DATE_IN_FUTURE', 'The payment date cannot be in the future');
    const at = body.receivedOn ? `${body.receivedOn}T12:00:00.000Z` : nowIso(b);
    return applyPayment(b, q, { tenantId: i.tenant_id, amount: body.amount, method: body.method, reference: body.reference ?? null, receivedAt: at, recordedBy: a.id ?? null, notes: body.notes ?? null, allocations: [{ invoiceId: iid, amount: body.amount }], actor: a });
  });
  app.post(`${A}/invoices/:id/retry`, async (req) => {
    const a = await admin(req);
    const { id: iid } = z.object({ id }).parse(req.params);
    try { return await chargeInvoice(b, iid, { force: true, actor: a }); } catch (e) { return asHttp(e); }
  });

  // ================================================================ payments, attempts, refunds, settlements, exceptions
  app.get(`${A}/payments`, async (req) => {
    await admin(req);
    const f = z.object({ tenantId: id.optional() }).parse(req.query);
    return run((q) => q(`SELECT p.*, t.name AS client, COALESCE((SELECT string_agg(i.number, ', ') FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id), '') AS invoices
      FROM billing_payments p JOIN tenants t ON t.id = p.tenant_id WHERE ($1::uuid IS NULL OR p.tenant_id = $1) ORDER BY p.received_at DESC LIMIT 500`, [f.tenantId ?? null]));
  });
  app.get(`${A}/payments/:id/receipt`, async (req) => { await admin(req); const { id: pid } = z.object({ id }).parse(req.params); return run((q) => receiptHtml(b, q, pid)); });
  app.post(`${A}/payments/:id/refund`, async (req) => {
    const a = await admin(req);
    const { id: pid } = z.object({ id }).parse(req.params);
    const body = z.object({ amount: money, reason: text(), viaProvider: z.boolean().default(false) }).parse(req.body);
    return refundPayment(b, pid, { ...body, actor: a });
  });
  app.get(`${A}/attempts`, async (req) => {
    await admin(req);
    return run((q) => q(`SELECT a.*, t.name AS client, i.number AS invoice FROM payment_attempts a JOIN tenants t ON t.id = a.tenant_id JOIN invoices i ON i.id = a.invoice_id ORDER BY a.created_at DESC LIMIT 300`));
  });
  app.get(`${A}/settlements`, async (req) => { await admin(req); return run((q) => q(`SELECT s.*, (SELECT COUNT(*) FROM billing_payments p WHERE p.settlement_id = s.id)::bigint AS payments FROM settlements s ORDER BY settled_on DESC LIMIT 200`)); });
  app.post(`${A}/settlements`, async (req) => {
    const a = await admin(req);
    const body = z.object({ provider: z.string().min(1).max(30), reference: text(80), settledOn: date, gross: money, fees: money, paymentIds: z.array(id).max(1000) }).parse(req.body);
    return run(async (q) => {
      if (body.fees > body.gross) fail(400, 'INVALID_AMOUNT', 'Fees cannot exceed the gross amount');
      const sid = randomUUID();
      await q(`INSERT INTO settlements (id, provider, reference, settled_on, gross, fees, net, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [sid, body.provider, body.reference, body.settledOn, body.gross, body.fees, body.gross - body.fees, a.id]);
      let linked = 0;
      for (const pid of body.paymentIds) {
        const r = await q(`UPDATE billing_payments SET settlement_id = $2 WHERE id = $1 AND provider = $3 AND settlement_id IS NULL AND sandbox = false RETURNING id`, [pid, sid, body.provider]);
        linked += r.length;
      }
      if (linked !== body.paymentIds.length) await openException(q, { key: `settlement-links:${sid}`, kind: 'settlement_mismatch', detail: `Settlement ${body.reference}: ${body.paymentIds.length - linked} payment(s) could not be linked (unknown, wrong provider, sandbox, or already settled).` });
      const [sum] = await q(`SELECT COALESCE(SUM(amount - fee), 0)::bigint AS n FROM billing_payments WHERE settlement_id = $1`, [sid]);
      if (sum.n !== body.gross - body.fees) await openException(q, { key: `settlement:${sid}`, kind: 'settlement_mismatch', detail: `Settlement ${body.reference}: the provider paid out ${body.gross - body.fees} but the linked payments add up to ${sum.n} after fees.` });
      await audit(q, { actor: a, action: 'settlement.recorded', entityType: 'settlement', entityId: sid, detail: { ...body, linked } });
      return { id: sid, linked };
    });
  });
  app.get(`${A}/exceptions`, async (req) => {
    await admin(req);
    const { status } = z.object({ status: z.enum(['open', 'resolved']).default('open') }).parse(req.query);
    return run((q) => q(`SELECT e.*, t.name AS client, i.number AS invoice FROM billing_exceptions e LEFT JOIN tenants t ON t.id = e.tenant_id LEFT JOIN invoices i ON i.id = e.invoice_id WHERE e.status = $1 ORDER BY e.created_at DESC LIMIT 300`, [status]));
  });
  app.post(`${A}/exceptions/:id/resolve`, async (req) => {
    const a = await admin(req);
    const { id: eid } = z.object({ id }).parse(req.params);
    const body = z.object({ resolution: text() }).parse(req.body);
    return run(async (q) => {
      const r = await q(`UPDATE billing_exceptions SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = $4 WHERE id = $1 AND status = 'open' RETURNING id`, [eid, body.resolution, a.id, nowIso(b)]);
      if (!r.length) fail(404, 'NOT_FOUND', 'That exception is not open');
      await audit(q, { actor: a, action: 'exception.resolved', entityType: 'exception', entityId: eid, detail: body });
      return { ok: true };
    });
  });
  app.get(`${A}/notifications`, async (req) => { await admin(req); return run((q) => q(`SELECT n.*, t.name AS client FROM notifications n LEFT JOIN tenants t ON t.id = n.tenant_id ORDER BY n.created_at DESC LIMIT 200`)); });
  app.get(`${A}/audit`, async (req) => {
    await admin(req);
    const f = z.object({ entityType: z.string().max(30).optional(), entityId: z.string().max(80).optional(), tenantId: id.optional() }).parse(req.query);
    return run((q) => q(`SELECT * FROM billing_audit_logs WHERE ($1::text IS NULL OR entity_type = $1) AND ($2::text IS NULL OR entity_id = $2) AND ($3::uuid IS NULL OR tenant_id = $3) ORDER BY occurred_at DESC LIMIT 300`, [f.entityType ?? null, f.entityId ?? null, f.tenantId ?? null]));
  });

  // ================================================================ reports and collections
  app.get(`${A}/reports/summary`, async (req) => {
    await admin(req);
    const day = today(b);
    const f = z.object({ from: date.default(`${day.slice(0, 7)}-01`), to: date.default(day) }).parse(req.query);
    return run((q) => revenueSummary(b, q, f.from, f.to));
  });
  app.get(`${A}/collections`, async (req) => {
    await admin(req);
    const f = z.object({ filter: z.enum(['all', 'active', 'pending_mandate', 'upcoming', 'paid', 'overdue', 'failed', 'cancelled', 'disputed']).default('all') }).parse(req.query);
    return run((q) => collectionsTable(b, q, f.filter as CollectionFilter));
  });
  app.get(`${A}/reports/export`, async (req, reply) => {
    await admin(req);
    const day = today(b);
    const f = z.object({ kind: z.enum(['invoices', 'payments', 'collections', 'revenue_by_month', 'ageing']), from: date.default(`${day.slice(0, 7)}-01`), to: date.default(day) }).parse(req.query);
    const rows: unknown[][] = await run(async (q) => {
      if (f.kind === 'invoices') return [['Number', 'Client', 'Status', 'Issued', 'Due', 'Total (GHS)', 'Paid (GHS)', 'Outstanding (GHS)'], ...(await q(`SELECT i.*, t.name AS client FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.status <> 'draft' AND i.issue_date >= $1::date AND i.issue_date <= $2::date ORDER BY i.issue_date`, [f.from, f.to])).map((i: any) => [i.number, i.client, displayStatus(i, day), i.issue_date, i.due_date, cedis(i.total), cedis(i.amount_paid - i.amount_refunded), cedis(outstanding(i))])];
      if (f.kind === 'payments') return [['Receipt', 'Client', 'Received', 'Method', 'Provider', 'Sandbox', 'Amount (GHS)', 'Refunded (GHS)', 'Provider fee (GHS)'], ...(await q(`SELECT p.*, t.name AS client FROM billing_payments p JOIN tenants t ON t.id = p.tenant_id WHERE p.received_at >= $1::date AND p.received_at < ($2::date + 1) ORDER BY p.received_at`, [f.from, f.to])).map((p: any) => [p.receipt_number, p.client, p.received_at, p.method, p.provider ?? 'manual', p.sandbox ? 'yes' : 'no', cedis(p.amount), cedis(p.amount_refunded), cedis(p.fee)])];
      if (f.kind === 'collections') return [['Client', 'Plan', 'Monthly fee (GHS)', 'Payment method', 'Last payment', 'Next payment', 'Outstanding (GHS)', 'Days overdue', 'Mandate', 'Subscription'], ...(await collectionsTable(b, q, 'all')).map((r: any) => [r.client, r.plan, cedis(r.monthly_fee), r.payment_method, r.last_payment, r.next_payment, cedis(r.outstanding), r.days_overdue, r.mandate_status ?? 'none', r.subscription_status])];
      const s = await revenueSummary(b, q, f.from, f.to);
      if (f.kind === 'revenue_by_month') return [['Month', 'Invoiced (GHS)', 'Net cash collected (GHS)'], ...s.months.map((m) => [m.month, cedis(m.invoiced), cedis(m.collected)])];
      return [['Bucket', 'Outstanding (GHS)'], ['Not yet due', cedis(s.receivables.ageing.notYetDue)], ['1-7 days overdue', cedis(s.receivables.ageing.d1_7)], ['8-14 days', cedis(s.receivables.ageing.d8_14)], ['15-30 days', cedis(s.receivables.ageing.d15_30)], ['31+ days', cedis(s.receivables.ageing.d31plus)]];
    });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="mansora-${f.kind}-${f.to}.csv"`).send(toCsv(rows));
  });

  // ================================================================ run jobs by hand
  for (const [name, fn] of [['cycle', runBillingCycle], ['reminders', runReminders], ['reconcile', runReconciliation], ['daily', runDaily]] as const) {
    app.post(`${A}/run/${name}`, async (req) => { const a = await admin(req); const r = await fn(b); await run((q) => audit(q, { actor: a, action: `job.${name}`, entityType: 'job', entityId: name, detail: r })); return r; });
  }

  // ================================================================ the client's own view (device token)
  const C = '/v1/billing';
  const tenantOf = async (req: FastifyRequest) => (await device(req)).tenantId;
  app.get(`${C}/summary`, async (req) => {
    const tenantId = await tenantOf(req);
    const day = today(b);
    const data = await run(async (q) => {
      const [s] = await q(`SELECT s.*, p.name AS plan FROM client_subscriptions s LEFT JOIN service_plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`, [tenantId]);
      const [m] = s?.mandate_id ? await q(`SELECT status, method, masked, max_amount, approved_at, provider, sandbox FROM payment_mandates WHERE id = $1`, [s.mandate_id]) : [];
      const invoices = await q(`SELECT id, number, status, issue_date, due_date, total, amount_paid, amount_refunded, amount_credited, amount_written_off FROM invoices WHERE tenant_id = $1 AND status <> 'draft' ORDER BY issue_date DESC, created_at DESC LIMIT 12`, [tenantId]);
      const payments = await q(`SELECT id, receipt_number, received_at, method, amount, amount_refunded, status, sandbox FROM billing_payments WHERE tenant_id = $1 ORDER BY received_at DESC LIMIT 12`, [tenantId]);
      const st = await loadSettings(q);
      return { s, m, invoices, payments, support: st.issuer };
    });
    const list = data.invoices.map((i: any) => ({ id: i.id, number: i.number, status: displayStatus(i, day), issueDate: i.issue_date, dueDate: i.due_date, total: i.total, outstanding: outstanding(i), canPay: ['sent', 'partially_paid'].includes(i.status) && outstanding(i) > 0 }));
    const owed = list.filter((i: any) => i.canPay);
    const next = owed.slice().sort((a: any, z: any) => String(a.dueDate).localeCompare(String(z.dueDate)))[0];
    const avail = (method: 'card' | 'momo') => { try { b.providers.forMandate(method); return { available: true, reason: null }; } catch (e: any) { return { available: false, reason: e.message as string }; } };
    let checkout: { available: boolean; reason: string | null };
    try { b.providers.forCheckout(); checkout = { available: true, reason: null }; } catch (e: any) { checkout = { available: false, reason: e.message }; }
    const s = data.s;
    return {
      subscription: s ? { status: s.status, plan: s.plan, amount: s.agreed_amount == null ? null : s.agreed_amount - Math.round((s.agreed_amount * s.discount_bps) / 10_000), frequency: s.billing_frequency, nextBillingDate: s.renewal_date, startDate: s.start_date, paymentMethod: s.payment_method, cancelRequested: !!s.cancel_requested_at, cancelAtPeriodEnd: s.cancel_at_period_end } : null,
      mandate: data.m ? { status: data.m.status, method: data.m.method, masked: data.m.masked, maxAmount: data.m.max_amount, approvedAt: data.m.approved_at, sandbox: data.m.sandbox } : null,
      outstanding: owed.reduce((t: number, i: any) => t + i.outstanding, 0),
      nextPayment: next ? { invoiceId: next.id, number: next.number, date: next.dueDate, amount: next.outstanding } : null,
      invoices: list,
      payments: data.payments.map((p: any) => ({ id: p.id, receiptNumber: p.receipt_number, receivedAt: p.received_at, method: p.method, amount: p.amount, refunded: p.amount_refunded, sandbox: p.sandbox })),
      options: { payNow: checkout, card: avail('card'), momo: avail('momo') },
      support: { name: data.support.name, email: data.support.email, phone: data.support.phone },
      serverTime: nowIso(b),
    };
  });
  app.post(`${C}/invoices/:id/pay`, async (req) => { const tenantId = await tenantOf(req); const { id: iid } = z.object({ id }).parse(req.params); return startCheckout(b, { tenantId, invoiceId: iid, actor: { type: 'client', id: tenantId } }); });
  app.post(`${C}/mandate`, async (req) => { const tenantId = await tenantOf(req); const body = z.object({ method: z.enum(['card', 'momo']), phone: z.string().max(30).nullish() }).parse(req.body); return startMandate(b, { tenantId, method: body.method, phone: body.phone, actor: { type: 'client', id: tenantId } }); });
  app.post(`${C}/mandate/cancel`, async (req) => {
    const tenantId = await tenantOf(req);
    const info = await run(async (q) => {
      const [s] = await q(`SELECT mandate_id FROM client_subscriptions WHERE tenant_id = $1 FOR UPDATE`, [tenantId]);
      const r = await cancelMandateLocal(b, q, s?.mandate_id ?? null, 'Cancelled by the client', { type: 'client', id: tenantId });
      if (!r) fail(409, 'NO_MANDATE', 'There is no automatic payment to cancel.');
      return r;
    });
    await cancelMandateAtProvider(b, info, tenantId);
    return { ok: true };
  });
  app.post(`${C}/cancellation-request`, async (req) => { const tenantId = await tenantOf(req); const body = z.object({ reason: text() }).parse(req.body); await run((q) => requestCancellation(b, q, tenantId, body.reason, { type: 'client', id: tenantId })); return { ok: true }; });
  app.get(`${C}/invoices/:id/document`, async (req) => {
    const tenantId = await tenantOf(req); const { id: iid } = z.object({ id }).parse(req.params);
    return run(async (q) => {
      const [i] = await q(`SELECT tenant_id, status FROM invoices WHERE id = $1`, [iid]);
      if (!i || i.tenant_id !== tenantId || i.status === 'draft') fail(404, 'NOT_FOUND', 'Invoice not found');
      await q(`UPDATE invoices SET viewed_at = COALESCE(viewed_at, $2) WHERE id = $1`, [iid, nowIso(b)]);
      return invoiceHtml(b, q, iid);
    });
  });
  app.get(`${C}/payments/:id/receipt`, async (req) => {
    const tenantId = await tenantOf(req); const { id: pid } = z.object({ id }).parse(req.params);
    return run(async (q) => { const [p] = await q(`SELECT tenant_id FROM billing_payments WHERE id = $1`, [pid]); if (!p || p.tenant_id !== tenantId) fail(404, 'NOT_FOUND', 'Receipt not found'); return receiptHtml(b, q, pid); });
  });

  // ================================================================ public: payment links, webhooks, sandbox pages
  const publicLimiter = new RateLimiter(60, 5 * 60_000);
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.5 'Segoe UI',Arial,sans-serif;background:#f3f7f6;color:#14211f;margin:0;padding:24px}main{max-width:460px;margin:8vh auto;background:#fff;border:1px solid #d3dfdc;border-radius:12px;padding:28px}h1{font-size:22px;margin:0 0 4px}.muted{color:#4a5f5c;font-size:14px}.amt{font-size:34px;font-weight:700;margin:16px 0}button{width:100%;padding:14px;border:0;border-radius:8px;background:#1f5f5b;color:#fff;font-size:17px;font-weight:600;cursor:pointer}button.alt{background:#fff;color:#14211f;border:1px solid #9bb3af;margin-top:10px}.sbx{background:#fff0d6;color:#8a5200;padding:8px 12px;border-radius:6px;margin-bottom:14px;font-weight:600}</style></head><body><main>${body}</main></body></html>`;

  app.get('/pay/done', async (_req, reply) => reply.type('text/html').send(page('Thank you', '<h1>Thank you</h1><p>If you completed the payment, it will show on your invoice as soon as the payment provider confirms it. You can close this page.</p>')));
  app.get('/pay/:token', async (req, reply) => {
    publicLimiter.check(req.ip);
    const { token } = z.object({ token: z.string().max(100) }).parse(req.params);
    const iid = readPayToken(b, token);
    const missing = () => reply.code(404).type('text/html').send(page('Link not valid', '<h1>This payment link is not valid</h1><p class="muted">Check the link in your email, or contact Mansora billing support.</p>'));
    if (!iid) return missing();
    const row = await run(async (q) => {
      const [i] = await q(`SELECT i.*, t.name AS client FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.id = $1 AND i.status <> 'draft'`, [iid]);
      if (i) await q(`UPDATE invoices SET viewed_at = COALESCE(viewed_at, $2) WHERE id = $1`, [iid, nowIso(b)]);
      return { i, s: await loadSettings(q) };
    });
    if (!row.i) return missing();
    const out = outstanding(row.i);
    const base = `<h1>Invoice ${esc(row.i.number)}</h1><div class="muted">${esc(row.s.issuer.name)} for ${esc(row.i.client)}</div>`;
    if (out <= 0 || !['sent', 'partially_paid'].includes(row.i.status)) return reply.type('text/html').send(page('Invoice', `${base}<p>${row.i.status === 'paid' || out <= 0 ? 'This invoice has been paid. Thank you.' : `This invoice is ${esc(row.i.status.replace(/_/g, ' '))} and cannot be paid online.`}</p>`));
    const sandbox = !!b.providers.list().find((p) => p.caps.sandbox) && !b.providers.list().some((p) => p.configured() && !p.caps.sandbox && p.caps.oneOff);
    return reply.type('text/html').send(page('Pay invoice', `${sandbox ? '<div class="sbx">SANDBOX: a test payment. No real money moves.</div>' : ''}${base}<div class="amt">${esc(cedi(out))}</div><div class="muted">Due ${esc(String(row.i.due_date).slice(0, 10))}</div><form method="post" action="/pay/${esc(token)}/start" style="margin-top:18px"><button type="submit">Pay securely</button></form><p class="muted" style="margin-top:14px">You will be taken to the payment provider. Card details and Mobile Money PINs are never entered on or stored by Mansora.</p>`));
  });
  app.post('/pay/:token/start', async (req, reply) => {
    publicLimiter.check(req.ip);
    const { token } = z.object({ token: z.string().max(100) }).parse(req.params);
    const iid = readPayToken(b, token);
    if (!iid) return reply.code(404).type('text/html').send(page('Link not valid', '<h1>This payment link is not valid</h1>'));
    const [i] = await run((q) => q(`SELECT tenant_id FROM invoices WHERE id = $1`, [iid]));
    if (!i) return reply.code(404).type('text/html').send(page('Link not valid', '<h1>This payment link is not valid</h1>'));
    try {
      const r = await startCheckout(b, { tenantId: i.tenant_id, invoiceId: iid, actor: { type: 'client', id: 'payment-link' } });
      return reply.redirect(r.url, 303);
    } catch (e: any) {
      return reply.code(e.status ?? 502).type('text/html').send(page('Payment unavailable', `<h1>We could not start the payment</h1><p>${esc(e.message ?? 'Please try again shortly.')}</p><p class="muted">Nothing has been charged.</p>`));
    }
  });

  // Webhooks need the exact raw bytes to check the signature, so this scope keeps the body unparsed.
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/v1/webhooks/:provider', async (req, reply) => {
      const { provider } = z.object({ provider: z.string().max(30) }).parse(req.params);
      const r = await processWebhook(b, provider, Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})), req.headers as any);
      return reply.code(r.status).send(r.body);
    });
  });

  const sandbox = b.providers.find('sandbox') as SandboxProvider | undefined;
  if (sandbox) {
    const deliver = (event: Record<string, unknown>) => { const s = sandbox.signEvent({ id: `evt_${randomUUID()}`, ...event }); return processWebhook(b, 'sandbox', s.body, s.headers); };
    const sbx = (ref: string, kind: 'checkout' | 'mandate') => page('Sandbox payment', `<div class="sbx">SANDBOX: this stands in for the payment provider's page. No real money moves.</div><h1>${kind === 'checkout' ? 'Approve this payment?' : 'Approve automatic payments?'}</h1><p class="muted">Reference ${esc(ref)}</p>
      <form method="post" action="/sandbox/${kind}/${encodeURIComponent(ref)}/approve"><button type="submit">Approve</button></form><form method="post" action="/sandbox/${kind}/${encodeURIComponent(ref)}/decline"><button class="alt" type="submit">Decline</button></form>`);
    app.get('/sandbox/checkout/:ref', async (req, reply) => reply.type('text/html').send(sbx((req.params as any).ref, 'checkout')));
    app.get('/sandbox/mandate/:ref', async (req, reply) => reply.type('text/html').send(sbx((req.params as any).ref, 'mandate')));
    app.post('/sandbox/checkout/:ref/approve', async (req, reply) => { const ref = (req.params as any).ref; sandbox.approve(ref); await deliver({ type: 'payment.success', reference: ref }); return reply.redirect('/pay/done', 303); });
    app.post('/sandbox/checkout/:ref/decline', async (req, reply) => { const ref = (req.params as any).ref; sandbox.fail(ref); await deliver({ type: 'payment.failed', reference: ref }); return reply.redirect('/pay/done', 303); });
    app.post('/sandbox/mandate/:ref/approve', async (req, reply) => { const ref = (req.params as any).ref; const token = sandbox.approveMandate(ref); await deliver({ type: 'mandate.approved', mandateRef: ref, token, masked: 'Sandbox wallet ••• 0000' }); return reply.redirect('/pay/done', 303); });
    app.post('/sandbox/mandate/:ref/decline', async (_req, reply) => reply.redirect('/pay/done', 303));
  }
  void addDays;
}
