import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { base32, decryptTotpSecret, encryptTotpSecret, matchTotp, normaliseRecoveryCode, sha256, totpCode } from '../../apps/api/src/security';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

// Published RFC 6238 Appendix B SHA-1 vectors (not an application credential).
it('matches RFC 6238 SHA-1 reference vectors', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) {
    expect(totpCode(secret, seconds * 1000, 8)).toBe(expected);
  }
});

it('accepts only new codes within one time step of the server clock', () => {
  const secret = base32(randomBytes(20));
  const time = 1_700_000_010_000;
  const current = Math.floor(time / 30_000);
  for (const delta of [-1, 0, 1]) expect(matchTotp(secret, totpCode(secret, time + delta * 30_000), -1, time)).toBe(current + delta);
  expect(matchTotp(secret, totpCode(secret, time), current, time)).toBeNull();
  expect(matchTotp(secret, totpCode(secret, time - 60_000), -1, time)).toBeNull();
});

describe('administrator TOTP', () => {
  let cloud: Cloud;
  let previousKey: string | undefined;
  let adminId: string;
  let sessionToken: string;
  let remote = 0;
  const request = async (method: 'GET' | 'POST', url: string, payload?: unknown, token: string | null = sessionToken) => {
    const response = await cloud.app.inject({ method, url, payload: payload as any, remoteAddress: `192.0.2.${(++remote % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: response.statusCode, body: response.json() };
  };
  const login = () => request('POST', '/v1/admin/login', { email: ADMIN.email, password: ADMIN.password }, null);
  const start = async () => {
    const result = await request('POST', '/v1/admin/totp/enrol', { password: ADMIN.password });
    expect(result.status).toBe(200);
    return result.body;
  };
  const enrol = async () => {
    const pending = await start();
    const response = await request('POST', '/v1/admin/totp/confirm', { code: totpCode(pending.secret) });
    expect(response.status).toBe(200);
    return { ...pending, recoveryCodes: response.body.recoveryCodes as string[] };
  };
  const verify = (challenge: string, code: string) => request('POST', '/v1/admin/login/totp', { challenge, code }, null);

  beforeAll(async () => {
    previousKey = process.env.ADMIN_TOTP_KEY;
    process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
    cloud = await startCloud();
    adminId = (await cloud.api('GET', '/v1/admin/me')).body.id;
  });
  beforeEach(async () => {
    // Hold the verifier at the middle of a step so +/-1 tests cannot cross a
    // real wall-clock boundary while requests or PostgreSQL locks are pending.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(Math.floor(now / 30_000) * 30_000 + 15_000);
    await cloud.db.platform(async (q) => {
      await q('DELETE FROM admin_totp_recovery_codes');
      await q('DELETE FROM admin_totp_challenges');
      await q('DELETE FROM admin_totp');
    });
    sessionToken = (await login()).body.token;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await cloud?.close();
    if (previousKey === undefined) delete process.env.ADMIN_TOTP_KEY;
    else process.env.ADMIN_TOTP_KEY = previousKey;
  });

  it('encrypts secrets with randomized envelopes bound to the administrator', () => {
    const secret = base32(randomBytes(20));
    const encrypted = encryptTotpSecret(secret, adminId);
    expect(encrypted).not.toContain(secret);
    expect(encryptTotpSecret(secret, adminId)).not.toBe(encrypted);
    expect(decryptTotpSecret(encrypted, adminId)).toBe(secret);
    expect(() => decryptTotpSecret(encrypted, randomUUID())).toThrow(/unavailable/);
    expect(() => decryptTotpSecret(encrypted.slice(0, -4), adminId)).toThrow(/unavailable/);
  });

  it('requires authentication, a password and a configured key to enrol', async () => {
    expect((await request('POST', '/v1/admin/totp/enrol', { password: ADMIN.password }, null)).status).toBe(401);
    expect((await request('POST', '/v1/admin/totp/enrol', { password: randomBytes(20).toString('hex') })).status).toBe(400);
    const key = process.env.ADMIN_TOTP_KEY;
    try {
      delete process.env.ADMIN_TOTP_KEY;
      expect((await request('POST', '/v1/admin/totp/enrol', { password: ADMIN.password })).status).toBe(503);
      process.env.ADMIN_TOTP_KEY = randomBytes(16).toString('base64');
      expect((await request('POST', '/v1/admin/totp/enrol', { password: ADMIN.password })).status).toBe(503);
    } finally { process.env.ADMIN_TOTP_KEY = key; }
  });

  it('requires a correct confirmation code and stores only encrypted secrets and hashed recovery codes', async () => {
    const pending = await start();
    const uri = new URL(pending.uri);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(pending.secret);
    expect(uri.searchParams.get('issuer')).toBe('Mansora');
    expect((await request('POST', '/v1/admin/totp/confirm', { code: 'invalid' })).status).toBe(400);
    expect((await request('GET', '/v1/admin/totp')).body.enabled).toBe(false);
    const confirmed = await request('POST', '/v1/admin/totp/confirm', { code: totpCode(pending.secret) });
    expect(confirmed.status).toBe(200);
    expect(new Set(confirmed.body.recoveryCodes).size).toBe(10);
    const state = await cloud.db.platform(async (q) => ({ factor: (await q('SELECT * FROM admin_totp WHERE admin_id = $1', [adminId]))[0], codes: await q('SELECT code_hash FROM admin_totp_recovery_codes WHERE admin_id = $1', [adminId]) }));
    expect(state.factor.secret_encrypted).not.toContain(pending.secret);
    expect(state.factor.pending_secret_encrypted).toBeNull();
    expect(state.codes.map((r) => r.code_hash).sort()).toEqual(confirmed.body.recoveryCodes.map((c: string) => sha256(normaliseRecoveryCode(c))).sort());
    expect((await request('GET', '/v1/admin/totp')).body).toEqual({ enabled: true, recoveryCodesRemaining: 10 });
    const audit = (await request('GET', '/v1/admin/audit')).body;
    expect(audit.some((a: any) => a.action === 'admin.totp.verification_failed')).toBe(true);
    expect(audit.some((a: any) => a.action === 'admin.totp.enabled')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(pending.secret);
    for (const code of confirmed.body.recoveryCodes) expect(JSON.stringify(audit)).not.toContain(code);
  });

  it('does not issue a session on password alone and rejects replay of the confirmation code', async () => {
    const pending = await enrol();
    const result = await login();
    expect(result.body.requiresTotp).toBe(true);
    expect(result.body.token).toBeUndefined();
    expect((await request('GET', '/v1/admin/clients', undefined, result.body.challenge)).status).toBe(401);
    expect((await verify(result.body.challenge, totpCode(pending.secret))).status).toBe(401);
    const accepted = await verify(result.body.challenge, pending.recoveryCodes[0]);
    expect(accepted.status).toBe(200);
    expect((await request('GET', '/v1/admin/me', undefined, accepted.body.token)).status).toBe(200);
    expect((await verify(result.body.challenge, pending.recoveryCodes[1])).status).toBe(401);
  });

  for (const skew of [-1, 0, 1]) {
    it(`completes a login with a fresh authenticator code at clock skew ${skew}`, async () => {
      const pending = await start();
      // Confirm in a previous step, then log in with the current +/- one-step code.
      const old = totpCode(pending.secret, Date.now() - 30_000);
      expect((await request('POST', '/v1/admin/totp/confirm', { code: old })).status).toBe(200);
      if (skew === -1) await cloud.db.platform((q) => q('UPDATE admin_totp SET last_used_step = last_used_step - 1 WHERE admin_id = $1', [adminId]));
      const challenge = (await login()).body.challenge;
      const code = totpCode(pending.secret, Date.now() + skew * 30_000);
      const result = await verify(challenge, code);
      expect(result.status).toBe(200);
      const nextChallenge = (await login()).body.challenge;
      expect((await verify(nextChallenge, code)).status).toBe(401);
    });
  }

  it('consumes each recovery code once and audits its use', async () => {
    const { recoveryCodes } = await enrol();
    const first = await verify((await login()).body.challenge, recoveryCodes[0].toLowerCase());
    expect(first.status).toBe(200);
    expect((await verify((await login()).body.challenge, recoveryCodes[0])).status).toBe(401);
    expect((await request('GET', '/v1/admin/totp')).body.recoveryCodesRemaining).toBe(9);
    expect((await request('GET', '/v1/admin/audit')).body.some((a: any) => a.action === 'admin.totp.recovery_used')).toBe(true);
  });

  it('rate-limits failed codes per administrator across challenges and source IPs', async () => {
    const { recoveryCodes } = await enrol();
    let challenge = (await login()).body.challenge;
    for (let attempt = 0; attempt < 5; attempt++) expect((await verify(challenge, 'invalid')).status).toBe(401);
    challenge = (await login()).body.challenge;
    expect((await verify(challenge, recoveryCodes[0])).status).toBe(429);
    // The counter survives a new app instance and expires without consuming a recovery code.
    const another = await buildApp({ db: cloud.db, backupDir: tempDir() });
    try {
      expect((await another.inject({ method: 'POST', url: '/v1/admin/login/totp', payload: { challenge, code: recoveryCodes[0] } })).statusCode).toBe(429);
    } finally { await another.close(); }
    await cloud.db.platform((q) => q("UPDATE admin_totp SET attempts_reset_at = now() - interval '1 minute' WHERE admin_id = $1", [adminId]));
    expect((await verify(challenge, recoveryCodes[0])).status).toBe(200);
  });

  it('allows at most one session from concurrent attempts with the same challenge and recovery code', async () => {
    const { recoveryCodes } = await enrol();
    const challenge = (await login()).body.challenge;
    const results = await Promise.all([verify(challenge, recoveryCodes[0]), verify(challenge, recoveryCodes[0])]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('expires challenges and pending enrolments and replaces older challenges', async () => {
    const pending = await start();
    await cloud.db.platform((q) => q("UPDATE admin_totp SET pending_expires_at = now() - interval '1 minute' WHERE admin_id = $1", [adminId]));
    expect((await request('POST', '/v1/admin/totp/confirm', { code: totpCode(pending.secret) })).body.code).toBe('ENROLMENT_EXPIRED');
    const { recoveryCodes } = await enrol();
    const old = (await login()).body.challenge;
    const fresh = (await login()).body.challenge;
    expect((await verify(old, recoveryCodes[0])).status).toBe(401);
    await cloud.db.platform((q) => q("UPDATE admin_totp_challenges SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [sha256(fresh)]));
    expect((await verify(fresh, recoveryCodes[0])).status).toBe(401);
  });

  it('revokes older sessions on enrolment and requires both factors to disable', async () => {
    const oldSession = (await login()).body.token;
    const { recoveryCodes } = await enrol();
    expect((await request('GET', '/v1/admin/me', undefined, oldSession)).status).toBe(401);
    expect((await request('POST', '/v1/admin/totp/disable', { password: ADMIN.password, code: 'invalid' })).status).toBe(400);
    expect((await request('POST', '/v1/admin/totp/disable', { password: randomBytes(20).toString('hex'), code: recoveryCodes[0] })).status).toBe(400);
    const disabled = await request('POST', '/v1/admin/totp/disable', { password: ADMIN.password, code: recoveryCodes[0] });
    expect(disabled.status).toBe(200);
    expect((await request('GET', '/v1/admin/me')).status).toBe(401);
    expect((await login()).body.token).toBeTypeOf('string');
    const [factor] = await cloud.db.platform((q) => q('SELECT * FROM admin_totp WHERE admin_id = $1', [adminId]));
    expect(factor.secret_encrypted).toBeNull();
  });

  it('fails closed when an enrolled account loses its encryption key', async () => {
    await enrol();
    const key = process.env.ADMIN_TOTP_KEY;
    try {
      delete process.env.ADMIN_TOTP_KEY;
      expect((await login()).status).toBe(503);
      const another = await buildApp({ db: cloud.db, backupDir: tempDir() });
      try { await expect(another.ready()).rejects.toThrow(/unavailable/); } finally { await another.close(); }
    } finally { process.env.ADMIN_TOTP_KEY = key; }
  });

  it('keeps MFA records outside the tenant role', async () => {
    const created = await request('POST', '/v1/admin/clients', { name: 'MFA isolation test', ownerName: 'Test owner' });
    expect(created.status).toBe(200);
    const client = created.body;
    for (const table of ['admin_totp', 'admin_totp_challenges', 'admin_totp_recovery_codes']) {
      await expect(cloud.db.tenant(client.id, (q) => q(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
  });
});
