import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ALL_PERMISSIONS, fail, PERMISSIONS, ROLE_DEFAULTS, ROLES, sanitisePermissions } from '@mansora/domain';
import { defineCommands, empty, zId, zOptText, zText, type Ctx } from '../engine';
import { checkPasswordStrength, hashPassword } from '../passwords';
import { importSnapshot } from '../restore';

const zPassword = z.string().min(1).max(200);
const zUsername = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores');

function business(ctx: Ctx) {
  const m = (k: string) => ctx.setting(k) ?? '';
  return {
    activated: ctx.engine.activated,
    tenantId: m('tenant_id'),
    name: m('business_name'),
    phone: m('business_phone'),
    address: m('business_address'),
    receiptFooter: m('receipt_footer'),
    lockMinutes: Number(m('lock_minutes') || 10),
    allowNegativeStock: m('allow_negative_stock') === '1',
    /** 0 = no ceiling. Discounts above this share of the basket need the owner. */
    maxDiscountBps: Number(m('max_discount_bps') || 0),
    currency: 'GHS',
  };
}

async function deviceCall(ctx: Ctx, path: string, payload: unknown, offlineMessage: string): Promise<any> {
  let res: Response;
  try {
    res = await ctx.engine.fetch(`${ctx.setting('api_url')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.setting('device_token')}` },
      body: JSON.stringify(payload),
    });
  } catch {
    fail('OFFLINE', offlineMessage);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.code ?? 'REQUEST_FAILED', body.message ?? 'The server refused the request');
  return body;
}

function strongPassword(pw: string): string {
  const problem = checkPasswordStrength(pw);
  if (problem) fail('WEAK_PASSWORD', problem);
  return hashPassword(pw);
}

