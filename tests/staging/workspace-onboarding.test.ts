import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadLoginAliases } from '../../scripts/staging/accounts';
import { workspaceKey, type StagingConfig } from '../../scripts/staging/config';
import { openEngine } from '../../apps/desktop/src/core';
import { startConfiguredStaging } from '../../scripts/staging/server';
import { createWorkspaceOnboarding, type WorkspaceOnboarding } from '../../scripts/staging/workspace-onboarding';
import type { StagingWorkspace } from '../../scripts/staging/gateway';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

let cloud: Cloud, config: StagingConfig, app: Awaited<ReturnType<typeof buildApp>>, gateway: Awaited<ReturnType<typeof startConfiguredStaging>>, manager: WorkspaceOnboarding;
let workspaces: StagingWorkspace[], accounts: TestAccount[], third: string, link: string, proof: string, oldCookie = '';
const originalEnv = { ...process.env };
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const password = randomBytes(24).toString('base64url'), email = 'third-owner@example.test';
const api = async (path: string, input: unknown = {}, authorized = true) => cloud.api('POST', path, input, authorized ? cloud.adminToken : null);
async function setup(path: string, input: unknown, origin = gateway.publicOrigin) {
  const response = await fetch(gateway.url + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() as any };
}
async function invoke(workspace: string, command: string, input: unknown = {}, cookie = '') {
  const response = await fetch(`${gateway.url}/client/${workspace}/invoke`, { method: 'POST', headers: { origin: gateway.publicOrigin, 'content-type': 'application/json', cookie }, body: JSON.stringify({ command, input }) });
  return { status: response.status, body: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
beforeAll(async () => {
  cloud = await startCloud();
  const staticDir = tempDir(), dataDir = tempDir(), key = randomBytes(32).toString('hex'), keyFile = join(dataDir, 'key');
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><head></head><body>Workspace</body></html>'); writeFileSync(keyFile, key);
  config = { origin: 'http://127.0.0.1:0', apiUrl: cloud.url, dataDir, key, clientDir: staticDir, adminDir: staticDir };
  await provisionStaging(config, ADMIN);
  accounts = JSON.parse(readFileSync(join(dataDir, 'test-accounts.json'), 'utf8'));
  manager = createWorkspaceOnboarding(config);
  await cloud.app.close();
  app = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir(), browserWorkspaces: manager });
  await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
  Object.assign(process.env, { MANSORA_STAGING_MODE: 'team-test', STAGING_ORIGIN: config.origin, STAGING_API_URL: cloud.url, STAGING_DATA_DIR: dataDir, STAGING_DB_KEY_FILE: keyFile, STAGING_CLIENT_DIR: staticDir, STAGING_ADMIN_DIR: staticDir, STAGING_BIND_HOST: '127.0.0.1', PORT: '0' });
  gateway = await startConfiguredStaging(undefined, async ws => { workspaces = ws; }, manager);
  const owner = accounts.find(a => a.workspace === 'shop-a' && a.role === 'owner')!;
  oldCookie = (await invoke('shop-a', 'auth.login', { username: owner.username, password: owner.password })).cookie;
});
afterAll(async () => { await gateway?.close(); await app?.close(); await cloud?.close(); for (const name of ['MANSORA_STAGING_MODE','STAGING_ORIGIN','STAGING_API_URL','STAGING_DATA_DIR','STAGING_DB_KEY_FILE','STAGING_CLIENT_DIR','STAGING_ADMIN_DIR','STAGING_BIND_HOST','PORT']) { if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name]; } });

it('requires platform authentication and recorded owner contact; creates one private pending link on retry', async () => {
  const result = await api('/v1/admin/clients', { name: 'Third independent test shop', ownerName: 'Third owner', email, businessType: 'retail' });
  third = result.body.id;
  const path = `/v1/admin/clients/${third}/browser-workspace`;
  expect((await api(path, {}, false)).status).toBe(401);
  const responses = await Promise.all([api(path), api(path)]);
  expect(responses.map(r => r.status)).toEqual([200, 200]); expect(responses[0].body.url).toBe(responses[1].body.url);
  link = responses[0].body.url; proof = new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
  expect(proof).toHaveLength(43); expect(new URL(link).pathname).toBe('/onboarding/');
  expect(workspaces).toHaveLength(2);
  const journalPath = join(config.dataDir, 'browser-onboarding', third + '.json'), raw = readFileSync(journalPath, 'utf8');
  expect(raw).not.toContain(proof); expect(raw).not.toContain(password);
  if (process.platform !== 'win32') expect(statSync(journalPath).mode & 0o777).toBe(0o600);
  const audit = await cloud.db.platform(q => q('SELECT detail FROM admin_audit_logs WHERE tenant_id = $1', [third]));
  expect(JSON.stringify(audit)).not.toContain(proof);
  const existing = await cloud.api('GET', '/v1/admin/clients');
  const existingShop = existing.body.find((r: any) => r.name === 'Mansora TSA');
  expect((await api(`/v1/admin/clients/${existingShop.id}/browser-workspace`)).status).toBe(409);
  const missing = await api('/v1/admin/clients', { name: 'No contact test', ownerName: 'Owner', businessType: 'retail' });
  expect((await api(`/v1/admin/clients/${missing.body.id}/browser-workspace`)).status).toBe(400);
});

