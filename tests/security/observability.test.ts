import { randomUUID } from 'node:crypto';
import { SYNC_PROTOCOL_VERSION } from '@mansora/domain';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { requestId, safeError } from '../../apps/api/src/observability';
import { sha256 } from '../../apps/api/src/security';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const metricsToken = randomUUID() + randomUUID();
const passwordMarker = randomUUID();
const payloadMarker = randomUUID();
const backupBytes = Buffer.from('synthetic-backup-' + randomUUID());
const errorMarker = randomUUID();
let cloud: Cloud, app: Awaited<ReturnType<typeof buildApp>>, webhook: Server, deviceToken: string, deviceId: string, tenantId: string;
const logs: string[] = [], reports: any[] = [];
const error = () => Object.assign(new Error(errorMarker), { code: 'TEST_FAILURE', name: errorMarker });
beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Observability fixture'); tenantId = client.id;
  const activation = await cloud.api('POST', '/v1/devices/activate', { code: client.code, deviceName: 'Synthetic device', appVersion: '1' }, null);
  deviceToken = activation.body.deviceToken; deviceId = activation.body.deviceId;
  webhook = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    reports.push(JSON.parse(Buffer.concat(chunks).toString())); res.writeHead(204).end();
  });
  await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', resolve));
  await cloud.app.close();
  app = await buildApp({ db: cloud.db, backupDir: tempDir(), metricsToken, logger: true, logStream: { write: (line) => logs.push(line) }, errorWebhookUrl: `http://127.0.0.1:${(webhook.address() as AddressInfo).port}` });
  app.get('/v1/admin/test/failure', () => { throw error(); });
  app.get('/test/logged-error', (req) => { req.log.error({ err: error(), eventId: randomUUID() }, 'Synthetic failure'); return { ok: false }; });
  await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
});
afterAll(async () => { await app?.close(); await cloud?.close(); if (webhook) await new Promise<void>((resolve) => webhook.close(() => resolve())); });
const records = () => logs.flatMap((chunk) => chunk.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('request IDs and health', () => {
  it('accepts bounded IDs, generates replacements and returns them on successful/error/not-found responses', async () => {
    for (const value of ['trace-123:part_2', 'a'.repeat(128)]) {
      const result = await app.inject({ url: '/health/live', headers: { 'x-request-id': value } });
      expect(result.statusCode).toBe(200); expect(result.headers['x-request-id']).toBe(value);
    }
    for (const value of ['', 'a'.repeat(129), '<script>', 'contains spaces']) {
      const result = await app.inject({ url: '/missing', headers: { 'x-request-id': value } });
      expect(result.statusCode).toBe(404); expect(result.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.json().requestId).toBe(result.headers['x-request-id']);
    }
    expect(requestId({ headers: { 'x-request-id': ['one', 'two'] } })).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId({ headers: { 'x-request-id': 'line\r\ninjection' } })).toMatch(/^[0-9a-f-]{36}$/);
    const unauthenticated = await app.inject({ url: '/v1/admin/clients', headers: { 'x-request-id': 'auth-denied' } });
    expect(unauthenticated.statusCode).toBe(401); expect(unauthenticated.json().requestId).toBe('auth-denied');
    const invalid = await app.inject({ method: 'POST', url: '/v1/admin/login', headers: { 'x-request-id': 'invalid-body' }, payload: {} });
    expect(invalid.statusCode).toBe(400); expect(invalid.json().requestId).toBe('invalid-body');
  });
  it('keeps liveness up and makes readiness/compatibility health fail when the database is unavailable', async () => {
    for (const url of ['/health', '/health/ready']) expect((await app.inject({ url })).statusCode).toBe(200);
    let offline = false;
    const unavailable = await buildApp({ db: { platform: (fn: any) => offline ? Promise.reject(new Error(errorMarker)) : cloud.db.platform(fn) } as any, backupDir: tempDir() });
    await unavailable.ready(); // Existing administrator-MFA startup verification needs the database.
    offline = true;
    try {
      expect((await unavailable.inject({ url: '/health/live' })).statusCode).toBe(200);
      for (const url of ['/health', '/health/ready']) {
        const result = await unavailable.inject({ url });
        expect(result.statusCode).toBe(503);
        expect(result.json()).toMatchObject({ code: 'DATABASE_UNAVAILABLE', requestId: result.headers['x-request-id'] });
        expect(result.body).not.toContain(errorMarker);
      }
    } finally { await unavailable.close(); }
  });
});

