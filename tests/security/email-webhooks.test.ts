import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';

const SECRET = 'whsec_' + randomBytes(24).toString('base64');
const sign = (id: string, ts: number, body: string, secret = SECRET) => 'v1,' + createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
let c: Cloud;
beforeAll(async () => { c = await startCloud(); });
afterAll(async () => { await c?.close(); delete process.env.RESEND_WEBHOOK_SECRET; });
const post = (body: object, o: { id?: string; ts?: number; secret?: string } = {}) => {
  const raw = JSON.stringify(body), id = o.id ?? `msg_${randomUUID()}`, ts = o.ts ?? Math.floor(Date.now() / 1000);
  return c.app.inject({ method: 'POST', url: '/v1/webhooks/resend', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign(id, ts, raw, o.secret) }, payload: raw });
};
const email = async (providerId: string) => {
  const id = randomUUID();
  await c.db.platform(q => q(`INSERT INTO notifications (id, to_address, subject, body, status, kind, provider_message_id) VALUES ($1, 'p@example.test', 's', 'b', 'sent', 'lead_ack', $2)`, [id, providerId]));
  return id;
};
const status = async (id: string) => (await c.db.platform(q => q('SELECT status, delivery_status FROM notifications WHERE id = $1', [id])))[0];

describe('Resend delivery events (acquisition spec PR-07)', () => {
  it('refuses everything until the webhook secret is configured', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await post({ type: 'email.delivered', data: { email_id: 'x' } })).statusCode).toBe(503);
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });
  it('records delivery from a signed event, once, without changing what "sent" means', async () => {
    const n = await email('re_1');
    const msg = `msg_${randomUUID()}`;
    expect((await post({ type: 'email.delivered', data: { email_id: 're_1' } }, { id: msg })).statusCode).toBe(200);
    expect(await status(n)).toEqual({ status: 'sent', delivery_status: 'delivered' });
    // The same message again (Resend retries) changes nothing.
    expect((await post({ type: 'email.delivered', data: { email_id: 're_1' } }, { id: msg })).statusCode).toBe(200);
    // A delay reported after delivery does not undo it; a bounce does replace it.
    await post({ type: 'email.delivery_delayed', data: { email_id: 're_1' } });
    expect((await status(n)).delivery_status).toBe('delivered');
    await post({ type: 'email.bounced', data: { email_id: 're_1' } });
    expect((await status(n)).delivery_status).toBe('bounced');
  });
  it('rejects forged, stale and unsigned events, and ignores unknown emails and event types', async () => {
    const n = await email('re_2');
    expect((await post({ type: 'email.delivered', data: { email_id: 're_2' } }, { secret: 'whsec_' + randomBytes(24).toString('base64') })).statusCode).toBe(401);
    expect((await post({ type: 'email.delivered', data: { email_id: 're_2' } }, { ts: Math.floor(Date.now() / 1000) - 3600 })).statusCode).toBe(401);
    expect((await c.app.inject({ method: 'POST', url: '/v1/webhooks/resend', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(401);
    expect(await status(n)).toEqual({ status: 'sent', delivery_status: null });
    expect((await post({ type: 'email.delivered', data: { email_id: 'unknown' } })).statusCode).toBe(200);
    expect((await post({ type: 'email.opened', data: { email_id: 're_2' } })).statusCode).toBe(200);
    expect(await status(n)).toEqual({ status: 'sent', delivery_status: null });
  });
});
