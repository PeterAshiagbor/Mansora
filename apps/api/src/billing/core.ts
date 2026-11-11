import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEFAULT_STANDING_POLICY, type StandingPolicy } from '@mansora/domain';
import type { Database, Query } from '../db';
import { HttpError } from '../security';
import { ProviderError } from './providers/types';
import type { ProviderRegistry } from './providers/registry';
import { EmailDeliveryError, type EmailAdapter } from '../email';
export type { EmailAdapter } from '../email';

export const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };

/** Turn a provider failure into a visible, recoverable API error instead of a 500. */
export function asHttp(e: unknown): never {
  if (e instanceof ProviderError) throw new HttpError(e.code === 'PROVIDER_BLOCKED' || e.code === 'NO_PROVIDER' || e.code === 'UNSUPPORTED' ? 409 : 502, e.code, e.message);
  throw e;
}

/** Default: nothing is sent. Messages stay queued and visible until a real email provider is connected (an integration blocker). */
export class NoEmail implements EmailAdapter {
  configured() { return false; }
  async send(): Promise<void> { throw new Error('No email provider is configured'); }
}

export interface BillingEnv { publicBaseUrl: string; payLinkSecret: string; encryptionKey: Buffer; adminEmail?: string }
export interface Billing { db: Database; providers: ProviderRegistry; email: EmailAdapter; env: BillingEnv; now: () => Date }
export interface Actor { type: 'admin' | 'system' | 'client' | 'provider'; id?: string | null }

export const today = (b: Billing) => b.now().toISOString().slice(0, 10);
export const nowIso = (b: Billing) => b.now().toISOString();
export const outstanding = (i: { total: number; amount_paid: number; amount_refunded: number; amount_credited: number; amount_written_off: number }) =>
  i.total - i.amount_credited - i.amount_written_off - (i.amount_paid - i.amount_refunded);
/** The same expression in SQL, for invoice alias i. */
export const OUTSTANDING_SQL = '(i.total - i.amount_credited - i.amount_written_off - (i.amount_paid - i.amount_refunded))';
export const RECEIVABLE_STATUSES = `('sent','partially_paid','disputed')`;
export const displayStatus = (i: any, day: string) => (['sent', 'partially_paid'].includes(i.status) && i.due_date && i.due_date < day ? 'overdue' : i.status);