export const authCommands = defineCommands({
  'app.state': {
    perm: 'public',
    input: empty,
    run: (ctx) => ({ business: business(ctx), user: ctx.actor, appVersion: ctx.engine.appVersion, permissions: PERMISSIONS, roleDefaults: ROLE_DEFAULTS }),
  },

  /** One-time online activation with a code issued by Mansora. Creates the owner login. */
  'activation.activate': {
    perm: 'public',
    async: true,
    input: z.object({
      apiUrl: z.string().url().max(300),
      code: zText(64),
      deviceName: zText(80),
      owner: z.object({ name: zText(100), username: zUsername, password: zPassword }),
      /** Replacement laptop with no backup file: load this business's synced records from the cloud. */
      restoreFromCloud: z.boolean().default(false),
    }),
    run: async (ctx, input) => {
      if (ctx.engine.activated) fail('ALREADY_ACTIVATED', 'This laptop is already activated');
      const passwordHash = strongPassword(input.owner.password);
      const apiUrl = input.apiUrl.replace(/\/+$/, '');
      if (!/^https:\/\//.test(apiUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiUrl)) fail('INSECURE_URL', 'The server address must use https://');
      let res: Response;
      try {
        res = await ctx.engine.fetch(`${apiUrl}/v1/devices/activate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: input.code, deviceName: input.deviceName, appVersion: ctx.engine.appVersion }),
        });
      } catch {
        fail('OFFLINE', 'Could not reach the Mansora server. Activation needs an internet connection.');
      }
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) fail(body.code ?? 'ACTIVATION_FAILED', body.message ?? 'Activation failed');
      let snapshot: Record<string, unknown> | null = null;
      if (input.restoreFromCloud) {
        const snap = await ctx.engine.fetch(`${apiUrl}/v1/sync/snapshot`, { headers: { authorization: `Bearer ${body.deviceToken}` } }).catch(() => null);
        if (!snap?.ok) fail('RESTORE_FAILED', 'The laptop was activated on the server but its records could not be downloaded. Ask Mansora for a new activation code and try again.');
        snapshot = ((await snap.json()) as any).tables;
      }
      ctx.tx(() => {
        const e = ctx.engine;
        e.setMeta('api_url', apiUrl);
        e.setMeta('device_id', body.deviceId);
        e.setMeta('tenant_id', body.tenant.id);
        e.setMeta('business_name', body.tenant.name);
        e.setMeta('business_phone', body.tenant.phone ?? '');
        e.setMeta('business_address', body.tenant.address ?? '');
        e.setMeta('activated_at', ctx.now());
        const restored = snapshot ? importSnapshot(ctx, snapshot) : null;
        const owner = { username: input.owner.username, name: input.owner.name, updated_at: ctx.now() };
        if (restored?.ownerId) {
          // The person activating takes over the existing owner record, so history stays attached to one owner.
          ctx.update('users', restored.ownerId, { ...owner, status: 'active' });
          ctx.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, restored.ownerId);
        } else {
          ctx.insert('users', { id: ctx.id(), ...owner, role: 'owner', status: 'active', permissions: JSON.stringify(ALL_PERMISSIONS), password_hash: passwordHash, created_at: ctx.now() });
        }
        if (restored) e.setMeta('restored_from_cloud_at', ctx.now());
        ctx.audit('device', body.deviceId, { deviceName: input.deviceName, restoredRows: restored?.rows ?? 0 }, restored ? 'device.restored_from_cloud' : 'device.activated');
        ctx.flush();
        e.setMeta('device_token', body.deviceToken); // last: marks activation complete
      });
      return business(ctx);
    },
  },

  'auth.login': {
    perm: 'public',
    input: z.object({ username: z.string().min(1).max(100), password: zPassword }),
    run: (ctx, input) => {
      if (!ctx.engine.activated) fail('NOT_ACTIVATED', 'This laptop has not been activated yet');
      const user = ctx.engine.verifyCredentials(input.username, input.password);
      const token = ctx.engine.createSession(user.id);
      return { token, user };
    },
  },
  'auth.logout': { perm: 'public', input: empty, run: () => ({ ok: true }) },

  /**
   * Forgotten owner password. Needs a one-time code from Mansora, which the
   * server only honours for this business's own activated laptop. The new
   * password is chosen here and never leaves the laptop.
   */
  'auth.recoverOwner': {
    perm: 'public',
    async: true,
    input: z.object({ code: zText(64), newPassword: zPassword }),
    run: async (ctx, input) => {
      if (!ctx.engine.activated) fail('NOT_ACTIVATED', 'This laptop has not been activated yet');
      const passwordHash = strongPassword(input.newPassword);
      const body = await deviceCall(ctx, '/v1/devices/owner-recovery', { code: input.code }, 'Password recovery needs an internet connection.');
      void body;
      return ctx.tx(() => {
        const owner = ctx.get(`SELECT id, username FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`);
        if (!owner) fail('NOT_FOUND', 'No owner account exists on this laptop');
        ctx.run(`UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, status = 'active', updated_at = ? WHERE id = ?`, passwordHash, ctx.now(), owner.id);
        ctx.engine.endSessionsFor(owner.id);
        ctx.audit('user', owner.id, {}, 'owner.password_recovered');
        ctx.flush();
        return { username: owner.username as string };
      });
    },
  },

  /**
   * Give this laptop a new identity with the server, keeping all local data.
   * Used after restoring a backup when the old laptop was lost and deactivated.
   */
  'device.relink': {
    perm: 'settings.manage',
    async: true,
    input: z.object({ code: zText(64), deviceName: zText(80) }),
    run: async (ctx, input) => {
      if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can re-link this laptop');
      let res: Response;
      try {
        res = await ctx.engine.fetch(`${ctx.setting('api_url')}/v1/devices/activate`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: input.code, deviceName: input.deviceName, appVersion: ctx.engine.appVersion, expectTenantId: ctx.setting('tenant_id') }),
        });
      } catch {
        fail('OFFLINE', 'Re-linking needs an internet connection.');
      }
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) fail(body.code ?? 'ACTIVATION_FAILED', body.message ?? 'Re-linking failed');
      ctx.tx(() => {
        ctx.engine.setMeta('device_id', body.deviceId);
        ctx.engine.setMeta('device_token', body.deviceToken);
        ctx.audit('device', body.deviceId, { deviceName: input.deviceName }, 'device.relinked');
        ctx.flush();
      });
      return { deviceId: body.deviceId as string };
    },
  },
  'auth.changePassword': {
    perm: 'auth',
    mutates: true,
    input: z.object({ current: zPassword, next: zPassword }),
    run: (ctx, input) => {
      ctx.engine.verifyCredentials(ctx.user.username, input.current);
      ctx.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', strongPassword(input.next), ctx.now(), ctx.user.id);
      ctx.audit('user', ctx.user.id, {}, 'user.password_changed');
      return { ok: true };
    },
  },

  'business.update': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({
      name: zText(120), phone: zOptText(40), address: zOptText(300), receiptFooter: zOptText(300),
      lockMinutes: z.number().int().min(1).max(240), allowNegativeStock: z.boolean(),
      maxDiscountPercent: z.number().int().min(0).max(100).default(0),
    }),
    run: (ctx, input) => {
      const e = ctx.engine;
      const before = business(ctx);
      if (input.allowNegativeStock !== before.allowNegativeStock && ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can change the negative-stock policy');
      if (input.maxDiscountPercent * 100 !== before.maxDiscountBps && ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can change the discount limit');
      e.setMeta('business_name', input.name);
      e.setMeta('business_phone', input.phone ?? '');
      e.setMeta('business_address', input.address ?? '');
      e.setMeta('receipt_footer', input.receiptFooter ?? '');
      e.setMeta('lock_minutes', String(input.lockMinutes));
      e.setMeta('allow_negative_stock', input.allowNegativeStock ? '1' : '0');
      e.setMeta('max_discount_bps', String(input.maxDiscountPercent * 100));
      ctx.audit('business', before.tenantId, { before, after: input });
      return business(ctx);
    },
  },

  'staff.list': {
    perm: 'staff.manage',
    input: empty,
    run: (ctx) => ctx.all(`SELECT u.id, u.username, u.name, u.role, u.status, u.permissions, u.created_at, u.email,
      (SELECT expires_at FROM staff_invites i WHERE i.user_id = u.id AND i.used_at IS NULL AND i.expires_at > ?) AS invite_expires_at
      FROM users u ORDER BY u.name`, ctx.now()).map((u) => ({ ...u, permissions: JSON.parse(u.permissions) })),
  },
  'staff.save': {
    perm: 'staff.manage',
    mutates: true,
    input: z.object({
      id: zId.optional(), name: zText(100), username: zUsername, role: z.enum(ROLES), status: z.enum(['active', 'disabled']).default('active'),
      permissions: z.array(z.string()).optional(), password: zPassword.optional(),
      /** Optional address for emailing a one-time sign-in code (staff.invite). Kept on this device only. */
      email: z.string().trim().toLowerCase().email().max(160).nullish().or(z.literal('').transform(() => null)),
    }),
    run: (ctx, input) => {
      const now = ctx.now();
      const existing = input.id ? ctx.get('SELECT * FROM users WHERE id = ?', input.id) : null;
      if (input.id && !existing) fail('NOT_FOUND', 'Staff member not found');
      // Ownership is never created or transferred through ordinary staff management.
      if ((existing?.role === 'owner') !== (input.role === 'owner')) fail('OWNER_PROTECTED', 'The owner role cannot be assigned or removed here');
      if (existing?.role === 'owner' && input.status !== 'active') fail('OWNER_PROTECTED', 'The owner account cannot be disabled');
      const permissions = JSON.stringify(sanitisePermissions(input.role, input.permissions ?? ROLE_DEFAULTS[input.role]));
      const id = existing?.id ?? ctx.id();
      if (existing) {
        ctx.update('users', id, { name: input.name, username: input.username, role: input.role, status: input.status, permissions, updated_at: now });
        if (input.email !== undefined) ctx.run('UPDATE users SET email = ? WHERE id = ?', input.email, id);
        if (input.password) ctx.run('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', strongPassword(input.password), id);
        if (input.status !== 'active' || input.password) ctx.engine.endSessionsFor(id);
      } else {
        if (!input.password && !input.email) fail('INVALID_INPUT', 'Give new staff a password, or an email address to send them a sign-in code');
        ctx.insert('users', {
          id, username: input.username, name: input.name, role: input.role, status: input.status, permissions,
          // Without a password the account cannot sign in until its emailed code is used.
          password_hash: input.password ? strongPassword(input.password) : hashPassword(randomBytes(32).toString('hex')), created_at: now, updated_at: now,
        });
        if (input.email) ctx.run('UPDATE users SET email = ? WHERE id = ?', input.email, id);
      }
      ctx.audit('user', id, { name: input.name, role: input.role, status: input.status, permissions: JSON.parse(permissions), passwordReset: !!input.password && !!existing, emailRecorded: input.email === undefined ? undefined : !!input.email });
      return { id };
    },
  },

  /**
   * Email a staff member a one-time sign-in code so they choose their own password.
   * The password itself is never emailed: it is stored only as a hash and could not be.
   * The code works once, for 48 hours, and only a hash of it is kept on this device.
   * Mansora's server sends the email straight away and does not store the code.
   */
  'staff.invite': {
    perm: 'staff.manage',
    async: true,
    input: z.object({ userId: zId }),
    run: async (ctx, input) => {
      const user = ctx.get('SELECT id, username, name, role, status, email FROM users WHERE id = ?', input.userId);
      if (!user) fail('NOT_FOUND', 'Staff member not found');
      if (user.role === 'owner') fail('OWNER_PROTECTED', 'Owners reset their own password from the sign-in screen, or with a code from Mansora');
      if (user.status !== 'active') fail('ACCOUNT_DISABLED', 'Activate this account before sending sign-in details');
      if (!user.email) fail('EMAIL_REQUIRED', 'Add an email address for this staff member first');
      const code = newInviteCode();
      const now = ctx.now();
      const expiresAt = new Date(ctx.engine.now().getTime() + INVITE_HOURS * 3_600_000).toISOString();
      const previous = ctx.get('SELECT * FROM staff_invites WHERE user_id = ?', user.id);
      ctx.tx(() => {
        ctx.run(`INSERT INTO staff_invites (user_id, code_hash, expires_at, attempts, created_by, created_at, used_at) VALUES (?, ?, ?, 0, ?, ?, NULL)
          ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_by = excluded.created_by, created_at = excluded.created_at, used_at = NULL`,
          user.id, inviteHash(code), expiresAt, ctx.user.id, now);
      });
      try {
        await deviceCall(ctx, '/v1/devices/staff-invitations', { to: user.email, staffName: user.name, username: user.username, businessName: ctx.setting('business_name') ?? '', code, expiresAt },
          'Sending sign-in details needs an internet connection. Try again when online, or set a password for them yourself.');
      } catch (error) {
        // The unsent code is useless: put back any earlier code the person may already have, or remove the row.
        ctx.tx(() => {
          ctx.run('DELETE FROM staff_invites WHERE user_id = ? AND code_hash = ?', user.id, inviteHash(code));
          if (previous) ctx.run('INSERT OR IGNORE INTO staff_invites (user_id, code_hash, expires_at, attempts, created_by, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            previous.user_id, previous.code_hash, previous.expires_at, previous.attempts, previous.created_by, previous.created_at, previous.used_at);
        });
        throw error;
      }
      ctx.tx(() => { ctx.audit('user', user.id, { emailedSignInCode: true, expiresAt }, 'staff.invite'); ctx.flush(); });
      return { sentTo: maskEmail(user.email), expiresAt };
    },
  },

  /** A staff member uses their emailed code to choose a password. Five wrong codes cancel the invitation. */
  'auth.acceptInvite': {
    perm: 'public',
    async: true,
    input: z.object({ username: z.string().trim().min(1).max(100), code: z.string().trim().min(4).max(40), newPassword: zPassword }),
    run: async (ctx, input) => {
      const invalid = () => fail('INVALID_INVITE', 'That code is not valid, has expired or was already used. Ask the owner to send a new one.');
      const user = ctx.get('SELECT id, username, status FROM users WHERE username = ?', input.username);
      const invite = user ? ctx.get('SELECT * FROM staff_invites WHERE user_id = ?', user.id) : undefined;
      if (!user || !invite || invite.used_at || invite.expires_at <= ctx.now() || invite.attempts >= INVITE_ATTEMPTS) invalid();
      if (user.status !== 'active') fail('ACCOUNT_DISABLED', 'This account has been disabled');
      if (!safeEqualHex(inviteHash(input.code), invite.code_hash)) {
        ctx.tx(() => { ctx.run('UPDATE staff_invites SET attempts = attempts + 1 WHERE user_id = ?', user.id); });
        invalid();
      }
      const hash = strongPassword(input.newPassword);
      ctx.tx(() => {
        const used = ctx.run('UPDATE staff_invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND code_hash = ?', ctx.now(), user.id, invite.code_hash);
        if (used.changes !== 1) invalid();
        ctx.run('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', hash, user.id);
        ctx.audit('user', user.id, { viaEmailedCode: true }, 'auth.invite_accepted');
        ctx.flush();
      });
      ctx.engine.endSessionsFor(user.id);
      return { username: user.username };
    },
  },
});

const INVITE_HOURS = 48;
const INVITE_ATTEMPTS = 5;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Ten characters from a 32-symbol alphabet (50 bits), e.g. K7QM2-XW9DP. Easy to type, single use, short-lived. */
function newInviteCode(): string {
  const chars = [...randomBytes(10)].map((b) => INVITE_ALPHABET[b % 32]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}
const inviteHash = (code: string) => createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
const safeEqualHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(1, name.length - 1))}@${domain}`;
}
