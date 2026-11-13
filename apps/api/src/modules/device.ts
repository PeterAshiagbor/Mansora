import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SYNC_TABLES, syncEventSchema, syncPushSchema, validateEventRows, type SyncPullResult, type SyncPushResult, type SyncTable } from '@mansora/domain';
import type { Query } from '../db';
import { httpError, newToken, normaliseCode, RateLimiter, sha256 } from '../security';
import type { AppContext } from '../app';

export interface DeviceAuth {
  id: string;
  tenant_id: string;
}

/** Apply one table's rows from an event. Insert-only tables ignore rows they already hold. */
async function applyRows(q: Query, tenantId: string, table: SyncTable, rows: Record<string, unknown>[]): Promise<void> {
  const spec = SYNC_TABLES[table];
  const cols = Object.keys(spec.cols);
  for (const row of rows) {
    const values = cols.map((c) => row[c] ?? null);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    let conflict = 'DO NOTHING';
    if (spec.mode === 'upsert') {
      const set = cols.filter((c) => c !== spec.key).map((c) => `${c} = EXCLUDED.${c}`).join(', ');
      // Never let an older copy of a row overwrite a newer one.
      const guard = 'version' in spec.cols ? ` WHERE ${table}.version <= EXCLUDED.version` : 'updated_at' in spec.cols ? ` WHERE ${table}.updated_at <= EXCLUDED.updated_at` : '';
      conflict = `DO UPDATE SET ${set}${guard}`;
    }
    await q(`INSERT INTO ${table} (tenant_id, ${cols.join(', ')}) VALUES ($1, ${placeholders}) ON CONFLICT (tenant_id, ${spec.key}) ${conflict}`, [tenantId, ...values]);
  }
}

