import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserOwnerRecoveryIssuer } from '../../apps/api/src/browser-workspaces';
import { EmailDeliveryError, type EmailMessage } from '../../apps/api/src/email';
import { createOwnerRecovery, type OwnerRecovery } from '../../scripts/staging/owner-recovery';
import { startStagingGateway, type StagingWorkspace } from '../../scripts/staging/gateway';
import type { StagingConfig } from '../../scripts/staging/config';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { CASHIER, OWNER, makeShop, tempDir, type TestShop } from '../helpers';
let cloud: Cloud, shops: TestShop[], recovery: OwnerRecovery, config: StagingConfig, gateway: Awaited<ReturnType<typeof startStagingGateway>>;
let now = new Date(), deliveries: EmailMessage[] = [], transient = false, block: Promise<void> | undefined;
const messages: EmailMessage[] = [];
const email = { configured: () => true, async send(message: EmailMessage) { messages.push(message); if (transient) throw new EmailDeliveryError('Temporary failure', true); await block; deliveries.push(message); return { id: 'accepted-test-message' }; } };
const token = (message: EmailMessage) => /#token=([A-Za-z0-9_-]{43})/.exec(message.body)![1];
const password = randomBytes(24).toString('base64url');
let issuer: (tenantId: string) => Promise<string>, workspaces: StagingWorkspace[];
const create = () => { const manager = createOwnerRecovery({ config, email, issueCode: issuer, now: () => now }); manager.attach(workspaces); return manager; };
beforeAll(async () => {
  cloud = await startCloud();
  const clients = await Promise.all([cloud.createClient('Recovery A'), cloud.createClient('Recovery B')]);
  shops = await Promise.all(clients.map(client => makeShop({ fetch, apiUrl: cloud.url, code: client.code })));
  const dataDir = tempDir(), staticDir = tempDir();
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  writeFileSync(join(dataDir, 'workspaces.json'), JSON.stringify([{ id: 'shop-a', label: 'A' }, { id: 'shop-b', label: 'B' }]));
  writeFileSync(join(dataDir, 'test-accounts.json'), JSON.stringify([{ workspace: 'shop-a', role: 'owner', email: 'owner-a@example.test' }, { workspace: 'shop-b', role: 'owner', email: 'owner-b@example.test' }]));
  config = { origin: 'https://app.example.test', apiUrl: cloud.url, dataDir, key: randomBytes(32).toString('hex'), clientDir: staticDir, adminDir: staticDir };
  const [operator] = await cloud.db.platform(q => q<{ id: string }>('SELECT id FROM admins WHERE email = $1', [ADMIN.email]));
  issuer = browserOwnerRecoveryIssuer(cloud.db, operator.id);
  workspaces = shops.map((shop, index) => ({ id: index ? 'shop-b' : 'shop-a', label: 'Recovery test', engine: shop.engine }));
  recovery = create();
  gateway = await startStagingGateway({ ...config, origin: 'http://127.0.0.1:0', port: 0, workspaces, ownerRecovery: { available: () => recovery.available(), request: (...args) => recovery.request(...args), complete: (...args) => recovery.complete(...args) } });
});
afterAll(async () => { await gateway?.close(); await recovery?.close(); for (const shop of shops ?? []) shop.engine.db.close(); await cloud?.close(); });
it('returns the same generic response and sends only to the recorded owner; preserves one pending proof', async () => {
  const unknown = await recovery.request('shop-a', 'unrelated@example.test'); await recovery.processPending(); expect(messages).toHaveLength(0);
  expect(await recovery.request('shop-a', 'OWNER-A@example.test')).toEqual(unknown); await recovery.processPending();
  expect(deliveries).toHaveLength(1); expect(deliveries[0].to).toBe('owner-a@example.test');
  await recovery.request('shop-a', 'owner-a@example.test'); await recovery.processPending(); expect(deliveries).toHaveLength(1);
  const raw = readFileSync(join(config.dataDir, 'owner-recovery/shop-a.json'), 'utf8'); expect(raw).not.toContain(token(deliveries[0])); expect(raw).not.toContain(password);
});
it('rejects cross-shop proof and weak passwords, then changes only the owner through the real device command', async () => {
  const proof = token(deliveries[0]);
  await expect(recovery.complete('shop-b', proof, password)).rejects.toMatchObject({ status: 410 });
  await expect(recovery.complete('shop-a', proof, 'short')).rejects.toMatchObject({ status: 400 });
  const results = await Promise.allSettled([recovery.complete('shop-a', proof, password), recovery.complete('shop-a', proof, password)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await shops[0].run(null, 'auth.login', { username: OWNER.username, password })).user.role).toBe('owner');
  await expect(shops[0].run(null, 'auth.login', OWNER)).rejects.toBeDefined();
  expect((await shops[0].run(null, 'auth.login', CASHIER)).user.role).toBe('cashier');
  expect((await shops[1].run(null, 'auth.login', OWNER)).user.role).toBe('owner');
  expect((await shops[0].run(shops[0].owner, 'app.state')).user).toBeNull();
  await expect(recovery.complete('shop-a', proof, password)).rejects.toMatchObject({ status: 410 });
  const audit = await cloud.db.platform(q => q("SELECT detail FROM admin_audit_logs WHERE action LIKE 'owner_recovery_code.%'"));
  expect(audit.length).toBeGreaterThanOrEqual(2); expect(JSON.stringify(audit)).not.toContain(proof);
});
it('durably retries a transient send with the identical idempotency key after restart and expires accepted secrets', async () => {
  transient = true; await recovery.request('shop-b', 'owner-b@example.test'); await recovery.processPending();
  const first = messages.at(-1)!; await recovery.close(); recovery = create();
  now = new Date(now.getTime() + 61_000); transient = false; await recovery.processPending();
  expect(messages.at(-1)?.idempotencyKey).toBe(first.idempotencyKey); expect(messages.at(-1)?.body).toBe(first.body);
  const proof = token(deliveries.at(-1)!); now = new Date(now.getTime() + 16 * 60_000); await recovery.processPending();
  await expect(recovery.complete('shop-b', proof, password)).rejects.toMatchObject({ status: 410 });
  expect(JSON.parse(readFileSync(join(config.dataDir, 'owner-recovery/shop-b.json'), 'utf8')).secret).toBeUndefined();
});
it('does not resurrect a consumed proof when a slow provider acknowledgement finishes afterward', async () => {
  let release!: () => void; block = new Promise<void>(resolve => { release = resolve; });
  await recovery.request('shop-a', 'owner-a@example.test');
  while (!messages.at(-1)?.body.includes('/client/shop-a/')) await new Promise(resolve => setTimeout(resolve, 5));
  const proof = token(messages.at(-1)!);
  try { await recovery.complete('shop-a', proof, password + 'new'); } finally { release(); }
  await recovery.processPending(); block = undefined;
  const record = JSON.parse(readFileSync(join(config.dataDir, 'owner-recovery/shop-a.json'), 'utf8'));
  expect(record.usedAt).toBeTruthy(); expect(record.secret).toBeUndefined();
  await expect(recovery.complete('shop-a', proof, password)).rejects.toMatchObject({ status: 410 });
});
it('serves same-origin recovery assets and denies cross-origin submissions at the gateway', async () => {
  const page = await fetch(gateway.url + '/client/shop-a/recover/'); expect(page.status).toBe(200); expect(await page.text()).toContain('Reset owner password');
  expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
  const bridge = await (await fetch(gateway.url + '/client/shop-a/bridge.js')).text(); expect(bridge).toContain('MANSORA_OWNER_RECOVERY_URL');
  const denied = await fetch(gateway.url + '/client/shop-a/recover/request', { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner-a@example.test' }) }); expect(denied.status).toBe(403);
});

const playwright = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
it.skipIf(!playwright)('lets an owner request and redeem a private link in the real browser without exposing proof in request URLs', async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(gateway.url + '/client/shop-b/recover/');
    await page.getByLabel('Owner email').fill('owner-b@example.test');
    await page.getByRole('button', { name: 'Send recovery link' }).click();
    await page.getByRole('status').filter({ hasText: 'If these details match' }).waitFor();
    await recovery.processPending();
    const proof = token(deliveries.at(-1)!);
    const requested: string[] = []; page.on('request', (request: any) => requested.push(request.url()));
    await page.goto(gateway.url + '/client/shop-b/recover/#token=' + proof);
    await page.getByLabel('New password', { exact: true }).fill(password + 'browser');
    await page.getByLabel('Confirm password').fill(password + 'browser');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await page.waitForURL('**/client/shop-b/#username=' + OWNER.username);
    expect(requested.every(url => !url.includes(proof))).toBe(true);
    expect((await shops[1].run(null, 'auth.login', { username: OWNER.username, password: password + 'browser' })).user.role).toBe('owner');
  } finally { await browser.close(); }
});
