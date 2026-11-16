import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { OWNER, makeShop, tempDir, type TestShop } from '../helpers';
import { loadLoginAliases } from '../../scripts/staging/accounts';
import { totpCode } from '../../apps/api/src/security';
import { startStagingGateway } from '../../scripts/staging/gateway';

let cloud: Cloud, shops: TestShop[], gateway: Awaited<ReturnType<typeof startStagingGateway>>;
let ownerCookie = '';
const oldKey = process.env.ADMIN_TOTP_KEY;
const post = async (path: string, input: unknown, cookie = '', origin?: string) => {
  const response = await fetch(gateway.url + path, { method: 'POST', headers: { origin: origin ?? gateway.publicOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
};
const signIn = (username: string, password = OWNER.password) => post('/signin/login', { username, password });
const invoke = (workspace: string, command: string, input: unknown = {}, cookie = ownerCookie) => post(`/client/${workspace}/invoke`, { command, input }, cookie);
beforeAll(async () => {
  process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
  cloud = await startCloud(); shops = [await makeShop(), await makeShop()];
  const directory = tempDir(); writeFileSync(join(directory, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  gateway = await startStagingGateway({ origin: 'http://127.0.0.1:0', apiUrl: cloud.url, clientDir: directory, adminDir: directory, port: 0, mode: 'team-test', workspaces: shops.map((shop, index) => ({ id: index ? 'shop-b' : 'shop-a', label: `Private business ${index}`, engine: shop.engine })), loginAliases: { 'shop-a': { 'owner-a@example.test': OWNER.username, [ADMIN.email]: OWNER.username } }, adminIdentityExists: email => cloud.db.platform(async q => (await q('SELECT 1 FROM admins WHERE email=$1', [email])).length > 0) });
});
afterAll(async () => { await gateway?.close(); for (const shop of shops ?? []) shop.engine.db.close(); await cloud?.close(); if (oldKey === undefined) delete process.env.ADMIN_TOTP_KEY; else process.env.ADMIN_TOTP_KEY = oldKey; });
it('replaces the directory with private, branded sign-in in both deployment modes', async () => {
  const redirect = await fetch(gateway.url, { redirect: 'manual' }); expect(redirect.status).toBe(302); expect(redirect.headers.get('location')).toBe('/signin/');
  const response = await fetch(gateway.url), html = await response.text();
  expect(response.url).toBe(gateway.url + '/signin/'); expect(html).toContain('Username or email'); expect(html).toContain('Mansora Consulting and Business Solutions Limited');
  expect(html).not.toMatch(/TEAM TEST|Private business|href="\/client|href="\/admin|sample data|team testing/i);
  expect(response.headers.get('x-robots-tag')).toContain('noindex'); expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await fetch(gateway.url + '/signin/app.js')).headers.get('content-type')).toContain('javascript');
});
it('never selects a shop by matching passwords when a bare username is ambiguous', async () => {
  // Both owners intentionally use the same password. An identity, not a password, selects the account.
  const response = await signIn(OWNER.username); expect(response.status).toBe(401); expect(response.body.error.code).toBe('INVALID_CREDENTIALS'); expect(response.cookie).toBeUndefined(); expect(JSON.stringify(response.body)).not.toContain('shop-a');
});
it('normalises the qualified identity and gives a scoped session only after successful authentication', async () => {
  expect((await signIn('ama@shop-a', 'incorrect-password')).status).toBe(401);
  const response = await signIn(' AMA@SHOP-A '); expect(response.body.data).toEqual({ platform: 'client', url: '/client/shop-a/' }); expect(response.headers.get('set-cookie')).toContain('Path=/client/shop-a/; HttpOnly; SameSite=Strict'); expect(response.body.data.token).toBeUndefined(); ownerCookie = response.cookie!;
  expect((await invoke('shop-a', 'app.state')).body.data.user.id).toBeDefined();
  expect((await invoke('shop-b', 'app.state')).body.data.user).toBeNull();
  const other = await signIn('ama@shop-b'); expect(other.body.data.url).toBe('/client/shop-b/'); expect(other.cookie).not.toBe(ownerCookie);
});
it('accepts a unique invitation email and fails closed on client/admin identity collisions', async () => {
  expect((await signIn('owner-a@example.test')).body.data.url).toBe('/client/shop-a/');
  expect((await signIn(ADMIN.email, ADMIN.password)).status).toBe(401);
  const admin = await signIn('admin:' + ADMIN.email, ADMIN.password); expect(admin.body.data.platform).toBe('admin'); expect(admin.body.data.token).toBeTruthy(); expect(admin.cookie).toBeUndefined();
});
it('rejects duplicate hosted usernames across shops, case variants and simultaneous attempts', async () => {
  const input = { name: 'New staff', username: 'kofi', role: 'cashier', password: 'another-strong-pass' };
  expect((await invoke('shop-a', 'staff.save', input)).body.error.code).toBe('USERNAME_TAKEN');
  expect((await invoke('shop-a', 'staff.save', { ...input, username: 'KoFi' })).status).toBe(409);
  const other = await signIn('ama@shop-b');
  const responses = await Promise.all([invoke('shop-a', 'staff.save', { ...input, username: 'unique.new' }), invoke('shop-b', 'staff.save', { ...input, username: 'UNIQUE.NEW' }, other.cookie)]);
  expect(responses.filter(response => response.body.ok)).toHaveLength(1); expect(responses.filter(response => response.body.error?.code === 'USERNAME_TAKEN')).toHaveLength(1);
  const login = await signIn('unique.new', input.password); expect(login.body.data.platform).toBe('client');
});
it('preserves editing of existing duplicate names and shows each canonical web sign-in only to authorised staff managers', async () => {
  const listed = await invoke('shop-a', 'staff.list'); const owner = listed.body.data.find((user: any) => user.role === 'owner');
  expect(owner.publicLogin).toBe('ama@shop-a');
  expect((await invoke('shop-a', 'staff.save', { id: owner.id, name: owner.name, username: owner.username, role: 'owner', status: 'active', permissions: owner.permissions })).body.ok).toBe(true);
  expect((await invoke('shop-a', 'staff.list', {}, '')).body.error.code).toBe('NOT_SIGNED_IN');
  const denied = await invoke('shop-a', 'staff.save', { name: 'Denied', username: 'kofi', role: 'cashier', password: 'another-strong-pass' }, '');
  expect(denied.body.error.code).toBe('NOT_SIGNED_IN');
});
it('preserves administrator second-factor enforcement without issuing a premature token', async () => {
  const pending = await cloud.api('POST', '/v1/admin/totp/enrol', { password: ADMIN.password }); expect(pending.status).toBe(200);
  const confirmed = await cloud.api('POST', '/v1/admin/totp/confirm', { code: totpCode(pending.body.secret) }); expect(confirmed.status).toBe(200);
  const login = await signIn('admin:' + ADMIN.email, ADMIN.password); expect(login.body.data.requiresTotp).toBe(true); expect(login.body.data.token).toBeUndefined();
  const challenge = login.body.data.challenge;
  expect((await post('/signin/totp', { challenge, code: 'invalid' })).status).toBe(401);
  const verified = await post('/signin/totp', { challenge, code: confirmed.body.recoveryCodes[0] }); expect(verified.body.data.platform).toBe('admin'); expect(verified.body.data.token).toBeTruthy();
  expect((await post('/signin/totp', { challenge, code: confirmed.body.recoveryCodes[0] })).status).toBe(401);
});
it('keeps the recorded email working after an owner username changes, including rebuilding aliases after a restart', async () => {
  const listed = await invoke('shop-a', 'staff.list'); const owner = listed.body.data.find((user: any) => user.role === 'owner');
  const saved = await invoke('shop-a', 'staff.save', { id: owner.id, name: owner.name, username: 'renamed.ama', role: 'owner', status: 'active', permissions: owner.permissions }); expect(saved.body.ok).toBe(true);
  expect((await signIn('owner-a@example.test')).body.data.url).toBe('/client/shop-a/');
  const directory = tempDir(); writeFileSync(join(directory, 'workspaces.json'), JSON.stringify([{ id: 'shop-a', ownerEmail: 'owner-a@example.test', ownerUsername: 'ama' }]));
  expect(loadLoginAliases(directory, [{ id: 'shop-a', label: 'Own shop', engine: shops[0].engine }])['shop-a']['owner-a@example.test']).toBe('renamed.ama');
});
it('rejects foreign origins, bounds request bodies and rate-limits identities', async () => {
  expect((await post('/signin/login', { username: 'ama@shop-a', password: OWNER.password }, '', 'https://foreign.example')).status).toBe(403);
  expect((await post('/signin/login', { username: 'x'.repeat(5000), password: 'x' })).status).toBe(413);
  expect((await signIn('absent')).status).toBe(401);
  for (let index = 0; index < 19; index++) expect((await signIn('bounded-unknown')).status).toBe(401);
  expect((await signIn('bounded-unknown')).status).toBe(401);
  expect((await signIn('bounded-unknown')).status).toBe(429);
});
