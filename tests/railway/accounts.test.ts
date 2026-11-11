import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadLoginAliases } from '../../scripts/staging/accounts';
import { loadWorkspaces, type StagingConfig } from '../../scripts/staging/config';
import { startStagingGateway, type StagingWorkspace } from '../../scripts/staging/gateway';

describe('assigned tester identities without engine or schema changes', () => {
  let cloud: Cloud, config: StagingConfig, workspaces: StagingWorkspace[], accounts: TestAccount[], gateway: Awaited<ReturnType<typeof startStagingGateway>>;
  const emails = ['first@example.test', 'second@example.test'], passwords = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')]; let ready = true;
  beforeAll(async () => {
    cloud = await startCloud(); const staticDir = tempDir(); writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    config = { origin: 'http://127.0.0.1:0', apiUrl: cloud.url, dataDir: tempDir(), key: randomBytes(32).toString('hex'), clientDir: staticDir, adminDir: staticDir };
    await provisionStaging(config, ADMIN, emails, passwords); accounts = JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')); workspaces = loadWorkspaces(config);
    gateway = await startStagingGateway({ ...config, workspaces, loginAliases: loadLoginAliases(config.dataDir), readiness: async () => ready, port: 0 });
  });
  afterAll(async () => { await gateway?.close(); for (const w of workspaces ?? []) w.engine.db.close(); await cloud?.close(); });
  const call = async (workspace: string, command: string, input: unknown, cookie?: string) => {
    const r = await fetch(gateway.url + `/client/${workspace}/invoke`, { method: 'POST', headers: { origin: gateway.publicOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ command, input }) }); return { body: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  it('allows each assigned email to sign in to its own sample business and keeps passwords private', async () => {
    const assigned = accounts.filter(a => a.email); expect(assigned).toHaveLength(2);
    expect(assigned.every((a, i) => createHash('sha256').update(a.password).digest('hex') === createHash('sha256').update(passwords[i]).digest('hex'))).toBe(true);
    for (const a of assigned) {
      const login = await call(a.workspace, 'auth.login', { username: a.email!.toUpperCase(), password: a.password }); expect(login.body.ok).toBe(true); expect(login.body.data.user.role).toBe('owner'); expect(login.body.data.token).toBeUndefined();
      expect((await call(a.workspace, 'app.state', {}, login.cookie)).body.data.user.username).toBe(a.username);
      const other = a.workspace === 'shop-a' ? 'shop-b' : 'shop-a'; expect((await call(other, 'product.list', {}, login.cookie)).body.error.code).toBe('NOT_SIGNED_IN');
      const bridge = await (await fetch(gateway.url + `/client/${a.workspace}/bridge.js`)).text(); expect(bridge.includes(a.email!)).toBe(false); expect(bridge.includes(a.password)).toBe(false);
    }
  });
  it('preserves assigned credentials on rerun and refuses identity changes without resetting stores', async () => {
    const digest = () => createHash('sha256').update(readFileSync(join(config.dataDir, 'test-accounts.json'))).digest('hex'); const original = digest();
    expect(await provisionStaging(config, ADMIN, emails, passwords)).toEqual({ existing: true }); expect(digest()).toBe(original);
    await expect(provisionStaging(config, ADMIN, ['changed@example.test', emails[1]])).rejects.toThrow('identities changed'); expect(digest()).toBe(original);
    await expect(provisionStaging(config, ADMIN, emails, [randomBytes(32).toString('base64url'), passwords[1]])).rejects.toThrow('passwords changed'); expect(digest()).toBe(original);
  });
  it('reports readiness failure instead of keeping a green deployment health check', async () => {
    expect((await fetch(gateway.url + '/healthz')).status).toBe(200); ready = false; expect((await fetch(gateway.url + '/healthz')).status).toBe(503); ready = true;
  });
});
