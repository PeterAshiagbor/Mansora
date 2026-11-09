import { z } from 'zod';
import { ALL_PERMISSIONS, fail, PERMISSIONS, ROLE_DEFAULTS, ROLES, sanitisePermissions } from '@mansora/domain';
import { defineCommands, empty, zId, zOptText, zText, type Ctx } from '../engine';
import { checkPasswordStrength, hashPassword } from '../passwords';

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
    currency: 'GHS',
  };
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
      ctx.tx(() => {
        const e = ctx.engine;
        e.setMeta('api_url', apiUrl);
        e.setMeta('device_id', body.deviceId);
        e.setMeta('tenant_id', body.tenant.id);
        e.setMeta('business_name', body.tenant.name);
        e.setMeta('business_phone', body.tenant.phone ?? '');
        e.setMeta('business_address', body.tenant.address ?? '');
        e.setMeta('activated_at', ctx.now());
        const id = ctx.id();
        ctx.insert('users', {
          id, username: input.owner.username, name: input.owner.name, role: 'owner', status: 'active',
          permissions: JSON.stringify(ALL_PERMISSIONS), password_hash: passwordHash, created_at: ctx.now(), updated_at: ctx.now(),
        });
        ctx.audit('device', body.deviceId, { deviceName: input.deviceName }, 'device.activated');
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
    }),
    run: (ctx, input) => {
      const e = ctx.engine;
      const before = business(ctx);
      if (input.allowNegativeStock !== before.allowNegativeStock && ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can change the negative-stock policy');
      e.setMeta('business_name', input.name);
      e.setMeta('business_phone', input.phone ?? '');
      e.setMeta('business_address', input.address ?? '');
      e.setMeta('receipt_footer', input.receiptFooter ?? '');
      e.setMeta('lock_minutes', String(input.lockMinutes));
      e.setMeta('allow_negative_stock', input.allowNegativeStock ? '1' : '0');
      ctx.audit('business', before.tenantId, { before, after: input });
      return business(ctx);
    },
  },

  'staff.list': {
    perm: 'staff.manage',
    input: empty,
    run: (ctx) => ctx.all('SELECT id, username, name, role, status, permissions, created_at FROM users ORDER BY name').map((u) => ({ ...u, permissions: JSON.parse(u.permissions) })),
  },
  'staff.save': {
    perm: 'staff.manage',
    mutates: true,
    input: z.object({
      id: zId.optional(), name: zText(100), username: zUsername, role: z.enum(ROLES), status: z.enum(['active', 'disabled']).default('active'),
      permissions: z.array(z.string()).optional(), password: zPassword.optional(),
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
        if (input.password) ctx.run('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', strongPassword(input.password), id);
        if (input.status !== 'active' || input.password) ctx.engine.endSessionsFor(id);
      } else {
        if (!input.password) fail('INVALID_INPUT', 'A password is required for new staff');
        ctx.insert('users', {
          id, username: input.username, name: input.name, role: input.role, status: input.status, permissions,
          password_hash: strongPassword(input.password), created_at: now, updated_at: now,
        });
      }
      ctx.audit('user', id, { name: input.name, role: input.role, status: input.status, permissions: JSON.parse(permissions), passwordReset: !!input.password && !!existing });
      return { id };
    },
  },
});
