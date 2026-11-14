/**
 * "Tell Mansora about a problem" (owner request 2026-11-14).
 *
 * Shop staff (through their laptop or the browser workspace) and administrators send a short report, optionally
 * pointing at the part of the screen it is about. Reports are stored and sent to Mansora once a day, at or after
 * 19:00 Ghana time (UTC), in one email with the subject "Mansora Platform Errors". The recipient comes from
 * BUG_REPORT_EMAIL, never from the code.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database, Query } from '../db';
import type { EmailAdapter } from '../email';
import { httpError, RateLimiter, sha256 } from '../security';
import type { AppContext } from '../app';

const text = (max: number) => z.string().trim().max(max);
export const zBugArea = z.strictObject({
  label: text(160).optional(),
  text: text(160).optional(),
  path: text(400).optional(),
  x: z.number().int().min(0).max(100_000).optional(),
  y: z.number().int().min(0).max(100_000).optional(),
  width: z.number().int().min(0).max(100_000).optional(),
  height: z.number().int().min(0).max(100_000).optional(),
  viewport: text(40).optional(),
});
export const zBugReport = z.strictObject({
  description: z.string().trim().min(3, 'Describe the problem').max(2000),
  severity: z.enum(['blocking', 'normal', 'idea']).default('normal'),
  page: text(120).optional(),
  area: zBugArea.nullish(),
  reporterName: text(100).optional(),
  reporterRole: text(40).optional(),
  appVersion: text(60).optional(),
});
export type BugReport = z.infer<typeof zBugReport>;

export const DIGEST_SUBJECT = 'Mansora Platform Errors';
export const DIGEST_HOUR_UTC = 19;

async function store(q: Query, r: BugReport, from: { source: 'shop' | 'admin'; tenantId?: string | null; deviceId?: string | null; userAgent?: string }) {
  const id = randomUUID();
  await q(`INSERT INTO bug_reports (id, source, tenant_id, device_id, reporter_name, reporter_role, page, area, description, severity, app_version, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, from.source, from.tenantId ?? null, from.deviceId ?? null, r.reporterName ?? null, r.reporterRole ?? null, r.page ?? null, r.area ? JSON.stringify(r.area) : null,
      r.description, r.severity, r.appVersion ?? null, from.userAgent?.slice(0, 300) ?? null]);
  return id;
}

export function registerBugReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const deviceLimiter = new RateLimiter(40, 24 * 3_600_000);
  const adminLimiter = new RateLimiter(60, 24 * 3_600_000);

  async function device(req: FastifyRequest) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Device token required');
    const [d] = await db.platform((q) => q<{ id: string; tenant_id: string; status: string }>(`SELECT id, tenant_id, status FROM devices WHERE token_hash = $1`, [sha256(header.slice(7))]));
    if (!d || d.status !== 'active') httpError(401, 'DEVICE_NOT_AUTHORISED', 'This laptop is not authorised. Contact Mansora support.');
    return d;
  }
  async function admin(req: FastifyRequest) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Please sign in');
    const [a] = await db.platform((q) => q<{ id: string; name: string }>(`SELECT a.id, a.name FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'`, [sha256(header.slice(7))]));
    return a ?? httpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }

  /** A report from a shop laptop or browser workspace. */
  app.post('/v1/devices/bug-reports', async (req) => {
    const dev = await device(req);
    deviceLimiter.check(dev.id);
    const body = zBugReport.parse(req.body);
    const id = await db.platform((q) => store(q, body, { source: 'shop', tenantId: dev.tenant_id, deviceId: dev.id, userAgent: String(req.headers['user-agent'] ?? '') }));
    return { id, sendsAt: `${DIGEST_HOUR_UTC}:00` };
  });

  /** A report from an administrator, about the administration dashboard. */
  app.post('/v1/admin/bug-reports', async (req) => {
    const a = await admin(req);
    adminLimiter.check(a.id);
    const body = zBugReport.parse(req.body);
    const id = await db.platform((q) => store(q, { ...body, reporterName: body.reporterName ?? a.name, reporterRole: 'administrator' }, { source: 'admin', userAgent: String(req.headers['user-agent'] ?? '') }));
    return { id, sendsAt: `${DIGEST_HOUR_UTC}:00` };
  });

  /** Recent reports, for administrators. */
  app.get('/v1/admin/bug-reports', async (req) => {
    await admin(req);
    return db.platform((q) => q(`SELECT r.id, r.source, r.reporter_name, r.reporter_role, r.page, r.area, r.description, r.severity, r.created_at, r.digest_day, t.name AS shop
      FROM bug_reports r LEFT JOIN tenants t ON t.id = r.tenant_id ORDER BY r.created_at DESC LIMIT 200`));
  });
}

