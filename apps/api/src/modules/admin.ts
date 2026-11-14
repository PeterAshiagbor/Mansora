import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ONBOARDING_STEPS, zCalendarDate, zDateRange } from '@mansora/domain';
import type { Query } from '../db';
import { hashPassword, httpError, newActivationCode, newToken, RateLimiter, sha256, verifyLoginPassword, adminTotpKey, base32, decryptTotpSecret, encryptTotpSecret, matchTotp, newRecoveryCode, normaliseRecoveryCode } from '../security';
import type { AppContext } from '../app';

interface Admin {
  id: string;
  name: string;
  email: string;
}

const zId = z.object({ id: z.string().uuid() });
const text = (max = 200) => z.string().trim().min(1).max(max);
const optText = (max = 200) => z.string().trim().max(max).nullish().transform((v) => v || null);
const zDate = zCalendarDate;
const SESSION_HOURS = 12;

const audit = (q: Query, admin: Admin | null, action: string, tenantId: string | null, detail: Record<string, unknown> = {}) =>
  q(`INSERT INTO admin_audit_logs (id, admin_id, action, tenant_id, detail) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), admin?.id ?? null, action, tenantId, JSON.stringify(detail)]);

export async function createAdmin(q: Query, input: { email: string; name: string; password: string }): Promise<string> {
  if (input.password.length < 12) throw new Error('Administrator passwords must be at least 12 characters');
  const id = randomUUID();
  await q(`INSERT INTO admins (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`, [id, input.email.trim().toLowerCase(), input.name, hashPassword(input.password)]);
  return id;
}

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const ipLimiter = new RateLimiter(30, 5 * 60_000);
  const loginLimiter = new RateLimiter(8, 5 * 60_000);

  async function admin(req: FastifyRequest): Promise<Admin> {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Please sign in');
    const [row] = await db.platform((q) =>
      q<Admin>(`SELECT a.id, a.name, a.email FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'`, [sha256(header.slice(7))]),
    );
    return row ?? httpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }

  type Totp = {
    admin_id: string; secret_encrypted: string | null; enabled_at: string | null; last_used_step: number;
    pending_secret_encrypted: string | null; pending_expires_at: string | null;
    failed_attempts: number; attempts_reset_at: string | null;
  };
  const failure = (status: number, code: string, message: string) => ({ failure: { status, code, message } });
  // Failed verification/audit writes must commit before returning an HTTP error.
  const finish = (result: any) => {
    if (result.failure) httpError(result.failure.status, result.failure.code, result.failure.message);
    return result;
  };
  const unavailableCode = () => failure(401, 'INVALID_TOTP_CODE', 'Incorrect, expired or already used code');
  const limited = (factor: Totp) => factor.attempts_reset_at && Date.parse(factor.attempts_reset_at) > Date.now() && factor.failed_attempts >= 5;
  const rateLimitFailure = () => failure(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please wait five minutes and try again.');
  async function failedCode(q: Query, a: Admin, purpose: string) {
    await q(`UPDATE admin_totp SET failed_attempts = CASE WHEN attempts_reset_at > now() THEN failed_attempts + 1 ELSE 1 END,
      attempts_reset_at = CASE WHEN attempts_reset_at > now() THEN attempts_reset_at ELSE now() + interval '5 minutes' END WHERE admin_id = $1`, [a.id]);
    await audit(q, a, 'admin.totp.verification_failed', null, { purpose });
    return purpose === 'login' ? unavailableCode() : failure(400, 'INVALID_TOTP_CODE', 'Incorrect, expired or already used code');
  }
  async function factor(q: Query, id: string): Promise<Totp> {
    await q(`INSERT INTO admin_totp (admin_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
    return (await q<Totp>(`SELECT * FROM admin_totp WHERE admin_id = $1 FOR UPDATE`, [id]))[0];
  }
  async function lockedAdmin(q: Query, req: FastifyRequest): Promise<Admin & { password_hash: string }> {
    const [a] = await q(`SELECT a.* FROM admins a JOIN admin_sessions s ON s.admin_id = a.id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active' FOR UPDATE OF a`, [sha256((req.headers.authorization ?? '').slice(7))]);
    return a ?? httpError(401, 'UNAUTHENTICATED', 'Please sign in again');
  }
  async function session(q: Query, a: Admin) {
    const token = newToken();
    await q(`DELETE FROM admin_sessions WHERE expires_at < now()`);
    await q(`INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`, [sha256(token), a.id]);
    await audit(q, a, 'admin.login', null);
    return { token, admin: { id: a.id, name: a.name, email: a.email } };
  }
  async function verifyFactor(q: Query, a: Admin, f: Totp, code: string): Promise<boolean> {
    const secret = decryptTotpSecret(f.secret_encrypted!, a.id);
    const step = matchTotp(secret, code, Number(f.last_used_step));
    if (step !== null) {
      await q(`UPDATE admin_totp SET last_used_step = $2, failed_attempts = 0, attempts_reset_at = NULL WHERE admin_id = $1`, [a.id, step]);
      return true;
    }
    // A recovery code is never stored in plaintext and can be consumed only once.
    const recovery = normaliseRecoveryCode(code);
    if (!/^[A-Z2-7]{16}$/.test(recovery)) return false;
    const used = await q(`DELETE FROM admin_totp_recovery_codes WHERE admin_id = $1 AND code_hash = $2 RETURNING code_hash`, [a.id, sha256(recovery)]);
    if (!used.length) return false;
    await q(`UPDATE admin_totp SET failed_attempts = 0, attempts_reset_at = NULL WHERE admin_id = $1`, [a.id]);
    await audit(q, a, 'admin.totp.recovery_used', null);
    return true;
  }

  app.addHook('onReady', async () => {
    const [enrolled] = await db.platform((q) => q(`SELECT admin_id, secret_encrypted FROM admin_totp WHERE enabled_at IS NOT NULL LIMIT 1`));
    if (enrolled) decryptTotpSecret(enrolled.secret_encrypted, enrolled.admin_id);
  });

  app.post('/v1/admin/login', async (req) => {
    ipLimiter.check(req.ip);
    const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).parse(req.body);
    const email = body.email.toLowerCase();
    loginLimiter.check(email);
    return db.platform(async (q) => {
      // Serialise password login with enrolment and disabling for this account.
      const [a] = await q(`SELECT * FROM admins WHERE email = $1 FOR UPDATE`, [email]);
      const validPassword = await verifyLoginPassword(body.password, a?.password_hash);
      if (!a || a.status !== 'active' || !validPassword) httpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
      loginLimiter.clear(email);
      const [f] = await q<Totp>(`SELECT * FROM admin_totp WHERE admin_id = $1`, [a.id]);
      if (!f?.enabled_at) return session(q, a);
      decryptTotpSecret(f.secret_encrypted!, a.id); // fail closed if the encryption key is unavailable
      const challenge = newToken();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      await q(`DELETE FROM admin_totp_challenges WHERE admin_id = $1 OR expires_at <= now()`, [a.id]);
      await q(`INSERT INTO admin_totp_challenges (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)`, [sha256(challenge), a.id, expiresAt]);
      return { requiresTotp: true, challenge, expiresAt };
    });
  });

  app.post('/v1/admin/login/totp', async (req) => {
    ipLimiter.check(req.ip);
    const body = z.object({ challenge: z.string().min(20).max(100), code: z.string().trim().min(1).max(64) }).parse(req.body);
    return finish(await db.platform(async (q) => {
      const [candidate] = await q(`SELECT admin_id FROM admin_totp_challenges WHERE token_hash = $1`, [sha256(body.challenge)]);
      if (!candidate) return failure(401, 'INVALID_CHALLENGE', 'Sign in again to request a new code challenge');
      const [a] = await q(`SELECT * FROM admins WHERE id = $1 FOR UPDATE`, [candidate.admin_id]);
      const [challenge] = await q(`SELECT * FROM admin_totp_challenges WHERE token_hash = $1 AND expires_at > now() FOR UPDATE`, [sha256(body.challenge)]);
      if (!a || a.status !== 'active' || !challenge) return failure(401, 'INVALID_CHALLENGE', 'Sign in again to request a new code challenge');
      const f = await factor(q, a.id);
      if (!f.enabled_at) return failure(401, 'INVALID_CHALLENGE', 'Sign in again to request a new code challenge');
      if (limited(f)) return rateLimitFailure();
      if (!await verifyFactor(q, a, f, body.code)) return failedCode(q, a, 'login');
      await q(`DELETE FROM admin_totp_challenges WHERE admin_id = $1`, [a.id]);
      return session(q, a);
    }));
  });

  app.post('/v1/admin/logout', async (req) => {
    await admin(req);
    await db.platform((q) => q(`DELETE FROM admin_sessions WHERE token_hash = $1`, [sha256(req.headers.authorization!.slice(7))]));
    return { ok: true };
  });
  app.get('/v1/admin/me', async (req) => admin(req));

  // ----- Inviting administrators by email (one-time link; the new administrator chooses the password) -----
  const INVITE_HOURS = 48;
  const acceptLimiter = new RateLimiter(10, 10 * 60_000);
  app.get('/v1/admin/admins', async (req) => {
    await admin(req);
    return db.platform(async (q) => ({
      admins: await q(`SELECT a.id, a.name, a.email, a.status, a.created_at, (t.enabled_at IS NOT NULL) AS two_factor FROM admins a LEFT JOIN admin_totp t ON t.admin_id = a.id ORDER BY a.name`),
      invitations: await q(`SELECT id, name, email, expires_at, created_at FROM admin_invitations WHERE used_at IS NULL AND expires_at > now() ORDER BY created_at DESC`),
    }));
  });
  app.post('/v1/admin/admins/invitations', async (req) => {
    const a = await admin(req);
    const body = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email().max(200) }).parse(req.body);
    const email = ctx.email;
    if (!email || !email.configured()) return httpError(503, 'EMAIL_UNAVAILABLE', 'Email is not set up on this server, so invitations cannot be sent.');
    if (!ctx.adminUrl) return httpError(503, 'ADMIN_URL_UNKNOWN', 'Set ADMIN_PUBLIC_URL so invitation links point at the administration dashboard.');
    const token = newToken();
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_HOURS * 3_600_000).toISOString();
    await db.platform(async (q) => {
      if ((await q(`SELECT 1 FROM admins WHERE email = $1`, [body.email])).length) httpError(409, 'ALREADY_ADMIN', 'That person already has an administrator account.');
      await q(`INSERT INTO admin_invitations (id, email, name, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)`, [id, body.email, body.name, sha256(token), expiresAt, a.id]);
    });
    const link = `${ctx.adminUrl}#admin-invite=${token}`;
    const until = new Date(expiresAt).toUTCString().replace(' GMT', ' (Ghana time)');
    try {
      await email.send({ to: body.email, subject: 'You have been invited to administer Mansora', idempotencyKey: `mansora-admin-invite/${id}`, body: [
        `Hello ${body.name},`, '',
        `${a.name} has invited you to become a Mansora administrator. Administrators manage client businesses, onboarding, billing and support for the Mansora Sales & Stock platform.`, '',
        `Open this private link to choose your password: ${link}`, '',
        `The link works once and expires on ${until}. After signing in, set up two-factor authentication under Account security.`, '',
        'If you did not expect this invitation, ignore this email.',
      ].join('\n') });
    } catch {
      await db.platform((q) => q(`UPDATE admin_invitations SET used_at = now() WHERE id = $1`, [id]));
      return httpError(502, 'EMAIL_FAILED', 'The invitation email could not be sent. Check the email settings and try again.');
    }
    await db.platform(async (q) => {
      // A new invitation replaces earlier unused ones for the same address, but only once it has actually been sent.
      await q(`UPDATE admin_invitations SET used_at = now() WHERE email = $1 AND used_at IS NULL AND id <> $2`, [body.email, id]);
      await audit(q, a, 'admin.invited', null, { invitationId: id, name: body.name });
    });
    return { id, expiresAt };
  });
  app.post('/v1/admin/admins/invitations/:id/cancel', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const done = await db.platform((q) => q(`UPDATE admin_invitations SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [id]));
    if (done.length) await db.platform((q) => audit(q, a, 'admin.invitation_cancelled', null, { invitationId: id }));
    return { ok: true };
  });
  app.post('/v1/admin/invitations/accept', async (req) => {
    acceptLimiter.check(req.ip);
    const body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().min(12, 'Choose a password of at least 12 characters').max(200) }).parse(req.body);
    return db.platform(async (q) => {
      const [inv] = await q(`SELECT * FROM admin_invitations WHERE token_hash = $1 FOR UPDATE`, [sha256(body.token)]);
      if (!inv || inv.used_at || Date.parse(inv.expires_at) <= Date.now()) httpError(410, 'INVITATION_UNAVAILABLE', 'This invitation link is not valid, has expired or was already used. Ask an administrator to send a new one.');
      if ((await q(`SELECT 1 FROM admins WHERE email = $1`, [inv.email])).length) httpError(409, 'ALREADY_ADMIN', 'This administrator account already exists. Sign in instead.');
      await q(`UPDATE admin_invitations SET used_at = now() WHERE id = $1`, [inv.id]);
      const adminId = await createAdmin(q, { email: inv.email, name: inv.name, password: body.password });
      await q(`INSERT INTO admin_audit_logs (id, admin_id, action, detail) VALUES ($1, $2, 'admin.invitation_accepted', $3)`, [randomUUID(), adminId, JSON.stringify({ invitationId: inv.id, invitedBy: inv.created_by })]);
      return { email: inv.email };
    });
  });
  app.get('/v1/admin/totp', async (req) => {
    const a = await admin(req);
    return db.platform(async (q) => {
      const [f] = await q<Totp>(`SELECT * FROM admin_totp WHERE admin_id = $1`, [a.id]);
      const [remaining] = await q(`SELECT COUNT(*) AS count FROM admin_totp_recovery_codes WHERE admin_id = $1`, [a.id]);
      return { enabled: !!f?.enabled_at, recoveryCodesRemaining: remaining.count };
    });
  });

  app.post('/v1/admin/totp/enrol', async (req) => {
    await admin(req);
    const body = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    adminTotpKey();
    return finish(await db.platform(async (q) => {
      const a = await lockedAdmin(q, req);
      const f = await factor(q, a.id);
      if (f.enabled_at) return failure(409, 'TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
      if (limited(f)) return rateLimitFailure();
      if (!await verifyLoginPassword(body.password, a.password_hash)) return failedCode(q, a, 'enrol_password');
      const secret = base32(randomBytes(20));
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      await q(`UPDATE admin_totp SET pending_secret_encrypted = $2, pending_expires_at = $3 WHERE admin_id = $1`, [a.id, encryptTotpSecret(secret, a.id), expiresAt]);
      await audit(q, a, 'admin.totp.enrolment_started', null);
      const issuer = 'Mansora';
      return { secret, uri: `otpauth://totp/${encodeURIComponent(`${issuer}:${a.email}`)}?${new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })}`, expiresAt };
    }));
  });

  app.post('/v1/admin/totp/confirm', async (req) => {
    await admin(req);
    const body = z.object({ code: z.string().trim().min(1).max(64) }).parse(req.body);
    return finish(await db.platform(async (q) => {
      const a = await lockedAdmin(q, req);
      const f = await factor(q, a.id);
      if (f.enabled_at) return failure(409, 'TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
      if (limited(f)) return rateLimitFailure();
      if (!f.pending_secret_encrypted || !f.pending_expires_at || Date.parse(f.pending_expires_at) <= Date.now()) return failure(400, 'ENROLMENT_EXPIRED', 'Start authenticator enrolment again');
      const step = matchTotp(decryptTotpSecret(f.pending_secret_encrypted, a.id), body.code, -1);
      if (step === null) return failedCode(q, a, 'enrol_confirm');
      const recoveryCodes = Array.from({ length: 10 }, newRecoveryCode);
      await q(`DELETE FROM admin_totp_recovery_codes WHERE admin_id = $1`, [a.id]);
      for (const code of recoveryCodes) await q(`INSERT INTO admin_totp_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [a.id, sha256(normaliseRecoveryCode(code))]);
      await q(`UPDATE admin_totp SET secret_encrypted = pending_secret_encrypted, enabled_at = now(), last_used_step = $2,
        pending_secret_encrypted = NULL, pending_expires_at = NULL, failed_attempts = 0, attempts_reset_at = NULL WHERE admin_id = $1`, [a.id, step]);
      await q(`DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2`, [a.id, sha256(req.headers.authorization!.slice(7))]);
      await q(`DELETE FROM admin_totp_challenges WHERE admin_id = $1`, [a.id]);
      await audit(q, a, 'admin.totp.enabled', null);
      return { enabled: true, recoveryCodes };
    }));
  });

  app.post('/v1/admin/totp/disable', async (req) => {
    await admin(req);
    const body = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(1).max(64) }).parse(req.body);
    return finish(await db.platform(async (q) => {
      const a = await lockedAdmin(q, req);
      const f = await factor(q, a.id);
      if (!f.enabled_at) return failure(409, 'TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled');
      if (limited(f)) return rateLimitFailure();
      if (!await verifyLoginPassword(body.password, a.password_hash)) return failedCode(q, a, 'disable_password');
      if (!await verifyFactor(q, a, f, body.code)) return failedCode(q, a, 'disable_code');
      await q(`UPDATE admin_totp SET secret_encrypted = NULL, enabled_at = NULL, last_used_step = -1,
        pending_secret_encrypted = NULL, pending_expires_at = NULL WHERE admin_id = $1`, [a.id]);
      await q(`DELETE FROM admin_totp_recovery_codes WHERE admin_id = $1`, [a.id]);
      await q(`DELETE FROM admin_totp_challenges WHERE admin_id = $1`, [a.id]);
      await q(`DELETE FROM admin_sessions WHERE admin_id = $1`, [a.id]);
      await audit(q, a, 'admin.totp.disabled', null);
      return { enabled: false, signInAgain: true };
    }));
  });

  // ----- Module C: service plans -----
  const planBody = z.object({
    name: text(80), price: z.number().int().nonnegative(), billingPeriod: z.enum(['monthly', 'quarterly', 'yearly']), includedSupport: z.string().max(1000).default(''), active: z.boolean().default(true),
    description: z.string().max(1000).default(''), category: z.enum(['subscription', 'support', 'consultancy', 'managed']).default('subscription'),
    annualPrice: z.number().int().nonnegative().nullish().transform((v) => v ?? null), trialDays: z.number().int().min(0).max(365).default(0), setupFee: z.number().int().nonnegative().default(0),
    effectiveFrom: zDate.nullish().transform((v) => v ?? null), renewalPolicy: z.string().max(500).default(''), cancellationPolicy: z.string().max(500).default(''),
    addons: z.array(z.object({ name: z.string().trim().min(1).max(80), price: z.number().int().nonnegative() })).max(20).default([]),
  });
  const planValues = (b: z.infer<typeof planBody>) => [b.name, b.price, b.billingPeriod, b.includedSupport, b.active, b.description, b.category, b.annualPrice, b.trialDays, b.setupFee, b.effectiveFrom, b.renewalPolicy, b.cancellationPolicy, JSON.stringify(b.addons)];
  app.get('/v1/admin/plans', async (req) => {
    await admin(req);
    return db.platform((q) => q(`SELECT p.*, (SELECT COUNT(*) FROM client_subscriptions s WHERE s.plan_id = p.id AND s.status IN ('trial','active')) AS active_clients FROM service_plans p ORDER BY p.price`));
  });
  app.post('/v1/admin/plans', async (req) => {
    const a = await admin(req);
    const b = planBody.parse(req.body);
    const id = randomUUID();
    await db.platform(async (q) => {
      await q(`INSERT INTO service_plans (id, name, price, billing_period, included_support, active, description, category, annual_price, trial_days, setup_fee, effective_from, renewal_policy, cancellation_policy, addons)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, [id, ...planValues(b)]);
      await audit(q, a, 'plan.created', null, { id, ...b });
    });
    return { id };
  });
  app.put('/v1/admin/plans/:id', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const b = planBody.parse(req.body);
    await db.platform(async (q) => {
      const r = await q(`UPDATE service_plans SET name = $2, price = $3, billing_period = $4, included_support = $5, active = $6, description = $7, category = $8, annual_price = $9, trial_days = $10, setup_fee = $11,
        effective_from = $12, renewal_policy = $13, cancellation_policy = $14, addons = $15 WHERE id = $1 RETURNING id`, [id, ...planValues(b)]);
      if (!r.length) httpError(404, 'NOT_FOUND', 'Plan not found');
      await audit(q, a, 'plan.updated', null, { id, ...b });
    });
    return { id };
  });

  // ----- Module A: client directory -----
  const clientBody = z.object({
    name: text(120), ownerName: text(120), phone: optText(40), email: z.string().trim().email().max(200).or(z.literal('')).nullish().transform((v) => v || null),
    address: optText(300), businessType: text(60).default('retail'), supportContact: optText(120),
  });
  const HEALTH = `
    (SELECT COUNT(*) FROM onboarding_steps o WHERE o.tenant_id = t.id AND o.completed_at IS NOT NULL) AS steps_done,
    d.id AS device_id, d.name AS device_name, d.app_version, d.last_seen_at, d.last_sync_at, d.pending_count, d.last_backup_at,
    s.status AS subscription_status, s.renewal_date, p.name AS plan_name, p.id AS plan_id`;
  const HEALTH_JOIN = `LEFT JOIN devices d ON d.tenant_id = t.id AND d.status = 'active' LEFT JOIN client_subscriptions s ON s.tenant_id = t.id LEFT JOIN service_plans p ON p.id = s.plan_id`;
  const withHealth = (row: any) => ({
    ...row,
    steps_total: ONBOARDING_STEPS.length,
    // "Connected" means the laptop has been heard from recently. A quiet laptop may simply be offline - its data may be incomplete here.
    connectivity: !row.device_id ? 'no_device' : row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) < 15 * 60_000 ? 'online' : 'offline',
    data_may_be_incomplete: !row.device_id || (row.pending_count ?? 0) > 0 || !row.last_sync_at || Date.now() - Date.parse(row.last_sync_at) > 24 * 3_600_000,
  });

  app.get('/v1/admin/clients', async (req) => {
    await admin(req);
    return (await db.platform((q) => q(`SELECT t.*, ${HEALTH} FROM tenants t ${HEALTH_JOIN} ORDER BY t.created_at DESC`))).map(withHealth);
  });
  app.post('/v1/admin/clients', async (req) => {
    const a = await admin(req);
    const b = clientBody.extend({ planId: z.string().uuid().nullish() }).parse(req.body);
    const id = randomUUID();
    await db.platform(async (q) => {
      await q(`INSERT INTO tenants (id, name, owner_name, phone, email, address, business_type, support_contact) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, b.name, b.ownerName, b.phone, b.email, b.address, b.businessType, b.supportContact ?? a.name]);
      for (const [step] of ONBOARDING_STEPS) {
        const done = step === 'create_account';
        await q(`INSERT INTO onboarding_steps (tenant_id, step, completed_at, completed_by) VALUES ($1, $2, $3, $4)`, [id, step, done ? new Date().toISOString() : null, done ? a.id : null]);
      }
      // A new client starts with a draft subscription at the plan's price. It is activated through Subscriptions, which invoices it.
      if (b.planId) await q(`INSERT INTO client_subscriptions (id, tenant_id, plan_id, status, agreed_amount, billing_frequency) SELECT $1, $2, p.id, 'draft', p.price, p.billing_period FROM service_plans p WHERE p.id = $3`, [randomUUID(), id, b.planId]);
      await audit(q, a, 'client.created', id, { name: b.name });
    });
    return { id };
  });
  app.get('/v1/admin/clients/:id', async (req) => {
    await admin(req);
    const { id } = zId.parse(req.params);
    const out = await db.platform(async (q) => {
      const [client] = await q(`SELECT t.*, ${HEALTH} FROM tenants t ${HEALTH_JOIN} WHERE t.id = $1`, [id]);
      if (!client) httpError(404, 'NOT_FOUND', 'Client not found');
      return {
        client: withHealth(client),
        onboarding: await q(`SELECT o.step, o.completed_at, o.notes, a.name AS completed_by_name FROM onboarding_steps o LEFT JOIN admins a ON a.id = o.completed_by WHERE o.tenant_id = $1`, [id]),
        devices: await q(`SELECT id, name, status, app_version, last_seen_at, last_sync_at, pending_count, last_backup_at, activated_at FROM devices WHERE tenant_id = $1 ORDER BY activated_at DESC`, [id]),
        backups: await q(`SELECT id, size_bytes, status, created_at FROM backup_records WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10`, [id]),
      };
    });
    const order = ONBOARDING_STEPS.map(([s]) => s as string);
    out.onboarding.sort((x, y) => order.indexOf(x.step) - order.indexOf(y.step));
    // Grants are business data: read inside the tenant's own context. Only the grant metadata is exposed.
    const grants = await db.tenant(id, (q) => q(`SELECT id, scope, purpose, starts_at, expires_at, revoked_at FROM support_access_grants ORDER BY created_at DESC LIMIT 20`));
    return { ...out, browserWorkspaceAvailable: !!ctx.browserWorkspaces, onboarding: out.onboarding.map((o) => ({ ...o, label: ONBOARDING_STEPS.find(([s]) => s === o.step)?.[1] ?? o.step })), grants };
  });
  app.put('/v1/admin/clients/:id', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const b = clientBody.extend({ status: z.enum(['onboarding', 'active', 'suspended', 'closed']) }).parse(req.body);
    await db.platform(async (q) => {
      const r = await q(
        `UPDATE tenants SET name = $2, owner_name = $3, phone = $4, email = $5, address = $6, business_type = $7, support_contact = $8, status = $9,
           onboarded_at = CASE WHEN $9 = 'active' AND onboarded_at IS NULL THEN now() ELSE onboarded_at END WHERE id = $1 RETURNING id`,
        [id, b.name, b.ownerName, b.phone, b.email, b.address, b.businessType, b.supportContact, b.status],
      );
      if (!r.length) httpError(404, 'NOT_FOUND', 'Client not found');
      await audit(q, a, 'client.updated', id, { status: b.status, name: b.name });
    });
    return { id };
  });

  // ----- Module B: onboarding -----
  app.put('/v1/admin/clients/:id/onboarding/:step', async (req) => {
    const a = await admin(req);
    const p = z.object({ id: z.string().uuid(), step: z.enum(ONBOARDING_STEPS.map(([s]) => s) as [string, ...string[]]) }).parse(req.params);
    const b = z.object({ completed: z.boolean(), notes: optText(500) }).parse(req.body);
    await db.platform(async (q) => {
      const r = await q(`UPDATE onboarding_steps SET completed_at = $3, completed_by = $4, notes = $5 WHERE tenant_id = $1 AND step = $2 RETURNING step`, [p.id, p.step, b.completed ? new Date().toISOString() : null, b.completed ? a.id : null, b.notes]);
      if (!r.length) httpError(404, 'NOT_FOUND', 'Client not found');
      if (p.step === 'go_live' && b.completed) await q(`UPDATE tenants SET status = 'active', onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1 AND status = 'onboarding'`, [p.id]);
      await audit(q, a, 'onboarding.step', p.id, { step: p.step, completed: b.completed });
    });
    return { ok: true };
  });

  app.put('/v1/admin/clients/:id/subscription', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const b = z.object({ planId: z.string().uuid(), status: z.enum(['trial', 'active', 'past_due', 'cancelled']), renewalDate: zDate.nullish() }).parse(req.body);
    await db.platform(async (q) => {
      await q(
        // Kept for compatibility. It fills in the billing fields so a subscription set up this way can still be invoiced by the billing cycle.
        `INSERT INTO client_subscriptions (id, tenant_id, plan_id, status, renewal_date, agreed_amount, billing_frequency, billing_anchor, start_date)
         SELECT $1, $2, p.id, $4, $5::date, p.price, p.billing_period, $5::date, COALESCE($5::date, CURRENT_DATE) FROM service_plans p WHERE p.id = $3
         ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, renewal_date = EXCLUDED.renewal_date, updated_at = now(),
           -- Moving to another plan takes that plan's price; keeping the same plan keeps any agreed price.
           agreed_amount = CASE WHEN client_subscriptions.plan_id = EXCLUDED.plan_id THEN COALESCE(client_subscriptions.agreed_amount, EXCLUDED.agreed_amount) ELSE EXCLUDED.agreed_amount END, billing_frequency = EXCLUDED.billing_frequency,
           billing_anchor = COALESCE(EXCLUDED.billing_anchor, client_subscriptions.billing_anchor), start_date = COALESCE(client_subscriptions.start_date, EXCLUDED.start_date)`,
        [randomUUID(), id, b.planId, b.status, b.renewalDate ?? null],
      );
      await audit(q, a, 'subscription.updated', id, b);
    });
    return { ok: true };
  });

  const workspaceLimiter = new RateLimiter(6, 60_000);
  app.post('/v1/admin/clients/:id/browser-workspace', async (req) => {
    const a = await admin(req);
    if (!ctx.browserWorkspaces) httpError(404, 'NOT_AVAILABLE', 'Browser workspace provisioning is not available on this service.');
    workspaceLimiter.check(a.id);
    const { id } = zId.parse(req.params);
    const code = newActivationCode(), expiresAt = new Date(Date.now() + 72 * 3_600_000).toISOString();
    const tenant = await db.platform(async q => {
      const [row] = await q<{ name: string; owner_name: string; email: string | null; has_active_device: boolean }>("SELECT t.name, t.owner_name, t.email, EXISTS (SELECT 1 FROM devices d WHERE d.tenant_id = t.id AND d.status = 'active') AS has_active_device FROM tenants t WHERE t.id = $1 AND t.status <> 'closed'", [id]);
      if (!row) httpError(404, 'NOT_FOUND', 'Client not found');
      if (!row.email || !z.string().email().safeParse(row.email).success) httpError(400, 'OWNER_EMAIL_REQUIRED', 'Record the owner email on the client before creating a browser workspace.');
      await q('INSERT INTO activation_codes (code_hash, tenant_id, expires_at, created_by) VALUES ($1, $2, $3, $4)', [sha256(code), id, expiresAt, a.id]);
      return row;
    });
    const result = await ctx.browserWorkspaces!.invite({ tenantId: id, label: tenant.name, ownerName: tenant.owner_name, ownerEmail: tenant.email!, activationCode: code, hasActiveDevice: tenant.has_active_device });
    await db.platform(q => audit(q, a, 'browser_workspace.invited', id, { workspaceId: result.workspaceId, status: result.status, expiresAt: result.expiresAt }));
    return result;
  });

  // ----- device activation -----
  app.post('/v1/admin/clients/:id/activation-codes', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const code = newActivationCode();
    const expiresAt = new Date(Date.now() + 72 * 3_600_000).toISOString();
    await db.platform(async (q) => {
      if (!(await q(`SELECT 1 FROM tenants WHERE id = $1 AND status <> 'closed'`, [id])).length) httpError(404, 'NOT_FOUND', 'Client not found');
      await q(`INSERT INTO activation_codes (code_hash, tenant_id, expires_at, created_by) VALUES ($1, $2, $3, $4)`, [sha256(code), id, expiresAt, a.id]);
      await audit(q, a, 'activation_code.created', id, { expiresAt });
    });
    return { code, expiresAt }; // shown once; only its hash is stored
  });
  /**
   * Owner password recovery. The code only works on the client's own activated
   * laptop, once, within an hour. Mansora never learns or sets the password.
   */
  app.post('/v1/admin/clients/:id/recovery-codes', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const b = z.object({ reason: text(300) }).parse(req.body);
    const code = newActivationCode().replace(/^MNS/, 'REC');
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    await db.platform(async (q) => {
      if (!(await q(`SELECT 1 FROM devices WHERE tenant_id = $1 AND status = 'active'`, [id])).length) httpError(409, 'NO_ACTIVE_DEVICE', 'This client has no active laptop');
      await q(`UPDATE owner_recovery_codes SET used_at = now() WHERE tenant_id = $1 AND used_at IS NULL`, [id]); // only the newest code is valid
      await q(`INSERT INTO owner_recovery_codes (code_hash, tenant_id, expires_at, created_by) VALUES ($1, $2, $3, $4)`, [sha256(code), id, expiresAt, a.id]);
      await audit(q, a, 'owner_recovery_code.created', id, { reason: b.reason, expiresAt });
    });
    return { code, expiresAt };
  });
  app.post('/v1/admin/devices/:id/revoke', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    await db.platform(async (q) => {
      const r = await q(`UPDATE devices SET status = 'revoked' WHERE id = $1 RETURNING tenant_id`, [id]);
      if (!r.length) httpError(404, 'NOT_FOUND', 'Device not found');
      await audit(q, a, 'device.revoked', r[0].tenant_id, { deviceId: id });
    });
    return { ok: true };
  });

  // ----- Module E: consent-based access to a client's reports -----
  app.get('/v1/admin/clients/:id/reports/summary', async (req) => {
    const a = await admin(req);
    const { id } = zId.parse(req.params);
    const range = zDateRange().parse(req.query);
    const result = await db.tenant(id, async (q) => {
      const [grant] = await q(`SELECT id, purpose, expires_at FROM support_access_grants WHERE scope = 'reports' AND revoked_at IS NULL AND starts_at <= now() AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`);
      if (!grant) return null;
      const p = [`${range.from}T00:00:00Z`, `${range.to}T23:59:59.999Z`];
      const [sales] = await q(`SELECT COUNT(*) AS count, COALESCE(SUM(total), 0)::bigint AS gross, COALESCE(SUM(discount_total), 0)::bigint AS discounts FROM sales WHERE created_at BETWEEN $1 AND $2`, p);
      const [refunds] = await q(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM refunds WHERE created_at BETWEEN $1 AND $2`, p);
      const payments = await q(`SELECT p.method, SUM(p.amount)::bigint AS total FROM payments p JOIN sales s ON s.tenant_id = p.tenant_id AND s.id = p.sale_id WHERE s.created_at BETWEEN $1 AND $2 GROUP BY p.method ORDER BY 2 DESC`, p);
      const top = await q(`SELECT i.product_name AS name, SUM(i.quantity)::bigint AS quantity, SUM(i.line_total)::bigint AS revenue FROM sale_items i JOIN sales s ON s.tenant_id = i.tenant_id AND s.id = i.sale_id WHERE s.created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 3 DESC LIMIT 10`, p);
      const [stock] = await q(`SELECT COUNT(*) AS products, COALESCE(SUM(CASE WHEN b.quantity <= p.reorder_level THEN 1 ELSE 0 END), 0)::bigint AS low FROM products p JOIN stock_balances b ON b.tenant_id = p.tenant_id AND b.product_id = p.id WHERE p.active = 1`);
      await q(`INSERT INTO support_access_log (tenant_id, id, admin_id, admin_name, grant_id, action) VALUES ($1, $2, $3, $4, $5, $6)`, [id, randomUUID(), a.id, a.name, grant.id, `Viewed sales summary ${range.from} to ${range.to}`]);
      return { grant, sales: { ...sales, refunds: refunds.total, net: sales.gross - refunds.total }, payments, topProducts: top, stock };
    });
    await db.platform((q) => audit(q, a, result ? 'support.report_viewed' : 'support.access_denied', id, { ...range, grantId: result?.grant.id ?? null }));
    if (!result) httpError(403, 'SUPPORT_ACCESS_DENIED', 'The business owner has not granted access to their reports (or the access has expired).');
    const [health] = await db.platform((q) => q(`SELECT last_sync_at, pending_count FROM devices WHERE tenant_id = $1 AND status = 'active'`, [id]));
    return { ...result, range, syncedUpTo: health?.last_sync_at ?? null, unsyncedOnDevice: health?.pending_count ?? null };
  });

  // ----- Module F: Mansora's own reporting (no client financial data) -----
  app.get('/v1/admin/overview', async (req) => {
    await admin(req);
    return db.platform(async (q) => ({
      clientsByStatus: await q(`SELECT status, COUNT(*) AS count FROM tenants GROUP BY status`),
      subscriptionsByStatus: await q(`SELECT s.status, COUNT(*) AS count FROM client_subscriptions s GROUP BY s.status`),
      plans: await q(`SELECT p.name, COUNT(s.id) AS clients FROM service_plans p LEFT JOIN client_subscriptions s ON s.plan_id = p.id AND s.status IN ('trial','active') GROUP BY p.name ORDER BY 2 DESC`),
      renewalsDue: await q(`SELECT t.id, t.name, s.renewal_date, s.status, p.name AS plan_name FROM client_subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN service_plans p ON p.id = s.plan_id WHERE s.renewal_date IS NOT NULL AND s.renewal_date <= CURRENT_DATE + 30 AND s.status <> 'cancelled' ORDER BY s.renewal_date`),
      onboarding: await q(`SELECT t.id, t.name, COUNT(o.completed_at) AS done, COUNT(*) AS total FROM tenants t JOIN onboarding_steps o ON o.tenant_id = t.id WHERE t.status = 'onboarding' GROUP BY t.id, t.name ORDER BY t.name`),
      needsAttention: await q(
        `SELECT t.id, t.name, d.last_sync_at, d.pending_count, d.last_backup_at FROM tenants t LEFT JOIN devices d ON d.tenant_id = t.id AND d.status = 'active'
         WHERE t.status = 'active' AND (d.id IS NULL OR d.last_sync_at IS NULL OR d.last_sync_at < now() - interval '48 hours' OR d.last_backup_at IS NULL OR d.last_backup_at < now() - interval '7 days') ORDER BY t.name`,
      ),
    }));
  });
  // ----- C34: which live shops are actually using the till (counts only, never amounts) -----
  app.get('/v1/admin/activity', async (req) => {
    await admin(req);
    return db.platform((q) => q(`SELECT t.id, t.name, t.status, d.last_sync_at, d.last_sale_at,
        CASE WHEN d.activity_day = (now() AT TIME ZONE 'UTC')::date THEN d.sales_today ELSE 0 END AS sales_today,
        CASE WHEN d.activity_day = (now() AT TIME ZONE 'UTC')::date THEN d.staff_active_today ELSE 0 END AS staff_active_today,
        CASE WHEN d.id IS NULL THEN 'no_device' WHEN d.last_sale_at IS NULL THEN 'never_sold'
             WHEN d.last_sale_at < now() - interval '7 days' THEN 'quiet' WHEN d.last_sale_at < now() - interval '2 days' THEN 'slowing' ELSE 'active' END AS usage
      FROM tenants t LEFT JOIN devices d ON d.tenant_id = t.id AND d.status = 'active'
      WHERE t.status IN ('onboarding', 'active', 'suspended') ORDER BY d.last_sale_at DESC NULLS LAST, t.name`));
  });
  app.get('/v1/admin/audit', async (req) => {
    await admin(req);
    const { tenantId } = z.object({ tenantId: z.string().uuid().optional() }).parse(req.query);
    return db.platform((q) =>
      q(
        `SELECT l.id, l.action, l.detail, l.occurred_at, a.name AS admin_name, t.name AS tenant_name FROM admin_audit_logs l LEFT JOIN admins a ON a.id = l.admin_id LEFT JOIN tenants t ON t.id = l.tenant_id
         ${tenantId ? 'WHERE l.tenant_id = $1' : ''} ORDER BY l.occurred_at DESC LIMIT 300`,
        tenantId ? [tenantId] : [],
      ),
    );
  });
}