export function billingEnvFromEnv(strict: boolean): BillingEnv {
  const need = (name: string): string | undefined => {
    const v = process.env[name];
    if (!v && strict) throw new Error(`${name} is required in production`);
    return v;
  };
  const key = need('BILLING_ENCRYPTION_KEY');
  if (key && (Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key)) throw new Error('BILLING_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
  return {
    publicBaseUrl: (need('PUBLIC_BASE_URL') ?? 'http://localhost:4000').replace(/\/+$/, ''),
    // Without these set, a per-process random value is used: fine for development, but payment links and saved tokens would not survive a restart.
    payLinkSecret: need('PAY_LINK_SECRET') ?? randomBytes(32).toString('hex'),
    encryptionKey: key ? Buffer.from(key, 'base64') : randomBytes(32),
    adminEmail: process.env.BILLING_ADMIN_EMAIL,
  };
}

// ---------- secrets and signed links ----------
export function seal(b: Billing, plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', b.env.encryptionKey, iv);
  c.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function unseal(b: Billing, sealed: string, aad: string): string {
  const [v, iv, tag, enc] = sealed.split('.');
  if (v !== 'v1') fail(500, 'BAD_ENVELOPE', 'Stored payment token cannot be read');
  try {
    const d = createDecipheriv('aes-256-gcm', b.env.encryptionKey, Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch {
    return fail(500, 'TOKEN_UNREADABLE', 'Stored payment token cannot be read. Check BILLING_ENCRYPTION_KEY.');
  }
}

const sign = (b: Billing, invoiceId: string) => createHmac('sha256', b.env.payLinkSecret).update(`pay:${invoiceId}`).digest('base64url').slice(0, 27);
export const payToken = (b: Billing, invoiceId: string) => `${invoiceId}.${sign(b, invoiceId)}`;
export const payUrl = (b: Billing, invoiceId: string) => `${b.env.publicBaseUrl}/pay/${payToken(b, invoiceId)}`;
/** Returns the invoice id when the token's signature is valid. */
export function readPayToken(b: Billing, token: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = sign(b, id);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

// ---------- audit, numbering, notifications ----------
export async function audit(q: Query, e: { actor: Actor; action: string; entityType: string; entityId?: string | null; tenantId?: string | null; detail?: unknown }): Promise<void> {
  await q(`INSERT INTO billing_audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, tenant_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), e.actor.type, e.actor.id ?? null, e.action, e.entityType, e.entityId ?? null, e.tenantId ?? null, JSON.stringify(e.detail ?? {})]);
}

export async function nextNumber(q: Query, kind: string, prefix: string, year: number): Promise<string> {
  const [r] = await q(`INSERT INTO document_sequences (kind, year, last) VALUES ($1, $2, 1) ON CONFLICT (kind, year) DO UPDATE SET last = document_sequences.last + 1 RETURNING last`, [kind, year]);
  return `${prefix}-${year}-${String(r.last).padStart(6, '0')}`;
}

export async function openException(q: Query, e: { key: string; kind: string; detail: string; tenantId?: string | null; invoiceId?: string | null; paymentId?: string | null; attemptId?: string | null }): Promise<void> {
  await q(`INSERT INTO billing_exceptions (id, dedupe_key, kind, tenant_id, invoice_id, payment_id, attempt_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (dedupe_key) DO NOTHING`,
    [randomUUID(), e.key, e.kind, e.tenantId ?? null, e.invoiceId ?? null, e.paymentId ?? null, e.attemptId ?? null, e.detail]);
}

export async function billingContact(q: Query, tenantId: string): Promise<{ name: string; email: string | null; phone: string | null; business: string }> {
  const [r] = await q(`SELECT t.name AS business, t.owner_name, COALESCE(a.billing_email, t.email) AS email, COALESCE(a.billing_phone, t.phone) AS phone, COALESCE(a.billing_name, t.owner_name) AS name
    FROM tenants t LEFT JOIN billing_accounts a ON a.tenant_id = t.id WHERE t.id = $1`, [tenantId]);
  return r ? { name: r.name, email: r.email, phone: r.phone, business: r.business } : { name: 'Customer', email: null, phone: null, business: 'Customer' };
}

export async function ensureBillingAccount(q: Query, tenantId: string): Promise<void> {
  await q(`INSERT INTO billing_accounts (id, tenant_id, billing_name, billing_email, billing_phone, address)
    SELECT $1, t.id, t.name, t.email, t.phone, t.address FROM tenants t WHERE t.id = $2 ON CONFLICT (tenant_id) DO NOTHING`, [randomUUID(), tenantId]);
}

/** Record a message. It is delivered afterwards by deliverQueued, so a slow or missing email provider never blocks billing. */
export async function queueEmail(q: Query, m: { id?: string; tenantId?: string | null; to: string | null; subject: string; body: string; invoiceId?: string | null; kind: string }): Promise<string> {
  const id = m.id ?? randomUUID();
  await q(`INSERT INTO notifications (id, tenant_id, to_address, subject, body, status, error, invoice_id, kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, m.tenantId ?? null, m.to, m.subject, m.body, m.to ? 'queued' : 'skipped', m.to ? null : 'No email address on file', m.invoiceId ?? null, m.kind]);
  return id;
}

export async function deliverQueued(b: Billing): Promise<{ sent: number; failed: number; waiting: number }> {
  if (!b.email.configured()) return { sent: 0, failed: 0, waiting: (await b.db.platform((q) => q(`SELECT COUNT(*)::bigint AS n FROM notifications WHERE status = 'queued'`)))[0].n };
  // Persist a lease before network I/O. Other workers skip leased rows; a crash
  // retries with the same Resend key, rather than silently losing the message.
  const rows = await b.db.platform((q) => q(`UPDATE notifications SET attempt_count = attempt_count + 1,
    delivery_started_at = COALESCE(delivery_started_at, $1::timestamptz), next_attempt_at = $1::timestamptz + interval '15 minutes'
    WHERE id IN (SELECT id FROM notifications WHERE status = 'queued' AND next_attempt_at <= $1::timestamptz ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`, [nowIso(b)]));
  let sent = 0, failed = 0;
  for (const n of rows) {
    try {
      // Resend retains idempotency keys for 24h. Fail closed before that window
      // expires: an old ambiguous send needs operator reconciliation, not a new charge-like side effect.
      if (b.now().getTime() - Date.parse(n.delivery_started_at) >= 23 * 3_600_000) throw new EmailDeliveryError('Delivery needs provider reconciliation; idempotency window expired.', false);
      const result = await b.email.send({ to: n.to_address, subject: n.subject, body: n.body, idempotencyKey: `mansora-notification/${n.id}` });
      await b.db.platform((q) => q(`UPDATE notifications SET status = 'sent', sent_at = $2, error = NULL, provider_message_id = $3 WHERE id = $1`, [n.id, nowIso(b), result?.id ?? null]));
      sent++;
    } catch (e) {
      const retry = e instanceof EmailDeliveryError && e.retryable && n.attempt_count < 5;
      const message = e instanceof EmailDeliveryError ? e.message : 'Email delivery failed; review provider configuration.';
      await b.db.platform((q) => q(`UPDATE notifications SET status = $2, error = $3, next_attempt_at = $4 WHERE id = $1`, [n.id, retry ? 'queued' : 'failed', message, new Date(b.now().getTime() + Math.min(60, 2 ** n.attempt_count) * 60_000).toISOString()]));
      failed++;
    }
  }
  return { sent, failed, waiting: (await b.db.platform(q => q(`SELECT COUNT(*)::bigint AS n FROM notifications WHERE status = 'queued'`)))[0].n };
}

// ---------- settings ----------
export const REMINDER_STEPS = ['upcoming', 'due', 'overdue_1', 'overdue_2', 'escalate', 'review'] as const;
export type ReminderStep = (typeof REMINDER_STEPS)[number];
export interface Issuer { name: string; address: string; phone: string; email: string; tin: string; paymentInstructions: string }
export interface BillingSettings {
  invoiceLeadDays: number; defaultDueDays: number; maxAttempts: number; retryDays: number;
  reminders: { enabled: boolean; offsets: Record<ReminderStep, number> };
  activationPolicy: 'first_payment' | 'mandate';
  issuer: Issuer;
  /** Non-payment policy thresholds (D-28); bounded by policyProblem() in @mansora/domain. */
  standing: StandingPolicy;
}
export const DEFAULT_SETTINGS: BillingSettings = {
  invoiceLeadDays: 7, defaultDueDays: 14, maxAttempts: 3, retryDays: 3,
  reminders: { enabled: true, offsets: { upcoming: -3, due: 0, overdue_1: 3, overdue_2: 7, escalate: 14, review: 30 } },
  activationPolicy: 'first_payment',
  standing: DEFAULT_STANDING_POLICY,
  issuer: { name: 'Mansora Consulting and Business Solutions', address: '', phone: '', email: '', tin: '', paymentInstructions: 'Pay using the secure link, or contact Mansora billing support.' },
};
export async function loadSettings(q: Query): Promise<BillingSettings> {
  const [r] = await q(`SELECT value FROM billing_settings WHERE key = 'settings'`);
  const s = r ? JSON.parse(r.value) : {};
  return { ...DEFAULT_SETTINGS, ...s, reminders: { ...DEFAULT_SETTINGS.reminders, ...s.reminders, offsets: { ...DEFAULT_SETTINGS.reminders.offsets, ...s.reminders?.offsets } }, issuer: { ...DEFAULT_SETTINGS.issuer, ...s.issuer }, standing: { ...DEFAULT_SETTINGS.standing, ...s.standing } };
}
export async function saveSettings(q: Query, s: BillingSettings): Promise<void> {
  await q(`INSERT INTO billing_settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(s)]);
}
