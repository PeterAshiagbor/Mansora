import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { httpError, RateLimiter, sha256 } from '../security';

const statuses = ['new', 'contacted', 'qualified', 'closed'] as const;
const input = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100),
  business: z.string().trim().min(1).max(160), email: z.string().trim().email().max(200).transform(v => v.toLowerCase()),
  phone: z.string().trim().max(40).default(''), message: z.string().trim().max(1500).default(''),
  consent: z.preprocess(v => v === 'yes' ? true : v, z.literal(true)),
  website: z.string().max(300).default(''), // Honeypot, never stored.
  format: z.enum(['json', 'html']).default('json'),
}).strict();
const received = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request received · Mansora</title><style>body{margin:0;padding:32px 16px;background:#f7f7f5;color:#251c32;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:auto;background:white;border:1px solid #dedde2;border-radius:8px;padding:28px}h1{font-size:28px;line-height:1.25}label{display:block}input:not([type=checkbox]),textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #99939f;border-radius:6px;padding:10px;font:inherit}textarea{min-height:100px}button{background:#5c2d85;color:white;border:0;border-radius:6px;padding:12px 20px;font:inherit;cursor:pointer}:focus-visible{outline:3px solid #b993d3;outline-offset:3px}</style><main><h1>Request received</h1><p>Thank you. Mansora will review your request and contact you using the details you provided.</p><p>No account, subscription or payment has been created.</p></main></html>';
export function registerLeadRoutes(app: FastifyInstance, { db }: AppContext) {
  const ip = new RateLimiter(30, 3_600_000), emails = new RateLimiter(3, 86_400_000);
  app.register(async routes => {
    routes.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8192 }, (_req, value, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(value))));
    });
    routes.post('/v1/public/demo-requests', { bodyLimit: 8192 }, async (req, reply) => {
      ip.check(req.ip);
      const body = input.parse(req.body);
      if (!body.website) {
        emails.check(sha256(body.email));
        await db.platform(q => q(`INSERT INTO demo_requests (id, name, business, email, phone, message, consent_at)
          VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (id) DO NOTHING`, [body.id ?? randomUUID(), body.name, body.business, body.email, body.phone, body.message]));
      }
      if (body.format === 'html') return reply.code(303).header('location', 'demo-requests/received').send();
      return reply.code(202).send({ ok: true, message: 'Request received. No account or subscription has been created.' });
    });
    routes.get('/v1/public/demo-requests/received', async (_req, reply) => reply.type('text/html; charset=utf-8').send(received));
    routes.get('/v1/public/demo-request-form', async (_req, reply) => reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request a Mansora demo</title><style>body{margin:0;padding:32px 16px;background:#f7f7f5;color:#251c32;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:auto;background:white;border:1px solid #dedde2;border-radius:8px;padding:28px}h1{font-size:28px;line-height:1.25}label{display:block}input:not([type=checkbox]),textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #99939f;border-radius:6px;padding:10px;font:inherit}textarea{min-height:100px}button{background:#5c2d85;color:white;border:0;border-radius:6px;padding:12px 20px;font:inherit;cursor:pointer}:focus-visible{outline:3px solid #b993d3;outline-offset:3px}</style><main><h1>Request a Mansora demo</h1><form method="post" action="demo-requests"><input type="hidden" name="format" value="html"><input type="hidden" name="id" value="${randomUUID()}"><p><label>Your name <input name="name" required maxlength="100" autocomplete="name"></label></p><p><label>Business name <input name="business" required maxlength="160" autocomplete="organization"></label></p><p><label>Email <input name="email" type="email" required maxlength="200" autocomplete="email"></label></p><p><label>Phone (optional) <input name="phone" type="tel" maxlength="40" autocomplete="tel"></label></p><p><label>What would you like help with? <textarea name="message" maxlength="1500"></textarea></label></p><div hidden aria-hidden="true"><label>Leave this blank <input name="website" tabindex="-1" autocomplete="off"></label></div><p><label><input type="checkbox" name="consent" value="yes" required> I agree that Mansora may contact me about this request.</label></p><p>Use business contact details only. Do not enter passwords, payment information or sensitive customer data.</p><button type="submit">Request demo</button></form></main></html>`));
  });
  async function actor(req: FastifyRequest) {
    const token = req.headers.authorization;
    if (!token?.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Please sign in');
    const [a] = await db.platform(q => q("SELECT a.id FROM admins a JOIN admin_sessions s ON s.admin_id = a.id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'", [sha256(token!.slice(7))]));
    return a ?? httpError(401, 'UNAUTHENTICATED', 'Please sign in again');
  }
  app.get('/v1/admin/leads', async req => {
    await actor(req);
    const filter = z.object({ status: z.enum(statuses).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) }).parse(req.query);
    return db.platform(async q => {
      const rows = await q('SELECT * FROM demo_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC, id LIMIT 51 OFFSET $2', [filter.status ?? null, (filter.page - 1) * 50]);
      return { rows: rows.slice(0, 50), hasMore: rows.length > 50, page: filter.page };
    });
  });
  app.put('/v1/admin/leads/:id', async req => {
    const a = await actor(req), { id } = z.object({ id: z.string().uuid() }).parse(req.params), { status } = z.object({ status: z.enum(statuses) }).strict().parse(req.body);
    await db.platform(async q => {
      const rows = await q('UPDATE demo_requests SET status = $2, updated_at = now() WHERE id = $1 RETURNING id', [id, status]);
      if (!rows.length) httpError(404, 'NOT_FOUND', 'Demo request not found');
      await q('INSERT INTO admin_audit_logs (id, admin_id, action, detail) VALUES ($1,$2,$3,$4)', [randomUUID(), a.id, 'lead.status_updated', JSON.stringify({ leadId: id, status })]);
    });
    return { ok: true };
  });
}
