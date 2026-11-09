import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword, RateLimiter, sha256 } from '../../apps/api/src/security';
import { hashPassword as localHash, verifyPassword as localVerify } from '../../apps/desktop/src/core/passwords';
import { startCloud, type Cloud } from '../cloud';

describe('password hash validation', () => {
  for (const [name, hash, verify] of [['api', hashPassword, verifyPassword], ['desktop', localHash, localVerify]] as const) {
    it(`${name} rejects malformed hashes and unsafe work factors`, () => {
      const stored = hash('strong-password');
      expect(verify('strong-password', stored)).toBe(true);
      expect(verify('wrong', stored)).toBe(false);
      for (const value of ['scrypt$32768$8$1$$', stored.replace('$32768$', '$1073741824$'), stored.slice(0, -8), 'invalid']) {
        expect(verify('anything', value)).toBe(false);
      }
    });
  }
  it('bounds limiter state and releases expired entries', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1, 1000, 2);
      limiter.check('a'); limiter.check('b');
      expect(() => limiter.check('c')).toThrow(/Too many attempts/);
      expect(() => limiter.check('a')).toThrow(/Too many attempts/);
      vi.advanceTimersByTime(1000);
      expect(() => limiter.check('c')).not.toThrow();
    } finally { vi.useRealTimers(); }
  });
});

describe('API hardening', () => {
  let cloud: Cloud;
  let token: string;
  beforeAll(async () => {
    cloud = await startCloud();
    const client = await cloud.createClient('Hardening');
    token = (await cloud.api('POST', '/v1/devices/activate', { code: client.code, deviceName: 'test', appVersion: '1' }, null)).body.deviceToken;
  });
  afterAll(async () => { await cloud?.close(); });
  it('authenticates backup uploads before parsing the body', async () => {
    const response = await cloud.app.inject({ method: 'PUT', url: `/v1/backups/${randomUUID()}`, headers: { 'content-type': 'application/json' }, payload: '{invalid' });
    expect(response.statusCode).toBe(401);
  });
  it('keeps backup bytes and metadata immutable across retries', async () => {
    const id = randomUUID();
    const first = Buffer.from('encrypted-backup-one');
    const put = (content: Buffer) => cloud.app.inject({ method: 'PUT', url: `/v1/backups/${id}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-sha256': sha256(content) }, payload: content });
    expect((await put(first)).statusCode).toBe(200);
    expect((await put(first)).statusCode).toBe(200);
    expect((await put(Buffer.from('different-backup'))).statusCode).toBe(409);
    const latest = await cloud.app.inject({ method: 'GET', url: '/v1/backups/latest', headers: { authorization: `Bearer ${token}` } });
    expect(latest.rawPayload).toEqual(first);
    expect(latest.headers['x-sha256']).toBe(sha256(first));
    expect(latest.headers['cache-control']).toBe('no-store');
  });
  it('ignores spoofed forwarding headers and limits attempts across emails', async () => {
    for (let i = 0; i < 30; i++) {
      const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/login', headers: { 'x-forwarded-for': `192.0.2.${i + 1}` }, payload: { email: `missing${i}@example.com`, password: 'wrong' } });
      if (response.statusCode === 429) return;
      expect(response.statusCode).toBe(401);
    }
    throw new Error('IP rate limit was bypassed');
  });
});