it('uses same-origin setup assets, refuses invalid/expired proof and preserves the owner password policy', async () => {
  const html = await fetch(gateway.url + '/onboarding/');
  expect(html.status).toBe(200); expect(html.headers.get('content-security-policy')).toContain("script-src 'self'");
  expect(await html.text()).not.toContain(proof);
  expect((await setup('/onboarding/details', { token: proof }, 'https://unrelated.example')).status).toBe(403);
  expect((await setup('/onboarding/details', { token: randomBytes(32).toString('base64url') })).status).toBe(410);
  expect((await setup('/onboarding/details', { token: proof })).body.data.businessName).toBe('Third independent test shop');
  expect((await setup('/onboarding/complete', { token: proof, password: 'short-pass' })).body.error.code).toBe('INVALID_PASSWORD');
  const future = createWorkspaceOnboarding(config, () => new Date(Date.now() + 31 * 60_000));
  expect(() => future.details(proof)).toThrow(/unavailable or expired/);
});

it('adds the third encrypted shop without a restart, keeps existing sessions, enforces isolation and joins real background sync', async () => {
  const server = gateway.server, address = gateway.url;
  const concurrent = await Promise.all([setup('/onboarding/complete', { token: proof, password, apiUrl: 'https://unrelated.invalid', tenantId: 'unrelated', code: 'not-the-bound-code' }), setup('/onboarding/complete', { token: proof, password })]);
  const result = concurrent.find(r => r.status === 200)!;
  expect(concurrent.filter(r => r.status === 200)).toHaveLength(1);
  expect([409, 410]).toContain(concurrent.find(r => r.status !== 200)!.status);
  expect(gateway.server).toBe(server); expect(gateway.url).toBe(address); expect(workspaces).toHaveLength(3);
  const workspace = result.body.data.workspaceId;
  expect((await invoke('shop-a', 'app.state', {}, oldCookie)).body.data.user.role).toBe('owner');
  expect((await invoke(workspace, 'app.state', {}, oldCookie)).body.data.user).toBeNull();
  const login = await invoke(workspace, 'auth.login', { username: email.toUpperCase(), password });
  expect(login.body.ok).toBe(true); expect(login.body.data).not.toHaveProperty('token');
  expect(login.cookie).toBeTruthy();
  expect((await invoke(workspace, 'product.list', {}, login.cookie)).body.data).toEqual([]);
  const product = await invoke(workspace, 'product.save', { name: 'Third shop only', sellingPrice: 1200, costPrice: 500, openingStock: 4 }, login.cookie);
  expect(product.body.ok).toBe(true);
  expect((await invoke('shop-a', 'product.list', { search: 'Third shop only' }, oldCookie)).body.data).toEqual([]);
  expect((await setup('/onboarding/complete', { token: proof, password })).status).toBe(410);
  expect((await api(`/v1/admin/clients/${third}/browser-workspace`)).body.status).toBe('ready');
  const consumed = JSON.parse(readFileSync(join(config.dataDir, 'browser-onboarding', third + '.json'), 'utf8'));
  expect(consumed.secret).toBeUndefined();
  await expect.poll(async () => (await cloud.db.tenant(third, q => q('SELECT name FROM products WHERE id = $1', [product.body.data.id]))).length, { timeout: 25_000, interval: 500 }).toBe(1);
});

it('reopens the new store and email alias after service restart without recreating accounts', async () => {
  await gateway.close();
  manager = createWorkspaceOnboarding(config);
  await app.close();
  app = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir(), browserWorkspaces: manager });
  await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
  gateway = await startConfiguredStaging(undefined, async ws => { workspaces = ws; }, manager);
  expect(workspaces).toHaveLength(3);
  const workspace = 'shop-' + third;
  expect(loadLoginAliases(config.dataDir)[workspace][email]).toMatch(/^owner-/);
  const login = await invoke(workspace, 'auth.login', { username: email, password });
  expect(login.body.ok).toBe(true);
  expect((await invoke(workspace, 'product.list', { search: 'Third shop only' }, login.cookie)).body.data).toHaveLength(1);
  expect((await invoke('shop-a', 'app.state', {}, oldCookie)).body.data.user).toBeNull();
});

