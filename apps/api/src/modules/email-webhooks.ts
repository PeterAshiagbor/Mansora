import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';

/**
 * Resend delivery events (acquisition spec PR-07). Resend signs each webhook (Svix scheme): HMAC-SHA256 with the
 * endpoint secret over "id.timestamp.body", base64, in the svix-signature header ("v1,<sig>", possibly several).
 * Only signed, fresh events are used; each message id is processed once. The event moves the email's
 * delivery_status on: accepted by Resend ('sent') is never reported as delivered until Resend says so.
 * Configure RESEND_WEBHOOK_SECRET (whsec_…) and point a Resend webhook at /api/v1/webhooks/resend.
 */
const OUTCOME: Record<string, 'delivered' | 'bounced' | 'complained' | 'delayed'> = {
  'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.delivery_delayed': 'delayed',
};
// A later, final outcome replaces an earlier one; a delay never overwrites a final result.
const RANK = { delayed: 1, delivered: 2, complained: 3, bounced: 3 } as const;

export function verifyResendSignature(secret: string, headers: Record<string, string | string[] | undefined>, body: string, now = Date.now()): string | null {
  const id = String(headers['svix-id'] ?? ''), ts = String(headers['svix-timestamp'] ?? ''), sigs = String(headers['svix-signature'] ?? '');
  if (!id || !/^\d+$/.test(ts) || !sigs || Math.abs(now / 1000 - Number(ts)) > 300) return null;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  for (const part of sigs.split(' ')) {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return id;
  }
  return null;
}

export function registerEmailWebhooks(app: FastifyInstance, { db }: AppContext) {
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));
    scope.post('/v1/webhooks/resend', async (req, reply) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) return reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Delivery events are not configured' });
      const raw = typeof req.body === 'string' ? req.body : '';
      const id = verifyResendSignature(secret, req.headers as any, raw);
      if (!id) return reply.code(401).send({ code: 'BAD_SIGNATURE', message: 'Signature check failed' });
      let event: any;
      try { event = JSON.parse(raw); } catch { return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Invalid JSON' }); }
      const outcome = OUTCOME[event?.type];
      const messageId = typeof event?.data?.email_id === 'string' ? event.data.email_id : null;
      await db.platform(async (q) => {
        const fresh = await q('INSERT INTO email_webhook_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [id, String(event?.type ?? 'unknown').slice(0, 60)]);
        if (!fresh.length || !outcome || !messageId) return; // repeated, or an event we do not track
        const [n] = await q('SELECT id, delivery_status FROM notifications WHERE provider_message_id = $1 FOR UPDATE', [messageId]);
        if (!n) return;
        if (n.delivery_status && RANK[n.delivery_status as keyof typeof RANK] > RANK[outcome]) return;
        await q('UPDATE notifications SET delivery_status = $2, delivery_updated_at = now() WHERE id = $1', [n.id, outcome]);
      });
      return reply.code(200).send({ ok: true });
    });
  });
}
