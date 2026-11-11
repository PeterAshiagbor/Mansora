import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailDeliveryError, ResendEmail, resendFromEnv } from '../../apps/api/src/email';
import { deliverQueued, queueEmail } from '../../apps/api/src/billing';
import { buildApp } from '../../apps/api/src/app';
import { tempDir } from '../helpers';
import { startCloud, type Cloud } from '../cloud';

describe('Resend HTTPS adapter', () => {
  it('uses verified sender, reply-to, text and a stable idempotency header', async () => {
    const transport = vi.fn(async (_url: any, _init: any) => new Response(JSON.stringify({ id: 'provider-message' }), { status: 200 }));
    const email = new ResendEmail({ apiKey: 'private-marker', from: 'Mansora <notifications@mansora.example>', replyTo: 'operator@example.test', fetch: transport as any });
    expect(await email.send({ to: 'client@example.test', subject: 'Reminder', body: 'Plain text', idempotencyKey: 'notification/1' })).toEqual({ id: 'provider-message' });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers['idempotency-key']).toBe('notification/1');
    expect(JSON.parse(init.body)).toMatchObject({ reply_to: 'operator@example.test', to: ['client@example.test'], text: 'Plain text' });
  });
  it('retries timeouts/rate limits/server errors without exposing provider bodies or credentials', async () => {
    for (const status of [429, 500, 503]) {
      const email = new ResendEmail({ apiKey: 'private-marker', from: 'sender@example.test', fetch: (async () => new Response('sensitive-provider-body', { status })) as any });
      await expect(email.send({ to: 'client@example.test', subject: 'Test', body: 'message' })).rejects.toMatchObject({ retryable: true, message: `Resend rejected delivery (HTTP ${status}).` });
    }
    const email = new ResendEmail({ apiKey: 'key', from: 'sender@example.test', fetch: (async () => { throw new Error('private-marker'); }) as any });
    await expect(email.send({ to: 'client@example.test', subject: 'Test', body: 'body' })).rejects.toMatchObject({ retryable: true, message: 'Resend could not be reached; delivery will retry.' });
  });
  it('refuses nonallowlisted test recipients and terminal provider failures', async () => {
    const transport = vi.fn();
    const email = new ResendEmail({ apiKey: 'key', from: 'sender@example.test', allowedRecipients: ['operator@example.test'], fetch: transport });
    await expect(email.send({ to: 'customer@example.test', subject: 'Test', body: 'body' })).rejects.toMatchObject({ retryable: false });
    expect(transport).not.toHaveBeenCalled();
    const badKey = new ResendEmail({ apiKey: 'key', from: 'sender@example.test', fetch: (async () => new Response('secret', { status: 401 })) as any });
    await expect(badKey.send({ to: 'client@example.test', subject: 'Test', body: 'body' })).rejects.toMatchObject({ retryable: false });
  });
  it('fails closed when team testing has credentials without a recipient allowlist', () => {
    vi.stubEnv('MANSORA_STAGING_MODE', 'team-test'); vi.stubEnv('RESEND_API_KEY', 'key'); vi.stubEnv('RESEND_ALLOWED_RECIPIENTS', '');
    try { expect(() => resendFromEnv()).toThrow('RESEND_ALLOWED_RECIPIENTS'); } finally { vi.unstubAllEnvs(); }
  });
  it('reports an unverified sender without exposing the provider response or address', async () => {
    const email = new ResendEmail({ apiKey: 'key', from: 'sender@example.test', fetch: (async () => new Response(JSON.stringify({ message: 'The private-marker.test domain is not verified.' }), { status: 403 })) as any });
    await expect(email.send({ to: 'client@example.test', subject: 'Test', body: 'body' })).rejects.toMatchObject({ message: 'Resend sender domain is not verified.', retryable: false });
  });
});

