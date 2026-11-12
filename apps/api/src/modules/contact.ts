import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { httpError, sha256 } from '../security';

// A separate namespace in the existing platform settings store; no billing policy is changed.
const KEY = 'public_contact';
const optional = (schema: z.ZodType) => z.union([z.literal(''), schema]);
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: optional(z.string().trim().email().max(200)),
  phone: z.string().trim().max(40).regex(/^[+\d ()-]*$/),
  whatsapp: z.string().trim().max(16).regex(/^(?:[1-9]\d{6,14})?$/, 'Use an international number, digits only'),
  hours: z.string().trim().max(160),
  website: optional(z.string().url().max(300).refine(v => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; }, 'Use an HTTPS website without credentials')),
}).strict();
const empty = { name: 'Mansora', email: '', phone: '', whatsapp: '', hours: '', website: '' };
export function registerContactRoutes(app: FastifyInstance, { db }: AppContext) {
  const read = () => db.platform(async q => {
    const [row] = await q('SELECT value FROM billing_settings WHERE key = $1', [KEY]);
    return row ? schema.parse(JSON.parse(row.value)) : empty;
  });
  app.get('/v1/public/contact', async (_req, reply) => {
    reply.header('access-control-allow-origin', '*'); // Deliberately public, identical data for every caller.
    return read();
  });
  async function actor(req: FastifyRequest) {
    const token = req.headers.authorization;
    if (!token?.startsWith('Bearer ')) httpError(401, 'UNAUTHENTICATED', 'Please sign in');
    const [a] = await db.platform(q => q("SELECT a.id FROM admins a JOIN admin_sessions s ON s.admin_id = a.id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'", [sha256(token!.slice(7))]));
    return a ?? httpError(401, 'UNAUTHENTICATED', 'Please sign in again');
  }
  app.get('/v1/admin/contact-settings', async req => { await actor(req); return read(); });
  app.put('/v1/admin/contact-settings', async req => {
    const a = await actor(req), value = schema.parse(req.body);
    await db.platform(async q => {
      await q('INSERT INTO billing_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [KEY, JSON.stringify(value)]);
      await q('INSERT INTO admin_audit_logs (id, admin_id, action, detail) VALUES ($1, $2, $3, $4)', [randomUUID(), a.id, 'contact_settings.updated', JSON.stringify({ fields: Object.keys(value) })]);
    });
    return { ok: true };
  });
}
