import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { startStagingGateway } from '../../scripts/staging/gateway';
import { OWNER, makeShop, tempDir, type TestShop } from '../helpers';
let shops: TestShop[], gateway: Awaited<ReturnType<typeof startStagingGateway>>;
let unblock: (() => void) | undefined, entered: (() => void) | undefined;
const staticDir = tempDir();
const invoke = async (workspace: string, command: string, input: unknown = {}, ip = '198.51.100.1') => {
  const response = await fetch(`${gateway.url}/client/${workspace}/invoke`, { method: 'POST', headers: { origin: gateway.publicOrigin, 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ command, input }) });
  return { status: response.status, body: await response.json() as any };
};
beforeAll(async () => {
  shops = [await makeShop(), await makeShop()];
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  shops[0].engine.register({ 'test.wait': { perm: 'public', async: true, input: z.object({}), run: async () => { entered?.(); await new Promise<void>(resolve => { unblock = resolve; }); return { ok: true }; } } });
  gateway = await startStagingGateway({ origin: 'http://127.0.0.1:0', apiUrl: 'http://127.0.0.1:9', clientDir: staticDir, adminDir: staticDir, port: 0, mode: 'client', testWorkspaceIds: ['shop-a'], trustedProxies: ['127.0.0.1'], maxConcurrentRequests: 4, maxConcurrentPerWorkspace: 1, workspaces: shops.map((shop, index) => ({ id: index ? 'shop-b' : 'shop-a', label: index ? 'Private real client name' : 'Private test shop name', engine: shop.engine })) });
});
afterAll(async () => { unblock?.(); await gateway?.close(); for (const shop of shops ?? []) shop.engine.db.close(); });
it('hides the public client directory but preserves explicit test notices and hardening', async () => {
  const response = await fetch(gateway.url), html = await response.text();
  expect(html).not.toContain('Private real client name'); expect(html).not.toContain('Private test shop name');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(await (await fetch(gateway.url + '/client/shop-a/')).text()).toContain('TEAM TEST ENVIRONMENT');
  expect(await (await fetch(gateway.url + '/client/shop-b/')).text()).not.toContain('TEAM TEST ENVIRONMENT');
  const health = await (await fetch(gateway.url + '/healthz', { headers: { 'x-real-ip': '198.51.100.1' } })).json() as any;
  expect(health).toMatchObject({ ok: true, mode: 'client', clientAddressSource: 'forwarded' });
});
it('isolates a shop request budget while another shop remains available and releases it after completion', async () => {
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = invoke('shop-a', 'test.wait'); await started;
  expect((await invoke('shop-a', 'app.state')).status).toBe(503);
  expect((await invoke('shop-b', 'app.state')).status).toBe(200);
  unblock!(); expect((await held).status).toBe(200);
  expect((await invoke('shop-a', 'app.state')).status).toBe(200);
});
it('keeps one shop’s failed sign-ins from blocking another and uses a trusted individual address', async () => {
  for (let index = 0; index < 60; index++) expect((await invoke('shop-a', 'auth.login', { username: `unknown-${index}`, password: 'not-a-real-password' })).status).toBe(200);
  expect((await invoke('shop-a', 'auth.login', OWNER)).status).toBe(429);
  const other = await invoke('shop-b', 'auth.login', OWNER);
  expect(other.status).toBe(200); expect(other.body.ok).toBe(true);
  const individual = await invoke('shop-a', 'auth.login', OWNER, '198.51.100.2');
  expect(individual.status).toBe(200); expect(individual.body.ok).toBe(true);
});
it('permits an empty client service before its first provisioned workspace', async () => {
  const fresh = await startStagingGateway({ origin: 'http://127.0.0.1:0', apiUrl: 'http://127.0.0.1:9', clientDir: staticDir, adminDir: staticDir, port: 0, mode: 'client', workspaces: [] });
  try { expect((await fetch(fresh.url + '/healthz')).status).toBe(200); } finally { await fresh.close(); }
});