it.skipIf(!pw)('lets the owner complete setup in the real browser with CSP and no password in administrator output', async () => {
  const created = await api('/v1/admin/clients', { name: 'Browser setup test shop', ownerName: 'Browser owner', email: 'browser-owner@example.test', businessType: 'retail' });
  const invited = await api(`/v1/admin/clients/${created.body.id}/browser-workspace`);
  const fragment = new URL(invited.body.url).hash;
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', () => errors.push('browser exception'));
    await page.goto(gateway.url + '/onboarding/' + fragment);
    await page.getByText('Browser setup test shop · browser-owner@example.test', { exact: true }).waitFor();
    const chosen = randomBytes(24).toString('base64url');
    await page.getByLabel('Choose a password', { exact: true }).fill(chosen);
    await page.getByLabel('Confirm password', { exact: true }).fill(chosen);
    await page.getByRole('button', { name: 'Create my workspace', exact: true }).click();
    await page.waitForURL('**/client/shop-*/#email=*');
    expect(errors).toEqual([]);
    const ready = await api(`/v1/admin/clients/${created.body.id}/browser-workspace`);
    expect(ready.body.status).toBe('ready'); expect(JSON.stringify(ready.body)).not.toContain(chosen);
    const login = await invoke('shop-' + created.body.id, 'auth.login', { username: 'browser-owner@example.test', password: chosen });
    expect(login.body.ok).toBe(true);
  } finally { await browser.close(); }
});

it('resumes activation committed before registration without resetting the owner password or losing records', async () => {
  const tenant = await cloud.createClient('Interrupted activation shop'), ownerEmail = 'interrupted@example.test';
  const invite = await manager.invite({ tenantId: tenant.id, label: 'Interrupted activation shop', ownerName: 'Interrupted owner', ownerEmail, activationCode: tenant.code });
  const token = new URLSearchParams(new URL(invite.url).hash.slice(1)).get('token')!;
  const saved = JSON.parse(readFileSync(join(config.dataDir, 'browser-onboarding', tenant.id + '.json'), 'utf8'));
  const engine = openEngine({ dataDir: join(config.dataDir, 'workspaces', invite.workspaceId), dbKey: workspaceKey(config.key, invite.workspaceId) });
  const chosen = randomBytes(24).toString('base64url');
  try {
    await engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: tenant.code, deviceName: 'Interrupted test fixture', owner: { name: 'Interrupted owner', username: saved.ownerUsername, password: chosen } });
    const session = await engine.execute(null, 'auth.login', { username: saved.ownerUsername, password: chosen });
    await engine.execute(session.token, 'product.save', { name: 'Preserved activation record', sellingPrice: 300, openingStock: 4 });
    engine.endSession(session.token);
  } finally { engine.db.close(); }
  const before = workspaces.length;
  expect((await setup('/onboarding/complete', { token, password: chosen })).status).toBe(200);
  expect(workspaces).toHaveLength(before + 1);
  const login = await invoke(invite.workspaceId, 'auth.login', { username: ownerEmail, password: chosen });
  expect((await invoke(invite.workspaceId, 'product.list', { search: 'Preserved activation record' }, login.cookie)).body.data).toHaveLength(1);
});

it('never advertises an activation code bound to a different tenant', async () => {
  const target = await cloud.createClient('Bound setup target'), foreign = await cloud.createClient('Foreign setup code');
  const invited = await manager.invite({ tenantId: target.id, label: 'Bound setup target', ownerName: 'Bound owner', ownerEmail: 'bound@example.test', activationCode: foreign.code });
  const token = new URLSearchParams(new URL(invited.url).hash.slice(1)).get('token')!, before = workspaces.length;
  const result = await setup('/onboarding/complete', { token, password: randomBytes(24).toString('base64url') });
  expect(result.status).toBe(409); expect(result.body.error.code).toBe('WORKSPACE_REVIEW_REQUIRED');
  expect(workspaces).toHaveLength(before);
  expect(JSON.parse(readFileSync(join(config.dataDir, 'workspaces.json'), 'utf8')).some((r: any) => r.id === invited.workspaceId)).toBe(false);
});

it('keeps provisioning unavailable without its server adapter and bounds administrator requests', async () => {
  const disabled = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir() });
  try {
    const result = await disabled.inject({ method: 'POST', url: `/v1/admin/clients/${third}/browser-workspace`, headers: { authorization: `Bearer ${cloud.adminToken}` }, payload: {} });
    expect(result.statusCode).toBe(404); expect(result.json().code).toBe('NOT_AVAILABLE');
  } finally { await disabled.close(); }
  let status = 200;
  for (let count = 0; count < 7 && status !== 429; count++) status = (await api(`/v1/admin/clients/${third}/browser-workspace`)).status;
  expect(status).toBe(429);
});
