import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { buildApp } from '../../apps/api/src/app';
import { serveStatic } from '../../scripts/static';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/admin-web/dist/index.html')))('progressive interface with real records', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, app: Awaited<ReturnType<typeof buildApp>>, web: Awaited<ReturnType<typeof serveStatic>>, browser: any, shop: any, admin: any;
  const owner = { username: 'owner', name: 'Progressive owner', password: randomUUID() }, cashier = { username: 'cashier', name: 'Progressive cashier', password: randomUUID() };
  const errors: string[] = []; let salesReads = 0;
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Progressive interface shop');
    host = await startDevHost({ dataDir: tempDir(), port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Progressive fixture', owner });
    const token = (await host.engine.execute(null, 'auth.login', owner)).token;
    await host.engine.execute(token, 'staff.save', { ...cashier, role: 'cashier' });
    const product = await host.engine.execute(token, 'product.save', { name: 'Simple item', sellingPrice: 1200, costPrice: 600, openingStock: 30 });
    await host.engine.execute(token, 'shift.open', { openingFloat: 0 });
    for (let i = 0; i < 7; i++) await host.engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId: product.id, quantity: 1 }], tenders: [{ method: 'cash', amount: 1200 }] });
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close(); app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url], billing: cloud.billing }); await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    browser = await pw.chromium.launch(); shop = await browser.newPage({ viewport: { width: 1366, height: 768 } }); admin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    for (const p of [shop, admin]) { p.setDefaultTimeout(10_000); p.on('pageerror', (e: Error) => errors.push(e.message)); }
    await shop.route('**/invoke', (r: any) => { if (r.request().postDataJSON()?.command === 'report.sales') salesReads++; return r.continue(); });
    await shop.goto(host.url); await shop.getByLabel('Username', { exact: true }).fill(owner.username); await shop.getByLabel('Password', { exact: true }).fill(owner.password); await shop.getByRole('button', { name: 'Sign in', exact: true }).click();
    await shop.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor(); await shop.getByRole('table').waitFor();
    await admin.goto(web.url); await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password); await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); }
    if (web) await new Promise<void>(r => web.server.close(() => r())); await app?.close(); await cloud?.db.close();
  });
  it('starts with five owner shortcuts and a small dashboard, loading breakdown only on request', async () => {
    const nav = shop.getByRole('navigation');
    expect(await nav.locator('button.m-nav-item:visible').allInnerTexts()).toEqual(['Dashboard', 'New sale', 'Products', 'Customers', 'Reports', 'Lock / sign out']);
    expect(await nav.getByRole('button', { name: 'Stock', exact: true }).count()).toBe(0);
    expect(await nav.getByRole('button', { name: 'Stock', exact: true, includeHidden: true }).count()).toBe(1);
    expect(await shop.getByRole('table').getByRole('row').count()).toBe(6); expect(salesReads).toBe(0);
    expect(await shop.getByRole('heading', { name: 'Payment mix today', exact: true }).count()).toBe(0);
    await shop.getByText('Daily breakdown', { exact: true }).click(); await shop.getByRole('heading', { name: 'Payment mix today', exact: true }).waitFor();
    await expect.poll(() => salesReads).toBe(1); await shop.getByText('Daily breakdown', { exact: true }).click();
  });
  it('keeps every permitted tool discoverable and reveals a searched page in its group', async () => {
    await navigate(shop, 'Stock'); expect(await shop.getByRole('navigation').getByRole('button', { name: 'Stock', exact: true }).getAttribute('aria-current')).toBe('page');
    expect(await shop.locator('details[data-nav-group][open]').count()).toBe(1);
    await navigate(shop, 'Dashboard'); await expect.poll(() => shop.locator('details.m-nav-tools').getAttribute('open')).toBe(null);
    await shop.keyboard.press('Control+k'); const finder = shop.getByRole('dialog', { name: 'Find a page', exact: true });
    await finder.getByLabel('Find a page', { exact: true }).fill('backup'); await finder.getByRole('button', { name: /Backup & recovery/ }).click();
    await shop.getByRole('heading', { name: 'Backup & recovery', exact: true }).waitFor(); expect(await shop.getByRole('navigation').getByRole('button', { name: 'Backup & recovery', exact: true }).isVisible()).toBe(true);
    expect(await shop.locator('details[data-nav-group][open]').count()).toBe(1);
  });
  it('retains optional product entries and reveals a collapsed invalid field before saving', async () => {
    await navigate(shop, 'Products'); await shop.getByRole('button', { name: 'Add product', exact: true }).click(); const form = shop.getByRole('dialog', { name: 'Add product', exact: true });
    expect(await form.getByLabel('SKU / item code', { exact: true }).isVisible()).toBe(false); expect(await form.getByLabel('Carton purchase cost (GHS)', { exact: true }).isVisible()).toBe(false);
    await form.getByLabel('Product name', { exact: true }).fill('Progressive product'); await form.getByLabel('Selling price (GHS)', { exact: true }).fill('2'); await form.getByLabel('Cost price (GHS)', { exact: true }).fill('1'); await form.getByLabel('Opening stock', { exact: true }).fill('3');
    await form.getByText('More product details', { exact: true }).click(); await form.getByLabel('SKU / item code', { exact: true }).fill('PROGRESSIVE-1'); await form.getByLabel('Reorder level', { exact: true }).fill('-1');
    await form.getByText('More product details', { exact: true }).click(); await form.getByRole('button', { name: 'Save', exact: true }).click();
    expect(await form.getByLabel('Reorder level', { exact: true }).isVisible()).toBe(true); expect(await form.getByLabel('SKU / item code', { exact: true }).inputValue()).toBe('PROGRESSIVE-1');
    expect(host.engine.db.prepare("SELECT COUNT(*) AS n FROM products WHERE sku = 'PROGRESSIVE-1'").get()).toMatchObject({ n: 0 });
    await form.getByLabel('Reorder level', { exact: true }).fill('1'); await form.getByRole('button', { name: 'Save', exact: true }).click(); await shop.getByRole('cell', { name: 'Progressive product', exact: true }).waitFor();
    expect(host.engine.db.prepare("SELECT cost_price, selling_price FROM products WHERE sku = 'PROGRESSIVE-1'").get()).toMatchObject({ cost_price: 100, selling_price: 200 });
  });
  it('keeps exports available through one contextual action and preserves their real data', async () => {
    expect(await shop.getByRole('button', { name: 'CSV', exact: true }).count()).toBe(0);
    await shop.getByText('Export & print', { exact: true }).click(); await shop.getByRole('button', { name: 'Excel', exact: true }).waitFor(); await shop.keyboard.press('Escape');
    expect(await shop.getByRole('button', { name: 'CSV', exact: true }).count()).toBe(0);
    await shop.getByText('Export & print', { exact: true }).click(); const [download] = await Promise.all([shop.waitForEvent('download'), shop.getByRole('button', { name: 'CSV', exact: true }).click()]);
    const path = await download.path(); expect(readFileSync(path, 'utf8')).toContain('PROGRESSIVE-1'); expect(readFileSync(path, 'utf8')).toContain('Simple item');
  });
  it('gives the platform team five daily pages and expandable operational detail', async () => {
    await admin.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    expect(await admin.getByRole('navigation').locator('button.m-nav-item:visible').allInnerTexts()).toEqual(['Overview', 'Clients', 'Collections', 'Invoices', 'Payments', 'Sign out']);
    expect(await admin.getByRole('heading', { name: 'Onboarding in progress', exact: true }).count()).toBe(0);
    await admin.getByText('Onboarding & plan details', { exact: true }).click(); await admin.getByRole('heading', { name: 'Onboarding in progress', exact: true }).waitFor();
    await navigate(admin, 'Account security'); await admin.getByRole('heading', { name: 'Account security', exact: true }).waitFor();
  });
  it('refreshes the overview from a real sale entered in another session', async () => {
    await navigate(shop, 'Dashboard'); await shop.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    const total = shop.getByText('Sales today', { exact: true }).locator('..'); await expect.poll(() => total.innerText()).toContain('84.00');
    const token = (await host.engine.execute(null, 'auth.login', owner)).token;
    const [product] = await host.engine.execute(token, 'product.list', { search: 'Simple item' });
    await host.engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId: product.id, quantity: 1 }], tenders: [{ method: 'cash', amount: 1200 }] }); host.engine.endSession(token);
    expect(await total.innerText()).toContain('84.00');
    await shop.getByRole('button', { name: 'Refresh overview', exact: true }).click();
    await expect.poll(() => shop.getByText('Sales today', { exact: true }).locator('..').innerText()).toContain('96.00');
    expect(await shop.getByRole('table').getByRole('row').count()).toBe(6);
  });
  it('retains cashier restrictions across the complete collapsed page set', async () => {
    await shop.getByRole('button', { name: 'Lock / sign out', exact: true }).click(); await shop.getByLabel('Username', { exact: true }).fill(cashier.username); await shop.getByLabel('Password', { exact: true }).fill(cashier.password); await shop.getByRole('button', { name: 'Sign in', exact: true }).click();
    await shop.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor(); const nav = shop.getByRole('navigation');
    expect(await nav.locator('button.m-nav-item:visible').allInnerTexts()).toEqual(['Dashboard', 'New sale', 'Sales history', 'Cashier shifts', 'Products', 'Lock / sign out']);
    for (const name of ['Reports', 'Staff', 'Audit history', 'Import & export', 'Billing & payments']) expect(await nav.getByRole('button', { name, exact: true, includeHidden: true }).count()).toBe(0);
    await navigate(shop, 'Products'); expect(await shop.getByRole('columnheader', { name: 'Cost', exact: true }).count()).toBe(0); expect(errors).toEqual([]);
  });
});