it('captures identity and counters without credentials, event payloads, binary bytes or raw errors', async () => {
  const login = await app.inject({ method: 'POST', url: '/v1/admin/login', payload: { email: ADMIN.email, password: ADMIN.password } });
  expect(login.statusCode).toBe(200); const adminToken = login.json().token;
  const failed = await app.inject({ method: 'POST', url: '/v1/admin/login', payload: { email: ADMIN.email, password: passwordMarker } });
  expect(failed.statusCode).toBe(401);
  const admin = await app.inject({ url: `/v1/admin/clients?private=${payloadMarker}`, headers: { ...bearer(adminToken), cookie: passwordMarker, 'x-request-id': 'admin-context' } });
  expect(admin.statusCode).toBe(200);
  expect((await app.inject({ url: `/v1/admin/clients/${tenantId}`, headers: { ...bearer(adminToken), 'x-request-id': 'admin-client-context' } })).statusCode).toBe(200);
  const now = new Date().toISOString();
  const event = { id: randomUUID(), seq: 1, type: 'product.save', occurredAt: now, actorId: null, payload: { rows: { products: [{ id: randomUUID(), sku: null, barcode: null, category_id: null, name: payloadMarker, unit: 'each', cost_price: 300, selling_price: 500, reorder_level: 1, active: 1, version: 1, created_at: now, updated_at: now }] } } };
  const sync = await app.inject({ method: 'POST', url: '/v1/sync/events', headers: { ...bearer(deviceToken), 'x-request-id': 'sync-context', 'x-tenant-id': passwordMarker }, payload: { protocol: SYNC_PROTOCOL_VERSION, events: [event, { id: randomUUID(), invalid: payloadMarker }], device: { appVersion: 'test', pendingCount: 2, lastBackupAt: null } } });
  expect(sync.statusCode).toBe(200); expect(sync.json().accepted).toHaveLength(1); expect(sync.json().rejected).toHaveLength(1);
  const backup = await app.inject({ method: 'PUT', url: `/v1/backups/${randomUUID()}`, headers: { ...bearer(deviceToken), 'content-type': 'application/octet-stream', 'x-sha256': sha256(backupBytes) }, payload: backupBytes });
  expect(backup.statusCode).toBe(200);
  await app.inject({ url: '/test/logged-error' });
  const failure = await app.inject({ url: '/v1/admin/test/failure', headers: { ...bearer(adminToken), 'x-request-id': 'failure-context' } });
  expect(failure.statusCode).toBe(500); expect(failure.json().requestId).toBe('failure-context');
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ requestId: 'failure-context', route: '/v1/admin/test/failure', statusCode: 500, error: { type: 'Error', code: 'TEST_FAILURE' } });
  expect(reports[0].adminId).toMatch(/^[0-9a-f-]{36}$/);
  const unauthorized = await app.inject({ url: '/metrics' }); expect(unauthorized.statusCode).toBe(401);
  expect((await app.inject({ url: '/metrics', headers: bearer(passwordMarker) })).statusCode).toBe(401);
  const metrics = await app.inject({ url: '/metrics', headers: bearer(metricsToken) });
  expect(metrics.statusCode).toBe(200); expect(metrics.headers['content-type']).toContain('text/plain');
  expect(metrics.headers['x-content-type-options']).toBe('nosniff');
  expect(metrics.headers['cache-control']).toBe('no-store');
  expect(metrics.body).toContain('mansora_sync_events_accepted_total 1');
  expect(metrics.body).toContain('mansora_sync_events_rejected_total 1');
  expect(metrics.body).toMatch(/mansora_login_failures_total [1-9]/);
  expect(metrics.body).toContain('mansora_http_request_duration_seconds_bucket');
  expect(metrics.body).toContain('route="/v1/backups/:id"');
  await expect.poll(() => records().filter((r) => r.event === 'request_completed' && r.requestId === 'sync-context').length).toBe(1);
  expect(records().find((r) => r.event === 'request_completed' && r.requestId === 'sync-context')).toMatchObject({ tenantId, deviceId });
  expect(records().find((r) => r.event === 'request_completed' && r.requestId === 'admin-context').adminId).toBe(reports[0].adminId);
  expect(records().find((r) => r.event === 'request_completed' && r.requestId === 'admin-client-context')).toMatchObject({ adminId: reports[0].adminId, tenantId });
  const captured = logs.join('') + JSON.stringify(reports) + metrics.body;
  for (const secret of [ADMIN.password, ADMIN.email, passwordMarker, payloadMarker, backupBytes.toString(), errorMarker, adminToken, deviceToken, metricsToken]) expect(captured).not.toContain(secret);
  expect(captured).not.toContain('token_hash'); expect(captured).not.toContain('password_hash');
});

it('disables metrics and outbound reporting when unset, and validates configuration', async () => {
  const noHook = await buildApp({ db: cloud.db, backupDir: tempDir() });
  noHook.get('/test/failure', () => { throw error(); });
  const spy = vi.spyOn(globalThis, 'fetch');
  try {
    expect((await noHook.inject({ url: '/metrics' })).statusCode).toBe(404);
    expect((await noHook.inject({ url: '/test/failure' })).statusCode).toBe(500);
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); await noHook.close(); }
  await expect(buildApp({ db: cloud.db, backupDir: tempDir(), metricsToken: 'short' })).rejects.toThrow(/METRICS_TOKEN/);
  await expect(buildApp({ db: cloud.db, backupDir: tempDir(), errorWebhookUrl: 'file:///tmp/report' })).rejects.toThrow(/ERROR_WEBHOOK_URL/);
  await expect(buildApp({ db: cloud.db, backupDir: tempDir(), errorWebhookUrl: passwordMarker })).rejects.toThrow('ERROR_WEBHOOK_URL must be a valid HTTP(S) URL');
  expect(safeError(Object.assign(new Error(passwordMarker), { name: passwordMarker, code: passwordMarker }))).toEqual({ type: 'Error' });
});

it('does not fail the response or expose delivery errors when the error webhook is unavailable', async () => {
  const captured: string[] = [];
  const reporter = await buildApp({ db: cloud.db, backupDir: tempDir(), errorWebhookUrl: 'http://127.0.0.1:1/private-webhook', logStream: { write: (line) => captured.push(line) } });
  reporter.get('/test/failure', () => { throw error(); });
  const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(passwordMarker));
  try {
    const response = await reporter.inject({ url: '/test/failure', headers: { 'x-request-id': 'webhook-unavailable' } });
    expect(response.statusCode).toBe(500);
    await reporter.close();
    expect(spy).toHaveBeenCalledOnce();
    expect(captured.join('')).toContain('error_webhook_failed');
    expect(captured.join('')).not.toContain(passwordMarker);
    expect(captured.join('')).not.toContain('private-webhook');
    expect(captured.join('')).not.toContain(errorMarker);
  } finally { spy.mockRestore(); await reporter.close(); }
});
