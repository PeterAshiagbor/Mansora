import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { httpError, RateLimiter, sha256 } from '../security';
import { queueLeadEmails } from './lead-emails';
import { convertBody, convertLead, linkLead } from './lead-conversion';

const statuses = ['new', 'contacted', 'qualified', 'closed'] as const;
const input = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100),
  business: z.string().trim().min(1).max(160), email: z.string().trim().email().max(200).transform(v => v.toLowerCase()),
  phone: z.string().trim().max(40).default(''), message: z.string().trim().max(1500).default(''),
  consent: z.preprocess(v => v === 'yes' ? true : v, z.literal(true)),
  businessType: z.enum(['retail', 'mini_mart', 'general_merchandise', 'wholesale', 'other']).optional(),
  website: z.string().max(300).default(''), // Honeypot, never stored.
  format: z.enum(['json', 'html']).default('json'),
}).strict();
const received = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request received · Mansora</title><style>body{margin:0;padding:32px 16px;background:#f7f7f5;color:#251c32;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:auto;background:white;border:1px solid #dedde2;border-radius:8px;padding:28px}h1{font-size:28px;line-height:1.25}label{display:block}input:not([type=checkbox]),textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #99939f;border-radius:6px;padding:10px;font:inherit}textarea{min-height:100px}button{background:#5c2d85;color:white;border:0;border-radius:6px;padding:12px 20px;font:inherit;cursor:pointer}:focus-visible{outline:3px solid #b993d3;outline-offset:3px}</style><main><h1>Request received</h1><p>Thank you. Mansora will review your request and contact you using the details you provided.</p><p>No account, subscription or payment has been created.</p></main></html>';
/** A reference the prospect can quote: MSD (Mansora software demo), date, four characters. */
export function leadReference(now = new Date()): string {
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return `MSD-${ymd}-${Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')}`;
}

/**
 * The corporate website forwards demo requests server to server and signs each one with the shared
 * DEMO_INTAKE_SECRET: HMAC-SHA256 over "timestamp\nclient-ip\nsha256(body)". A valid, fresh signature marks the
 * request as coming from the website and lets the platform rate-limit by the visitor's address instead of the
 * website's. A signature that is present but wrong or stale is refused outright.
 */
export function signWebsiteRequest(secret: string, timestamp: number, clientIp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${clientIp}\n${sha256(rawBody)}`).digest('hex');
}
function websiteSource(req: FastifyRequest, secret: string | undefined, rawBody: string, now = Date.now()): { ip: string } | null {
  const sig = req.headers['x-mansora-signature'];
  if (sig === undefined) return null;
  const ts = Number(req.headers['x-mansora-timestamp']), clientIp = String(req.headers['x-mansora-client-ip'] ?? '');
  if (!secret || typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig) || !Number.isInteger(ts) || Math.abs(now / 1000 - ts) > 300 || !/^[0-9a-fA-F:.]{2,45}$/.test(clientIp)) httpError(403, 'BAD_SOURCE_SIGNATURE', 'This request could not be verified');
  const expected = Buffer.from(signWebsiteRequest(secret!, ts, clientIp, rawBody), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(sig as string, 'hex'))) httpError(403, 'BAD_SOURCE_SIGNATURE', 'This request could not be verified');
  return { ip: clientIp };
}

export function registerLeadRoutes(app: FastifyInstance, { db, demoIntakeSecret, adminUrl }: AppContext) {
  const ip = new RateLimiter(30, 3_600_000), emails = new RateLimiter(3, 86_400_000);
  const secret = demoIntakeSecret ?? (process.env.DEMO_INTAKE_SECRET?.trim() || undefined);
  app.register(async routes => {
    // Keep the exact bytes received: the website's signature covers them, not a re-serialised copy.
    routes.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 8192 }, (req, value, done) => {
      (req as any).rawDemoBody = String(value);
      try { done(null, String(value) ? JSON.parse(String(value)) : {}); } catch { const e: any = new Error('Invalid JSON'); e.statusCode = 400; done(e, undefined); }
    });
    routes.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8192 }, (req, value, done) => {
      (req as any).rawDemoBody = String(value);
      done(null, Object.fromEntries(new URLSearchParams(String(value))));
    });
    routes.post('/v1/public/demo-requests', { bodyLimit: 8192 }, async (req, reply) => {
      const site = websiteSource(req, secret, (req as any).rawDemoBody ?? '');
      ip.check(site?.ip ?? req.ip);
      const body = input.parse(req.body);
      let reference = 'received', duplicate = false;
      if (!body.website) {
        const id = body.id ?? randomUUID();
        // A retry of the same submission returns the first result; it never counts again or creates a second lead.
        const [existing] = await db.platform(q => q('SELECT reference FROM demo_requests WHERE id = $1', [id]));
        if (existing) { duplicate = true; reference = existing.reference ?? 'received'; }
        else {
          emails.check(sha256(body.email));
          reference = leadReference();
          const source = site ? 'website' : 'app_form';
          // The lead and its emails commit together: a saved lead always has its acknowledgement and team alert
          // queued, and an email that later fails never loses the lead.
          const rows = await db.platform(async q => {
            const inserted = await q(`INSERT INTO demo_requests (id, name, business, email, phone, message, consent_at, reference, source, business_type)
              VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING reference`,
              [id, body.name, body.business, body.email, body.phone, body.message, reference, source, body.businessType ?? null]);
            if (inserted.length) await queueLeadEmails(q, { id, reference, name: body.name, business: body.business, email: body.email, phone: body.phone, message: body.message, businessType: body.businessType ?? null, source }, { now: new Date(), adminUrl });
            return inserted;
          });
          if (!rows.length) { duplicate = true; reference = (await db.platform(q => q('SELECT reference FROM demo_requests WHERE id = $1', [id])))[0]?.reference ?? 'received'; }
        }
      }
      if (body.format === 'html') return reply.code(303).header('location', 'demo-requests/received').send();
      return reply.code(202).send({ ok: true, reference, duplicate, message: 'Request received. No account or subscription has been created.' });
    });
    routes.get('/v1/public/demo-requests/received', async (_req, reply) => reply.type('text/html; charset=utf-8').send(received));
    routes.get('/v1/public/demo-request-form', async (_req, reply) => reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request a Mansora demo</title><style>body{margin:0;padding:32px 16px;background:#f7f7f5;color:#251c32;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:auto;background:white;border:1px solid #dedde2;border-radius:8px;padding:28px}h1{font-size:28px;line-height:1.25}label{display:block}input:not([type=checkbox]),textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #99939f;border-radius:6px;padding:10px;font:inherit}textarea{min-height:100px}button{background:#5c2d85;color:white;border:0;border-radius:6px;padding:12px 20px;font:inherit;cursor:pointer}:focus-visible{outline:3px solid #b993d3;outline-offset:3px}</style><main><h1>Request a Mansora demo</h1><form method="post" action="demo-requests"><input type="hidden" name="format" value="html"><input type="hidden" name="id" value="${randomUUID()}"><p><label>Your name <input name="name" required maxlength="100" autocomplete="name"></label></p><p><label>Business name <input name="business" required maxlength="160" autocomplete="organization"></label></p><p><label>Email <input name="email" type="email" required maxlength="200" autocomplete="email"></label></p><p><label>Phone (optional) <input name="phone" type="tel" maxlength="40" autocomplete="tel"></label></p><p><label>What would you like help with? <textarea name="message" maxlength="1500"></textarea></label></p><div hidden aria-hidden="true"><label>Leave this blank <input name="website" tabindex="-1" autocomplete="off"></label></div><p><label><input type="checkbox" name="consent" value="yes" required> I agree that Mansora may contact me about this request.</label></p><p>Use business contact details only. Do not enter passwords, payment information or sensitive customer data.</p><button type="submit">Request demo</button></form></main></html>`));
  });
  async function actor(req: FastifyRequest) {
    const token = req.headers.authorization;
    if (!token?.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Please sign in');
    const [a] = await db.platform(q => q("SELECT a.id, a.name FROM admins a JOIN admin_sessions s ON s.admin_id = a.id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'", [sha256(token!.slice(7))]));
    return a ?? httpError(401, 'UNAUTHENTICATED', 'Please sign in again');
  }
  app.get('/v1/admin/leads', async req => {
    await actor(req);
    const filter = z.object({ status: z.enum(statuses).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) }).parse(req.query);
    return db.platform(async q => {
      const rows = await q('SELECT d.*, a.name AS assigned_name FROM demo_requests d LEFT JOIN admins a ON a.id = d.assigned_admin_id WHERE ($1::text IS NULL OR d.status = $1) ORDER BY d.created_at DESC, d.id LIMIT 51 OFFSET $2', [filter.status ?? null, (filter.page - 1) * 50]);
      return { rows: rows.slice(0, 50), hasMore: rows.length > 50, page: filter.page };
    });
  });
  app.get('/v1/admin/leads/:id', async req => {
    await actor(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return db.platform(async q => {
      const [lead] = await q(`SELECT d.*, a.name AS assigned_name FROM demo_requests d LEFT JOIN admins a ON a.id = d.assigned_admin_id WHERE d.id = $1`, [id]);
      if (!lead) httpError(404, 'NOT_FOUND', 'Demo request not found');
      const events = await q(`SELECT e.id, e.kind, e.body, e.occurred_at, e.created_at, a.name AS actor_name FROM lead_events e LEFT JOIN admins a ON a.id = e.actor_admin_id WHERE e.lead_id = $1 ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 200`, [id]);
      // Email history: what was sent, held back or failed (accepted by the provider is not proof of delivery).
      const emails = await q(`SELECT id, kind, to_address, subject, status, error, next_attempt_at, sent_at, created_at, delivery_status FROM notifications WHERE lead_id = $1 OR (kind = 'client_onboarding' AND tenant_id = (SELECT tenant_id FROM demo_requests WHERE id = $1)) ORDER BY created_at, kind`, [id]);
      const admins = await q(`SELECT id, name FROM admins WHERE status = 'active' ORDER BY name`);
      return { lead, events, emails, admins };
    });
  });
  const contactKinds = ['call', 'meeting', 'email_out', 'email_in_logged'] as const;
  app.post('/v1/admin/leads/:id/events', async req => {
    const a = await actor(req), { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ kind: z.enum(['note', ...contactKinds]), body: z.string().trim().min(1).max(4000), occurredAt: z.string().datetime({ offset: true }).optional() }).strict().parse(req.body);
    const occurred = body.occurredAt ?? new Date().toISOString();
    if (Date.parse(occurred) > Date.now() + 5 * 60_000) httpError(400, 'FUTURE_DATE', 'A contact cannot be recorded in the future');
    return db.platform(async q => {
      const [lead] = await q('SELECT id, status, last_contacted_at FROM demo_requests WHERE id = $1 FOR UPDATE', [id]);
      if (!lead) httpError(404, 'NOT_FOUND', 'Demo request not found');
      await q('INSERT INTO lead_events (id, lead_id, kind, body, actor_admin_id, occurred_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, body.kind, body.body, a.id, occurred]);
      if ((contactKinds as readonly string[]).includes(body.kind)) {
        // Recording a contact stops the automatic follow-ups: a new lead becomes contacted.
        await q('UPDATE demo_requests SET last_contacted_at = GREATEST(COALESCE(last_contacted_at, $2::timestamptz), $2::timestamptz), status = CASE WHEN status = $3 THEN $4 ELSE status END, updated_at = now() WHERE id = $1', [id, occurred, 'new', 'contacted']);
        if (lead.status === 'new') await q('INSERT INTO lead_events (id, lead_id, kind, body, actor_admin_id, occurred_at) VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), id, 'status', 'new → contacted (contact recorded)', a.id]);
      }
      await q('INSERT INTO admin_audit_logs (id, admin_id, action, detail) VALUES ($1,$2,$3,$4)', [randomUUID(), a.id, 'lead.event_recorded', JSON.stringify({ leadId: id, kind: body.kind })]);
      return { ok: true };
    });
  });
  app.put('/v1/admin/leads/:id', async req => {
    const a = await actor(req), { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      status: z.enum(statuses).optional(),
      assignedAdminId: z.string().uuid().nullable().optional(),
      nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
      qualification: z.object({ shops: z.number().int().min(0).max(1000).optional(), tills: z.number().int().min(0).max(1000).optional(), currentSystem: z.string().trim().max(200).optional(), needs: z.string().trim().max(2000).optional(), budget: z.string().trim().max(200).optional(), planInterest: z.enum(['starter', 'business', 'plus', 'undecided']).optional() }).strict().optional(),
      optOut: z.boolean().optional(),
    }).strict().refine(v => Object.keys(v).length > 0, 'Nothing to change').parse(req.body);
    await db.platform(async q => {
      const [lead] = await q('SELECT * FROM demo_requests WHERE id = $1 FOR UPDATE', [id]);
      if (!lead) httpError(404, 'NOT_FOUND', 'Demo request not found');
      const event = (kind: string, text: string) => q('INSERT INTO lead_events (id, lead_id, kind, body, actor_admin_id, occurred_at) VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), id, kind, text, a.id]);
      if (body.status && body.status !== lead.status) {
        await q('UPDATE demo_requests SET status = $2, updated_at = now() WHERE id = $1', [id, body.status]);
        await event('status', `${lead.status} → ${body.status}`);
      }
      if (body.assignedAdminId !== undefined && body.assignedAdminId !== lead.assigned_admin_id) {
        let name = 'nobody';
        if (body.assignedAdminId) { const [who] = await q(`SELECT name FROM admins WHERE id = $1 AND status = 'active'`, [body.assignedAdminId]); if (!who) httpError(400, 'UNKNOWN_ADMIN', 'Choose an active administrator'); name = who.name; }
        await q('UPDATE demo_requests SET assigned_admin_id = $2, updated_at = now() WHERE id = $1', [id, body.assignedAdminId]);
        await event('assignment', `Assigned to ${name}`);
      }
      if (body.nextFollowUpAt !== undefined) {
        await q('UPDATE demo_requests SET next_follow_up_at = $2, updated_at = now() WHERE id = $1', [id, body.nextFollowUpAt]);
        await event('follow_up', body.nextFollowUpAt ? `Next follow-up ${body.nextFollowUpAt}` : 'Follow-up date cleared');
      }
      if (body.qualification) await q('UPDATE demo_requests SET qualification = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(body.qualification)]);
      if (body.optOut !== undefined && body.optOut !== !!lead.follow_up_opt_out_at) {
        await q('UPDATE demo_requests SET follow_up_opt_out_at = $2, updated_at = now() WHERE id = $1', [id, body.optOut ? new Date().toISOString() : null]);
        await event('opt_out', body.optOut ? 'Prospect asked not to be followed up' : 'Follow-up opt-out removed');
      }
      await q('INSERT INTO admin_audit_logs (id, admin_id, action, detail) VALUES ($1,$2,$3,$4)', [randomUUID(), a.id, body.status ? 'lead.status_updated' : 'lead.updated', JSON.stringify({ leadId: id, ...body, qualification: body.qualification ? 'updated' : undefined })]);
    });
    return { ok: true };
  });
  app.post('/v1/admin/leads/:id/convert', async req => {
    const a = await actor(req), { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = convertBody.parse(req.body);
    return db.platform(q => convertLead(q, a, id, body));
  });
  app.post('/v1/admin/leads/:id/link', async req => {
    const a = await actor(req), { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).strict().parse(req.body);
    return db.platform(q => linkLead(q, a, id, tenantId));
  });
}
