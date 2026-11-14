import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadWorkspaces, workspaceKey, type StagingConfig } from '../../scripts/staging/config';
import { startStagingGateway, stagingOrigin, type StagingWorkspace } from '../../scripts/staging/gateway';
describe('persistent authenticated team staging gateway', () => {
  let cloud: Cloud, config: StagingConfig, workspaces: StagingWorkspace[], gateway: Awaited<ReturnType<typeof startStagingGateway>>, accounts: TestAccount[];
  let ownerCookie = '', cashierCookie = '', otherCookie = '', savedId = '';
  const account = (role: string, workspace = 'shop-a') => accounts.find(a => a.role === role && a.workspace === workspace)!;
  const invoke = async (workspace: string, command: string, input: unknown = {}, cookie = '', origin: string | null = gateway.publicOrigin) => {
    const r = await fetch(`${gateway.url}/client/${workspace}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ command, input }) });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie') };
  };
  beforeAll(async () => {
    cloud = await startCloud(); const staticDir = tempDir('mansora-staging-static-'); writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>'); config = { origin: 'http://127.0.0.1:0', apiUrl: cloud.url, dataDir: tempDir('mansora-team-staging-'), key: randomBytes(32).toString('hex'), clientDir: staticDir, adminDir: staticDir };
    await provisionStaging(config, ADMIN); accounts = JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')); workspaces = loadWorkspaces(config);
    gateway = await startStagingGateway({ ...config, workspaces, port: 0 });
  });
  afterAll(async () => { await gateway?.close(); for (const w of workspaces ?? []) w.engine.db.close(); await cloud?.close(); });
  it('provisions distinct stores and private random accounts, and preserves them on rerun', async () => {
    expect(workspaces).toHaveLength(2); expect(accounts).toHaveLength(6); expect(new Set(accounts.map(a => a.password)).size).toBe(6);
    if (process.platform !== 'win32') expect(statSync(join(config.dataDir, 'test-accounts.json')).mode & 0o777).toBe(0o600);
    const credentials = createHash('sha256').update(readFileSync(join(config.dataDir, 'test-accounts.json'))).digest('hex'); expect(await provisionStaging(config, ADMIN)).toEqual({ existing: true }); expect(createHash('sha256').update(readFileSync(join(config.dataDir, 'test-accounts.json'))).digest('hex')).toBe(credentials);
    expect(workspaceKey(config.key, 'shop-a')).not.toBe(workspaceKey(config.key, 'shop-b'));
  });
  it('gives simultaneous browsers independent HttpOnly sessions without exposing engine tokens', async () => {
    for (const [role, workspace] of [['owner', 'shop-a'], ['cashier', 'shop-a'], ['owner', 'shop-b']]) {
      const a = account(role, workspace), r = await invoke(workspace, 'auth.login', { username: a.username, password: a.password });
      expect(r.status).toBe(200); expect(r.data.ok).toBe(true); expect(r.data.data.token).toBeUndefined(); expect(r.cookie?.includes('HttpOnly')).toBe(true); expect(r.cookie?.includes('SameSite=Strict')).toBe(true); expect(r.cookie?.includes(`Path=/client/${workspace}/`)).toBe(true);
      const cookie = r.cookie!.split(';')[0]; if (workspace === 'shop-b') otherCookie = cookie; else if (role === 'owner') ownerCookie = cookie; else cashierCookie = cookie;
    }
    expect(ownerCookie !== cashierCookie).toBe(true); expect((await invoke('shop-a', 'app.state', {}, ownerCookie)).data.data.user.role).toBe('owner'); expect((await invoke('shop-a', 'app.state', {}, cashierCookie)).data.data.user.role).toBe('cashier');
  });
  it('saves shared records with real role and business isolation', async () => {
    const saved = await invoke('shop-a', 'product.save', { name: 'Persisted staging item', sku: 'PERSISTED-STAGE', costPrice: 700, sellingPrice: 1200, openingStock: 8 }, ownerCookie); expect(saved.data.ok).toBe(true); savedId = saved.data.data.id;
    const own = (await invoke('shop-a', 'product.list', { search: 'PERSISTED-STAGE' }, ownerCookie)).data.data; expect(own).toMatchObject([{ id: savedId, quantity: 8, cost_price: 700 }]);
    const cash = (await invoke('shop-a', 'product.list', { search: 'PERSISTED-STAGE' }, cashierCookie)).data.data; expect(cash[0].id).toBe(savedId); expect('cost_price' in cash[0]).toBe(false);
    expect((await invoke('shop-a', 'product.save', { name: 'Denied', sellingPrice: 1, costPrice: 1 }, cashierCookie)).data.error.code).toBe('PERMISSION_DENIED');
    expect((await invoke('shop-b', 'product.list', {}, ownerCookie)).data.error.code).toBe('NOT_SIGNED_IN'); expect((await invoke('shop-b', 'product.list', { search: 'PERSISTED-STAGE' }, otherCookie)).data.data).toEqual([]);
  });
  it('rejects cross-origin and missing-origin writes, unsafe transport and browser reactivation', async () => {
    expect((await invoke('shop-a', 'product.save', { name: 'CSRF', costPrice: 1, sellingPrice: 1 }, ownerCookie, 'https://attacker.example')).status).toBe(403);
    expect((await invoke('shop-a', 'product.save', { name: 'CSRF', costPrice: 1, sellingPrice: 1 }, ownerCookie, null)).status).toBe(403);
    const plain = await fetch(`${gateway.url}/client/shop-a/invoke`, { method: 'POST', headers: { origin: gateway.publicOrigin, cookie: ownerCookie, 'content-type': 'text/plain' }, body: '{}' }); expect(plain.status).toBe(415);
    expect((await invoke('shop-a', 'activation.activate', {}, ownerCookie)).status).toBe(403); expect((await invoke('shop-a', 'device.relink', {}, ownerCookie)).status).toBe(403);
    expect((await invoke('shop-a', 'product.list', { search: 'CSRF' }, ownerCookie)).data.data).toEqual([]);
    expect(() => stagingOrigin('http://staging.example.com')).toThrow(); expect(() => stagingOrigin('https://user:secret@example.com')).toThrow(); expect(() => stagingOrigin('https://example.com/path')).toThrow();
  });
  it('serves interface assets, injects a narrow bridge and never serves private stores', async () => {
    const client = await (await fetch(`${gateway.url}/client/shop-a/`)).text(); expect(client).toContain('/client/shop-a/bridge.js'); expect(client).toContain('TEAM TEST ENVIRONMENT'); expect(client).not.toContain(config.key);
    const bridge = await (await fetch(`${gateway.url}/client/shop-a/bridge.js`)).text(); expect(bridge).toContain('/client/shop-a/invoke'); expect(bridge).not.toContain('engine.execute'); expect(bridge).not.toContain(account('owner').password);
    expect(await (await fetch(`${gateway.url}/config.js`)).text()).toContain('"/api"'); expect((await fetch(`${gateway.url}/admin/`)).status).toBe(200);
    for (const path of ['/test-accounts.json', '/workspaces.json', '/.secrets/staging_db_key', '/client/shop-a/..%2f..%2ftest-accounts.json']) expect((await fetch(gateway.url + path)).status).toBe(404);
  });
  it('keeps the API proxy fixed even for protocol-relative paths', async () => {
    let hits = 0; const canary = createServer((_req, res) => { hits++; res.writeHead(418).end(); }); await new Promise<void>(r => canary.listen(0, '127.0.0.1', r));
    try { const port = (canary.address() as any).port; expect((await fetch(`${gateway.url}/api//127.0.0.1:${port}/unexpected`)).status).toBe(404); expect(hits).toBe(0); } finally { await new Promise<void>(r => canary.close(() => r())); }
  });
  it('sets Secure cookies on HTTPS staging and bounds malformed/oversized requests', async () => {
    const secure = await startStagingGateway({ ...config, origin: 'https://staging.example.com', workspaces, port: 0, maxBodyBytes: 1024 });
    try {
      const headers = await fetch(secure.url + '/client/shop-a/'); expect(headers.headers.get('strict-transport-security')).toBe('max-age=31536000'); expect(headers.headers.get('x-robots-tag')).toContain('noindex'); expect(headers.headers.get('permissions-policy')).toContain('microphone=()'); expect(headers.headers.get('cross-origin-resource-policy')).toBe('same-origin'); expect(headers.headers.get('permissions-policy')).toContain('camera=(self)');
      // The public brand logo may be cached by email clients; other responses stay uncached.
      expect((await fetch(secure.url + '/api/brand/mansora-logo.png')).headers.get('cache-control')).toBe('public, max-age=86400');
      // Only payment pages may send a form on to Paystack's hosted checkout.
      expect((await fetch(secure.url + '/api/pay/not-a-real-token')).headers.get('content-security-policy')).toContain("form-action 'self' https://checkout.paystack.com");
      expect(headers.headers.get('content-security-policy')).toMatch(/form-action 'self'$/);
      expect((await fetch(gateway.url + '/')).headers.get('strict-transport-security')).toBeNull();
      const a = account('owner'); const r = await fetch(`${secure.url}/client/shop-a/invoke`, { method: 'POST', headers: { origin: secure.publicOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'auth.login', input: { username: a.username, password: a.password } }) }); expect(r.headers.get('set-cookie')?.includes('; Secure')).toBe(true);
      expect((await fetch(`${secure.url}/client/shop-a/%E0%A4%A`)).status).toBe(400); // a broken escape is a bad request, not an outage
      const malformed = await fetch(`${secure.url}/client/shop-a/invoke`, { method: 'POST', headers: { origin: secure.publicOrigin, 'content-type': 'application/json' }, body: '{' }); expect(malformed.status).toBe(400);
      const large = await fetch(`${secure.url}/client/shop-a/invoke`, { method: 'POST', headers: { origin: secure.publicOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(2048) }) }); expect(large.status).toBe(413);
    } finally { await secure.close(); }
  });
  it('rejects unsafe owner workbooks while preserving cashier and anonymous permission boundaries', async () => {
    const bad = { fileName: 'unsafe.xlsx', contentBase64: Buffer.from('not a workbook').toString('base64') };
    const denied = await invoke('shop-a', 'import.preview', bad, cashierCookie); expect(denied.data.error.code).toBe('PERMISSION_DENIED');
    expect((await invoke('shop-a', 'import.preview', bad)).data.error.code).toBe('NOT_SIGNED_IN');
    const owner = await invoke('shop-a', 'import.preview', bad, ownerCookie); expect(owner.status).toBe(400); expect(owner.data.error.code).toBe('UNSAFE_SPREADSHEET');
  });
  it('processes only one authorised spreadsheet at a time and releases the slot', async () => {
    const template = (await invoke('shop-a', 'import.template', { format: 'xlsx' }, ownerCookie)).data.data;
    const input = { fileName: template.fileName, contentBase64: template.contentBase64 };
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(r => { release = r; }), arrived = new Promise<void>(r => { started = r; });
    const engine = workspaces[0].engine, original = engine.execute.bind(engine);
    const spy = vi.spyOn(engine, 'execute').mockImplementation(async (token, command, payload) => { if (command === 'import.preview') { started(); await held; } return original(token, command, payload); });
    let pending: ReturnType<typeof invoke> | undefined;
    try {
      pending = invoke('shop-a', 'import.preview', input, ownerCookie); await arrived;
      const busy = await invoke('shop-a', 'import.preview', input, ownerCookie); expect(busy.status).toBe(429); expect(busy.data.error.code).toBe('IMPORT_BUSY');
      release(); expect((await pending).data.ok).toBe(true);
    } finally { release(); await pending; spy.mockRestore(); }
    expect((await invoke('shop-a', 'import.preview', input, ownerCookie)).data.ok).toBe(true);
  });
  it('bounds active handlers without blocking health probes and releases capacity', async () => {
    let started!: () => void, release!: () => void;
    const arrived = new Promise<void>(r => { started = r; }), held = new Promise<void>(r => { release = r; });
    const upstream = createServer(async (_request, response) => { started(); await held; response.end('done'); });
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
    const bounded = await startStagingGateway({ ...config, workspaces, apiUrl: `http://127.0.0.1:${(upstream.address() as any).port}`, maxConcurrentRequests: 1, port: 0 });
    let pending: Promise<Response> | undefined;
    try {
      pending = fetch(bounded.url + '/api/hold'); await arrived;
      const busy = await fetch(bounded.url + '/client/shop-a/'); expect(busy.status).toBe(503); expect(busy.headers.get('retry-after')).toBe('2');
      expect((await fetch(bounded.url + '/healthz')).status).toBe(200);
      release(); expect((await pending).status).toBe(200); expect((await fetch(bounded.url + '/client/shop-a/')).status).toBe(200);
    } finally { release(); await pending; await bounded.close(); await new Promise<void>(r => upstream.close(() => r())); }
  });
  it('logout affects only its own browser and restart preserves encrypted records', async () => {
    await invoke('shop-a', 'auth.logout', {}, ownerCookie); expect((await invoke('shop-a', 'app.state', {}, cashierCookie)).data.data.user.role).toBe('cashier');
    await gateway.close(); for (const w of workspaces) w.engine.db.close();
    expect(() => loadWorkspaces({ ...config, key: randomBytes(32).toString('hex') })).toThrow();
    workspaces = loadWorkspaces(config); gateway = await startStagingGateway({ ...config, workspaces, port: 0 });
    expect((await invoke('shop-a', 'product.list', {}, cashierCookie)).data.error.code).toBe('NOT_SIGNED_IN');
    const a = account('owner'), login = await invoke('shop-a', 'auth.login', { username: a.username, password: a.password }); const fresh = login.cookie!.split(';')[0];
    expect((await invoke('shop-a', 'product.list', { search: 'PERSISTED-STAGE' }, fresh)).data.data).toMatchObject([{ id: savedId, quantity: 8, cost_price: 700 }]);
  });
});