function describeArea(area: any): string {
  if (!area) return 'Not pointed at';
  const what = [area.label, area.text && area.text !== area.label ? `"${area.text}"` : null].filter(Boolean).join(' ');
  return [what || 'An area of the screen', area.path ? `(${area.path})` : null, area.viewport ? `on a ${area.viewport} screen` : null].filter(Boolean).join(' ');
}

/**
 * Send the day's email once, at or after 19:00 UTC (Ghana time). Safe to call as often as you like: the day's
 * digest row and the reports' digest day are written in the same transaction as the send, so a failed send is
 * retried on the next call and a successful one is never repeated. An email is sent even when there are no new
 * reports, so the recipient can tell the service is working.
 */
export async function runBugDigest(o: { db: Database; email: EmailAdapter; to?: string; now?: () => Date }): Promise<{ sent: boolean; reports: number; reason?: string }> {
  const to = o.to?.trim();
  if (!to) return { sent: false, reports: 0, reason: 'NO_RECIPIENT' };
  if (!o.email.configured()) return { sent: false, reports: 0, reason: 'EMAIL_NOT_CONFIGURED' };
  const now = (o.now ?? (() => new Date()))();
  if (now.getUTCHours() < DIGEST_HOUR_UTC) return { sent: false, reports: 0, reason: 'NOT_YET' };
  const day = now.toISOString().slice(0, 10);
  return o.db.platform(async (q) => {
    const claimed = await q(`INSERT INTO bug_report_digests (day, report_count) VALUES ($1, 0) ON CONFLICT (day) DO NOTHING RETURNING day`, [day]);
    if (!claimed.length) return { sent: false, reports: 0, reason: 'ALREADY_SENT' };
    const rows = await q<any>(`SELECT r.*, t.name AS shop FROM bug_reports r LEFT JOIN tenants t ON t.id = r.tenant_id
      WHERE r.digest_day IS NULL AND r.created_at <= $1 ORDER BY (r.severity = 'blocking') DESC, r.created_at FOR UPDATE OF r`, [now.toISOString()]);
    const blocking = rows.filter((r) => r.severity === 'blocking').length;
    const label = { blocking: 'Stops work', normal: 'Problem', idea: 'Idea' } as Record<string, string>;
    const body = rows.length
      ? [
          `${rows.length} new report${rows.length === 1 ? '' : 's'} since the last email${blocking ? `, ${blocking} stopping work` : ''}.`, '',
          ...rows.flatMap((r, i) => [
            `${i + 1}. ${label[r.severity] ?? r.severity} · ${new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
            `   From: ${r.reporter_name ?? 'Unknown'}${r.reporter_role ? ` (${r.reporter_role})` : ''}, ${r.source === 'admin' ? 'administration dashboard' : (r.shop ?? 'a shop')}`,
            `   Page: ${r.page ?? 'not given'}`,
            `   Pointed at: ${describeArea(typeof r.area === 'string' ? JSON.parse(r.area) : r.area)}`,
            `   What happened: ${String(r.description).replace(/\s*\n\s*/g, ' / ')}`,
            ...(r.app_version ? [`   Version: ${r.app_version}`] : []), '',
          ]),
          'Every report is also listed in the administration dashboard under Problem reports.',
        ].join('\n')
      : 'No new problem reports today.';
    await o.email.send({ to, subject: DIGEST_SUBJECT, body, idempotencyKey: `mansora-bug-digest/${day}` });
    if (rows.length) await q(`UPDATE bug_reports SET digest_day = $1 WHERE id = ANY($2::uuid[])`, [day, rows.map((r) => r.id)]);
    await q(`UPDATE bug_report_digests SET report_count = $2 WHERE day = $1`, [day, rows.length]);
    return { sent: true, reports: rows.length };
  });
}