describe('durable message delivery and administrator communications', () => {
  let cloud: Cloud;
  beforeAll(async () => { cloud = await startCloud(); });
  afterAll(async () => { await cloud?.close(); });
  beforeEach(async () => { await cloud.db.platform(q => q("UPDATE notifications SET status = 'skipped' WHERE status = 'queued'")); });
  const queued = () => cloud.db.platform(q => queueEmail(q, { to: 'client@example.test', subject: 'Reminder', body: 'private-body-marker', kind: 'test' }));
  const read = (id: string) => cloud.db.platform(async q => (await q('SELECT * FROM notifications WHERE id = $1', [id]))[0]);
  it('persists provider ID and sends once even when two workers run', async () => {
    const id = await queued();
    const send = vi.fn(async (_message: any) => ({ id: 'resend-id' })); cloud.billing.email = { configured: () => true, send };
    await Promise.all([deliverQueued(cloud.billing), deliverQueued(cloud.billing)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ idempotencyKey: `mansora-notification/${id}` });
    expect(await read(id)).toMatchObject({ status: 'sent', provider_message_id: 'resend-id', attempt_count: 1 });
  });
  it('backs off temporary failures then retries with the same key', async () => {
    const id = await queued();
    const send = vi.fn().mockRejectedValueOnce(new EmailDeliveryError('Temporary failure', true)).mockResolvedValue({ id: 'recovered' });
    cloud.billing.email = { configured: () => true, send };
    expect(await deliverQueued(cloud.billing)).toMatchObject({ failed: 1, waiting: 1 });
    await deliverQueued(cloud.billing); expect(send).toHaveBeenCalledTimes(1);
    cloud.clock.now = new Date(cloud.clock.now.getTime() + 3 * 60_000);
    await deliverQueued(cloud.billing); expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].idempotencyKey).toBe(send.mock.calls[1][0].idempotencyKey);
    expect(await read(id)).toMatchObject({ status: 'sent', attempt_count: 2, error: null });
  });
  it('does not retry an ambiguous send after Resend idempotency protection expires', async () => {
    const id = await queued();
    await cloud.db.platform(q => q("UPDATE notifications SET delivery_started_at = $2 WHERE id = $1", [id, new Date(cloud.clock.now.getTime() - 24 * 3_600_000).toISOString()]));
    const send = vi.fn(); cloud.billing.email = { configured: () => true, send };
    await deliverQueued(cloud.billing);
    expect(send).not.toHaveBeenCalled(); expect((await read(id)).status).toBe('failed');
    expect((await cloud.api('POST', `/v1/admin/billing/notifications/${id}/retry`, {})).status).toBe(409);
  });
  it('authenticates composition, resolves client billing contact and deduplicates a submission', async () => {
    const client = await cloud.createClient('Communication fixture');
    await cloud.db.platform(q => q('UPDATE tenants SET email = $2 WHERE id = $1', [client.id, 'client@example.test']));
    const body = { id: randomUUID(), tenantId: client.id, subject: 'Service update', body: 'Your service message' };
    expect((await cloud.api('POST', '/v1/admin/billing/notifications', body, null)).status).toBe(401);
    expect((await cloud.api('POST', '/v1/admin/billing/notifications', body)).status).toBe(200);
    expect((await cloud.api('POST', '/v1/admin/billing/notifications', body)).body.duplicate).toBe(true);
    expect((await read(body.id)).to_address).toBe('client@example.test');
    expect((await cloud.api('POST', '/v1/admin/billing/notifications', { ...body, subject: 'Changed' })).status).toBe(409);
  });
  it('queues redacted, throttled platform errors without leaking request data', async () => {
    const messages: any[] = [];
    const app = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir(), queueErrorEmail: async message => { messages.push(message); } });
    app.post('/test/platform-failure', () => { throw new Error('password=secret-marker'); });
    try {
      for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'POST', url: '/test/platform-failure?token=secret-marker', payload: { password: 'secret-marker' } })).statusCode).toBe(500);
      await app.close();
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toContain('/test/platform-failure');
      expect(JSON.stringify(messages)).not.toContain('secret-marker');
    } finally { await app.close(); }
  });
});