export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const activationLimiter = new RateLimiter(10, 10 * 60_000);

  async function device(req: FastifyRequest): Promise<DeviceAuth> {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Device token required');
    const rows = await db.platform((q) => q<DeviceAuth & { status: string; tenant_status: string }>(
      `SELECT d.id, d.tenant_id, d.status, t.status AS tenant_status FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE d.token_hash = $1`,
      [sha256(header.slice(7))],
    ));
    const d = rows[0];
    if (!d || d.status !== 'active') httpError(401, 'DEVICE_NOT_AUTHORISED', 'This laptop is not authorised. Contact Mansora support.');
    if (d.tenant_status === 'closed') httpError(403, 'ACCOUNT_CLOSED', 'This account has been closed');
    return { id: d.id, tenant_id: d.tenant_id };
  }

  /** Exchange a one-time activation code for a device identity. */
  app.post('/v1/devices/activate', async (req) => {
    activationLimiter.check(req.ip);
    const body = z.object({ code: z.string().min(4).max(64), deviceName: z.string().min(1).max(80), appVersion: z.string().max(40), expectTenantId: z.string().uuid().optional() }).parse(req.body);
    const token = newToken();
    const deviceId = randomUUID();
    return db.platform(async (q) => {
      const [code] = await q(`SELECT * FROM activation_codes WHERE code_hash = $1 FOR UPDATE`, [sha256(normaliseCode(body.code))]);
      if (!code || code.used_at || Date.parse(code.expires_at) < Date.now()) httpError(400, 'INVALID_ACTIVATION_CODE', 'This activation code is not valid or has expired');
      if (body.expectTenantId && body.expectTenantId !== code.tenant_id) httpError(400, 'INVALID_ACTIVATION_CODE', 'This activation code is not valid or has expired');
      const [tenant] = await q(`SELECT * FROM tenants WHERE id = $1`, [code.tenant_id]);
      if (tenant.status === 'closed') httpError(403, 'ACCOUNT_CLOSED', 'This account has been closed');
      // Version one supports exactly one checkout laptop per store.
      const active = await q(`SELECT id FROM devices WHERE tenant_id = $1 AND status = 'active'`, [tenant.id]);
      if (active.length) httpError(409, 'DEVICE_ALREADY_ACTIVE', 'This business already has an active laptop. Ask Mansora to deactivate it first.');
      await q(`UPDATE activation_codes SET used_at = now() WHERE code_hash = $1`, [code.code_hash]);
      await q(`INSERT INTO devices (id, tenant_id, name, token_hash, app_version, last_seen_at) VALUES ($1, $2, $3, $4, $5, now())`, [deviceId, tenant.id, body.deviceName, sha256(token), body.appVersion]);
      await q(`UPDATE onboarding_steps SET completed_at = now(), notes = $2 WHERE tenant_id = $1 AND step = 'activate_laptop' AND completed_at IS NULL`, [tenant.id, `Activated: ${body.deviceName}`]);
      await q(`INSERT INTO admin_audit_logs (id, action, tenant_id, detail) VALUES ($1, 'device.activated', $2, $3)`, [randomUUID(), tenant.id, JSON.stringify({ deviceId, deviceName: body.deviceName })]);
      return { deviceId, deviceToken: token, tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, address: tenant.address } };
    });
  });

  /**
   * Receive outbox events. Each event is stored and applied in its own
   * transaction; (tenant_id, event_id) is unique, so an event delivered twice
   * is acknowledged again but applied only once.
   */
  app.post('/v1/sync/events', async (req): Promise<SyncPushResult> => {
    const dev = await device(req);
    const body = syncPushSchema.parse(req.body);
    const result: SyncPushResult = { accepted: [], rejected: [] };
    for (const raw of body.events) {
      const id = typeof (raw as any)?.id === 'string' ? (raw as any).id : 'unknown';
      let event, rows;
      try {
        event = syncEventSchema.parse(raw);
        rows = validateEventRows(event.payload.rows);
      } catch (e) {
        const reason = e instanceof z.ZodError ? `${e.issues[0].path.join('.')}: ${e.issues[0].message}` : 'Invalid event';
        result.rejected.push({ id, reason });
        continue;
      }
      try {
        await db.tenant(dev.tenant_id, async (q) => {
          const inserted = await q(
            `INSERT INTO sync_events (tenant_id, event_id, device_id, seq, type, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING event_id`,
            [dev.tenant_id, event.id, dev.id, event.seq, event.type, JSON.stringify(event.payload), event.occurredAt],
          );
          if (inserted.length === 0) return; // already have it: acknowledge, do not re-apply
          for (const [table, list] of Object.entries(rows)) await applyRows(q, dev.tenant_id, table as SyncTable, list!);
        });
        result.accepted.push(event.id);
      } catch (e) {
        // Unexpected failure: do not acknowledge. The device keeps the event and retries.
        req.log.error({ err: e, eventId: event.id }, 'sync event failed');
        break;
      }
    }
    await db.platform((q) =>
      q(`UPDATE devices SET last_seen_at = now(), app_version = $2, pending_count = $3, last_backup_at = COALESCE($4::timestamptz, last_backup_at), last_sync_at = CASE WHEN $5::boolean THEN now() ELSE last_sync_at END WHERE id = $1`, [
        dev.id, body.device.appVersion, Math.max(0, body.device.pendingCount - result.accepted.length - result.rejected.length), body.device.lastBackupAt,
        result.accepted.length + result.rejected.length === body.events.length,
      ]),
    );
    return result;
  });

  /** What the laptop needs to know from the cloud: account status and who looked at its data. */
  app.get('/v1/sync/pull', async (req): Promise<SyncPullResult> => {
    const dev = await device(req);
    const { tenant, sub } = await db.platform(async (q) => ({
      tenant: (await q(`SELECT id, name, status FROM tenants WHERE id = $1`, [dev.tenant_id]))[0],
      sub: (await q(`SELECT s.status, s.renewal_date, p.name FROM client_subscriptions s JOIN service_plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`, [dev.tenant_id]))[0],
    }));
    const log = await db.tenant(dev.tenant_id, (q) => q(`SELECT id, admin_name, action, grant_id, occurred_at FROM support_access_log ORDER BY occurred_at DESC LIMIT 200`));
    return {
      tenant,
      subscription: sub ? { status: sub.status, renewalDate: sub.renewal_date, planName: sub.name } : null,
      supportAccessLog: log.map((l) => ({ id: l.id, adminName: l.admin_name, action: l.action, grantId: l.grant_id, occurredAt: l.occurred_at })),
      serverTime: new Date().toISOString(),
      standing: ctx.standing ? await ctx.standing(dev.tenant_id) : null,
    };
  });

  /**
   * Email a staff member the one-time sign-in code their shop generated (staff.invite).
   * Sent immediately: the code is never queued or stored here. The Messages log keeps a
   * record of the send with the code removed. Limited per laptop to stop misuse as a mailer.
   */
  const inviteLimiter = new RateLimiter(20, 60 * 60_000);
  app.post('/v1/devices/staff-invitations', async (req) => {
    const dev = await device(req);
    inviteLimiter.check(dev.id);
    const body = z.object({
      to: z.string().trim().toLowerCase().email().max(160), staffName: z.string().trim().min(1).max(100), username: z.string().trim().min(1).max(100),
      businessName: z.string().trim().max(200), code: z.string().regex(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/), expiresAt: z.string().datetime(),
    }).parse(req.body);
    const email = ctx.email;
    if (!email || !email.configured()) return httpError(503, 'EMAIL_UNAVAILABLE', 'Email is not set up yet. Set a password for this staff member yourself and give it to them in person.');
    const [tenant] = await db.platform((q) => q(`SELECT name FROM tenants WHERE id = $1`, [dev.tenant_id]));
    const shop = body.businessName || tenant?.name || 'your shop';
    const until = new Date(body.expiresAt).toUTCString().replace(' GMT', ' (Ghana time)');
    const text = (code: string) => [
      `Hello ${body.staffName},`, '',
      `You have been given a staff account for ${shop} on Mansora Sales & Stock.`, '',
      `Username: ${body.username}`, `One-time sign-in code: ${code}`, '',
      'On the sign-in screen choose "I have a sign-in code", enter your username and this code, then choose your own password.',
      `The code works once and expires on ${until}. If it expires, ask the owner to send a new one.`, '',
      'Mansora will never ask you for your password. If you did not expect this email, you can ignore it.',
    ].join('\n');
    const id = randomUUID();
    try {
      await email.send({ to: body.to, subject: `Your sign-in details for ${shop}`, body: text(body.code), idempotencyKey: `mansora-staff-invite/${id}` });
    } catch (e: any) {
      httpError(502, 'EMAIL_FAILED', e?.message && /allowlist/i.test(e.message) ? 'This test environment can only email approved test addresses.' : 'The email could not be sent. Try again shortly, or set a password for them yourself.');
    }
    await db.platform(async (q) => {
      await q(`INSERT INTO notifications (id, tenant_id, to_address, subject, body, status, kind, sent_at) VALUES ($1, $2, $3, $4, $5, 'sent', 'staff_invitation', now())`,
        [id, dev.tenant_id, body.to, `Your sign-in details for ${shop}`, text('[one-time code removed after sending]')]);
      await q(`INSERT INTO admin_audit_logs (id, action, tenant_id, detail) VALUES ($1, 'staff_invitation.sent', $2, $3)`, [randomUUID(), dev.tenant_id, JSON.stringify({ deviceId: dev.id, notificationId: id })]);
    });
    return { sent: true };
  });

  /**
   * The owner's opt-in daily closing summary (C33). Sent immediately; the figures are never
   * stored here. The Messages log keeps a delivery record with the body removed.
   */
  const summaryLimiter = new RateLimiter(8, 24 * 60 * 60_000);
  app.post('/v1/devices/daily-summary', async (req) => {
    const dev = await device(req);
    summaryLimiter.check(dev.id);
    const body = z.object({ to: z.string().trim().toLowerCase().email().max(160), subject: z.string().trim().min(1).max(200), body: z.string().min(1).max(8000), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
    const email = ctx.email;
    if (!email || !email.configured()) return httpError(503, 'EMAIL_UNAVAILABLE', 'Email is not set up on the Mansora server yet, so the summary could not be sent.');
    const id = randomUUID();
    try {
      await email.send({ to: body.to, subject: body.subject, body: body.body, idempotencyKey: `mansora-daily-summary/${dev.id}/${body.day}/${id}` });
    } catch (e: any) {
      httpError(502, 'EMAIL_FAILED', e?.message && /allowlist/i.test(e.message) ? 'This test environment can only email approved test addresses.' : 'The summary could not be sent. It will be tried again after the next sync.');
    }
    await db.platform((q) => q(`INSERT INTO notifications (id, tenant_id, to_address, subject, body, status, kind, sent_at) VALUES ($1, $2, $3, $4, $5, 'sent', 'daily_summary', now())`,
      [id, dev.tenant_id, body.to, `Daily summary for ${body.day}`, '[business figures removed after sending]']));
    return { sent: true };
  });

  /** Confirm an owner-recovery code for this laptop's business. Single use. */
  const recoveryLimiter = new RateLimiter(10, 10 * 60_000);
  app.post('/v1/devices/owner-recovery', async (req) => {
    const dev = await device(req);
    recoveryLimiter.check(dev.id);
    const body = z.object({ code: z.string().min(4).max(64) }).parse(req.body);
    return db.platform(async (q) => {
      const [code] = await q(`SELECT * FROM owner_recovery_codes WHERE code_hash = $1 AND tenant_id = $2 FOR UPDATE`, [sha256(normaliseCode(body.code)), dev.tenant_id]);
      if (!code || code.used_at || Date.parse(code.expires_at) < Date.now()) httpError(400, 'INVALID_RECOVERY_CODE', 'This recovery code is not valid or has expired');
      await q(`UPDATE owner_recovery_codes SET used_at = now() WHERE code_hash = $1`, [code.code_hash]);
      await q(`INSERT INTO admin_audit_logs (id, admin_id, action, tenant_id, detail) VALUES ($1, $2, 'owner_recovery_code.used', $3, $4)`, [randomUUID(), code.created_by, dev.tenant_id, JSON.stringify({ deviceId: dev.id })]);
      return { ok: true };
    });
  });

  /**
   * Everything the cloud holds for this business, for rebuilding a replacement
   * laptop when no backup file exists. Staff passwords are not in the cloud.
   */
  app.get('/v1/sync/snapshot', async (req) => {
    const dev = await device(req);
    const tables: Record<string, unknown[]> = {};
    await db.tenant(dev.tenant_id, async (q) => {
      for (const [table, spec] of Object.entries(SYNC_TABLES)) tables[table] = await q(`SELECT ${Object.keys(spec.cols).join(', ')} FROM ${table}`);
    });
    await db.platform((q) => q(`INSERT INTO admin_audit_logs (id, action, tenant_id, detail) VALUES ($1, 'device.snapshot_downloaded', $2, $3)`, [randomUUID(), dev.tenant_id, JSON.stringify({ deviceId: dev.id })]));
    return { tables, serverTime: new Date().toISOString() };
  });

  /** Store a backup the laptop has already encrypted with the owner's passphrase. Mansora cannot read it. */
  app.put('/v1/backups/:id', { bodyLimit: 200 * 1024 * 1024, preParsing: async (req) => { await device(req); } }, async (req) => {
    const dev = await device(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const content = req.body as Buffer;
    if (!Buffer.isBuffer(content) || content.length === 0) httpError(400, 'INVALID_BACKUP', 'Empty backup');
    const digest = sha256(content);
    if (req.headers['x-sha256'] !== digest) httpError(400, 'CHECKSUM_MISMATCH', 'The backup was damaged in transit');
    const [existing] = await db.platform((q) => q(`SELECT tenant_id, sha256 FROM backup_records WHERE id = $1`, [id]));
    if (existing && (existing.tenant_id !== dev.tenant_id || existing.sha256 !== digest)) httpError(409, 'BACKUP_CONFLICT', 'Backup ID is already in use');
    const key = join(dev.tenant_id, `${id}-${digest}.mbk`);
    await ctx.backupStorage.put(key, content, digest);
    await db.platform(async (q) => {
      await q(`INSERT INTO backup_records (id, tenant_id, device_id, size_bytes, sha256, storage_key, status) VALUES ($1, $2, $3, $4, $5, $6, 'stored') ON CONFLICT (id) DO NOTHING`, [id, dev.tenant_id, dev.id, content.length, digest, key]);
      const [record] = await q(`SELECT tenant_id, sha256 FROM backup_records WHERE id = $1`, [id]);
      if (record.tenant_id !== dev.tenant_id || record.sha256 !== digest) httpError(409, 'BACKUP_CONFLICT', 'Backup ID is already in use');
      await q(`UPDATE devices SET last_backup_at = now() WHERE id = $1`, [dev.id]);
    });
    return { id, stored: true };
  });

  app.get('/v1/backups/latest', async (req, reply) => {
    const dev = await device(req);
    const [rec] = await db.platform((q) => q(`SELECT * FROM backup_records WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [dev.tenant_id]));
    if (!rec) httpError(404, 'NOT_FOUND', 'No cloud backup exists for this business');
    reply.header('content-type', 'application/octet-stream').header('x-sha256', rec.sha256);
    return ctx.backupStorage.get(rec.storage_key);
  });
}
