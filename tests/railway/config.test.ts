import { createHash } from 'node:crypto';
import { writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { railwayConfig, persistentSecret } from '../../scripts/railway/config';
import { testerEmails, testerPasswords } from '../../scripts/staging/accounts';
import { tempDir } from '../helpers';
const env = { MANSORA_STAGING_MODE: 'team-test', DATABASE_URL: 'postgres://operator:fixture-only@postgres:5432/railway', RAILWAY_PUBLIC_DOMAIN: 'example.up.railway.app', STAGING_TESTER_EMAILS: '["First@example.test","Second@example.test"]' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
describe('Railway deployment configuration', () => {
  it('derives HTTPS and requires private PostgreSQL and two distinct tester identities', () => {
    const c = railwayConfig(env); expect(c.origin).toBe('https://example.up.railway.app'); expect(c.emails).toEqual(['first@example.test', 'second@example.test']); expect(c.port).toBe(8080);
    expect(() => railwayConfig({ ...env, DATABASE_URL: 'postgres://user:fixture@production.example/db' })).toThrow('private Railway');
    expect(() => railwayConfig({ ...env, STAGING_TESTER_EMAILS: undefined })).toThrow(); expect(() => railwayConfig({ ...env, PAYSTACK_SECRET_KEY: 'fixture' })).toThrow();
    // A Paystack test key is allowed (test mode moves no money); live keys, Hubtel secrets and redirected Paystack addresses are not.
    expect(() => railwayConfig({ ...env, PAYSTACK_SECRET_KEY: 'sk_test_' + 'a1'.repeat(20) })).not.toThrow();
    expect(() => railwayConfig({ ...env, PAYSTACK_SECRET_KEY: 'sk_live_' + 'a1'.repeat(20) })).toThrow('test secret key');
    expect(() => railwayConfig({ ...env, PAYSTACK_SECRET_KEY: 'sk_test_' + 'a1'.repeat(20), PAYSTACK_BASE_URL: 'https://example.test' })).toThrow();
    expect(() => railwayConfig({ ...env, HUBTEL_CLIENT_SECRET: 'x' })).toThrow();
  });
  it('permits explicitly selected client mode without creating tester identities and rejects conflicting modes', () => {
    expect(railwayConfig({ ...env, MANSORA_STAGING_MODE: undefined, MANSORA_DEPLOYMENT_MODE: 'client', STAGING_TESTER_EMAILS: undefined })).toMatchObject({ mode: 'client', emails: [] });
    expect(() => railwayConfig({ ...env, MANSORA_DEPLOYMENT_MODE: 'client' })).toThrow('disagree');
  });
  it('rejects insecure public origins, port collision, malformed and duplicate identities', () => {
    expect(() => railwayConfig({ ...env, STAGING_ORIGIN: 'http://example.com' })).toThrow(); expect(() => railwayConfig({ ...env, PORT: '4000' })).toThrow(); expect(() => railwayConfig({ ...env, PORT: 'NaN' })).toThrow();
    for (const raw of ['bad JSON', '["too short","also short"]', JSON.stringify(['same'.repeat(10), 'same'.repeat(10)])]) expect(() => testerPasswords(raw)).toThrow();
    for (const raw of ['not JSON', '["bad","also bad"]', '["one@example.test","ONE@example.test"]', '["one@example.test"]']) expect(() => testerEmails(raw)).toThrow();
  });
  it('persists distinct private keys and refuses to silently replace a damaged existing key', () => {
    const directory = tempDir(); const before = persistentSecret(directory, 'master_key'), same = persistentSecret(directory, 'master_key');
    expect(hash(before)).toBe(hash(same)); expect(hash(persistentSecret(directory, 'other_key')) === hash(before)).toBe(false); expect(Buffer.from(persistentSecret(directory, 'billing_key', 'base64'), 'base64')).toHaveLength(32);
    if (process.platform !== 'win32') { expect(statSync(directory).mode & 0o777).toBe(0o700); expect(statSync(join(directory, 'master_key')).mode & 0o777).toBe(0o600); }
    writeFileSync(join(directory, 'master_key'), 'damaged'); expect(() => persistentSecret(directory, 'master_key')).toThrow('will not be replaced');
  });
});
