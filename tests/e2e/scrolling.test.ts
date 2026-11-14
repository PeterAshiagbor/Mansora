import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
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
const built = ['apps/desktop/dist/renderer/index.html', 'apps/admin-web/dist/index.html'].every(p => existsSync(join(root, p)));
describe.skipIf(!pw || !built)('scrolling and subpage orientation with real records', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, web: Awaited<ReturnType<typeof serveStatic>>, app: Awaited<ReturnType<typeof buildApp>>, browser: any, shop: any, admin: any;
  const owner = { name: 'Scroll review owner', username: 'owner', password: randomUUID() };
  const errors: string[] = [];
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Scroll review shop');
    for (let i = 0; i < 14; i++) await cloud.createClient(`Synthetic client ${String(i).padStart(2, '0')}`);
    host = await startDevHost({ dataDir: tempDir(), port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Scroll fixture', owner });
    const token = (await host.engine.execute(null, 'auth.login', owner)).token;
    await host.engine.execute(token, 'shift.open', { openingFloat: 0 });
    for (let i = 0; i < 60; i++) await host.engine.execute(token, 'product.save', { name: `Product ${String(i).padStart(2, '0')}`, sellingPrice: 500, costPrice: 300, openingStock: 20 });
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close(); app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url] });
    await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    browser = await pw.chromium.launch();
    shop = await browser.newPage({ viewport: { width: 1366, height: 768 } }); admin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    for (const page of [shop, admin]) { page.setDefaultTimeout(10_000); page.on('pageerror', (e: Error) => errors.push(e.message)); }
    await shop.goto(host.url); await shop.getByLabel('Username', { exact: true }).fill(owner.username); await shop.getByLabel('Password', { exact: true }).fill(owner.password); await shop.getByRole('button', { name: 'Sign in', exact: true }).click();
    await shop.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    await admin.goto(web.url); await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password); await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await admin.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>(resolve => host.server.close(() => resolve())); host.engine.db.close(); }
    if (web) await new Promise<void>(resolve => web.server.close(() => resolve()));
    await app?.close(); await cloud?.close();
  });
  const scrollTop = (page: any) => page.locator('.m-content-scroll').evaluate((el: HTMLElement) => el.scrollTop);
  async function inViewport(page: any, locator: any) {
    const box = await locator.boundingBox(); expect(box).not.toBeNull();
    const content = await page.locator('.m-content-scroll').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(content.y - 1); expect(box.y + box.height).toBeLessThanOrEqual(content.y + content.height + 1);
  }
  it('keeps total and payment reachable while browsing a large catalogue and basket on both laptops', async () => {
    await navigate(shop, 'New sale'); await shop.getByLabel('Search or scan product').waitFor();
    for (const button of (await shop.locator('.m-sale-product').all()).slice(0, 12)) await button.click();
    for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
      await shop.setViewportSize(size); await shop.locator('.m-content-scroll').evaluate((el: HTMLElement) => el.scrollTop = 0);
      await inViewport(shop, shop.getByRole('button', { name: 'Pay (F9)', exact: true }));
      await shop.locator('.m-content-scroll').evaluate((el: HTMLElement) => el.scrollTop = 650);
      await inViewport(shop, shop.getByTestId('basket-total'));
      const lines = shop.getByRole('region', { name: 'Basket items', exact: true });
      expect(await lines.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight)).toBe(true);
      await lines.focus(); await shop.keyboard.press('Control+End');
      await expect.poll(() => lines.evaluate((el: HTMLElement) => el.scrollTop > 0)).toBe(true);
      await inViewport(shop, shop.getByRole('button', { name: 'Pay (F9)', exact: true }));
    }
    await shop.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    const payment = shop.getByRole('dialog', { name: 'Take payment', exact: true }); await payment.waitFor();
    await payment.getByRole('button', { name: 'Back to basket', exact: true }).click();
    await shop.getByRole('button', { name: 'Clear', exact: true }).click(); await shop.getByRole('button', { name: 'Discard changes', exact: true }).click();
  });
  it('starts committed page and client-detail navigation at the top with keyboard focus in content', async () => {
    await navigate(shop, 'Settings'); await shop.locator('.m-content-scroll').evaluate((el: HTMLElement) => el.scrollTop = 500);
    await navigate(shop, 'Products'); await shop.getByRole('heading', { name: 'Products', exact: true }).waitFor();
    expect(await scrollTop(shop)).toBe(0); expect(await shop.locator('main').evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
    await navigate(admin, 'Clients'); const row = admin.getByRole('row').filter({ hasText: 'Synthetic client 13' });
    await row.focus(); await admin.keyboard.press('Enter'); await admin.getByRole('heading', { name: 'Synthetic client 13', exact: true }).waitFor();
    expect(await admin.locator('.m-breadcrumb strong').innerText()).toBe('Client details');
    expect(await scrollTop(admin)).toBe(0); expect(await admin.locator('main').evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
    await admin.locator('.m-content-scroll').evaluate((el: HTMLElement) => el.scrollTop = 500);
    await admin.getByRole('button', { name: '← All clients', exact: true }).click();
    expect(await scrollTop(admin)).toBe(0); expect(await admin.locator('main').evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
  });
  it('leaves the compact header usable and all detail sections reachable at 390px and zoom-equivalent sizes', async () => {
    for (const size of [{ width: 390, height: 844 }, { width: 683, height: 384 }]) {
      await admin.setViewportSize(size); await navigate(admin, 'Clients');
      const search = await admin.getByRole('button', { name: 'Find a page', exact: true }).boundingBox(); expect(search.width).toBeLessThanOrEqual(48);
      const breadcrumb = await admin.locator('.m-breadcrumb').boundingBox(); expect(breadcrumb.width).toBeGreaterThan(90);
      await admin.getByRole('row').filter({ hasText: 'Scroll review shop' }).click();
      await admin.getByRole('heading', { name: 'Scroll review shop', exact: true }).waitFor();
      await admin.getByRole('heading', { name: 'Cloud backups (encrypted by the client; Mansora cannot open them)', exact: true }).scrollIntoViewIfNeeded();
      expect(await scrollTop(admin)).toBeGreaterThan(0);
      expect(await admin.locator('main').evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await admin.getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = admin.getByRole('dialog', { name: 'Edit client', exact: true });
      await dialog.getByRole('region').focus(); await admin.keyboard.press('Control+End');
      const save = await dialog.getByRole('button', { name: 'Save', exact: true }).boundingBox(); expect(save.y + save.height).toBeLessThanOrEqual(size.height);
      const before = await scrollTop(admin); await admin.mouse.move(save.x, save.y - 30); await admin.mouse.wheel(0, 1000); await admin.waitForTimeout(150); expect(await scrollTop(admin)).toBe(before);
      await admin.keyboard.press('Escape');
    }
    expect(errors).toEqual([]);
  });
  it('records a sale with the cloud stopped, shows pending changes, then syncs it once after reconnecting', async () => {
    await shop.setViewportSize({ width: 1366, height: 768 });
    await app.close();
    await navigate(shop, 'New sale'); await shop.getByLabel('Search or scan product').waitFor();
    await shop.getByRole('button', { name: /Product 00/ }).click();
    await shop.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    await shop.getByLabel('Cash received', { exact: true }).fill('10');
    expect(await shop.getByTestId('change').innerText()).toBe('GHS 5.00');
    await shop.getByRole('button', { name: /Complete sale/ }).click();
    await shop.getByTestId('receipt-no').waitFor();
    const sale = host.engine.db.prepare('SELECT id, total, change_given FROM sales').get() as any;
    expect(sale).toMatchObject({ total: 500, change_given: 500 });
    await shop.getByRole('dialog', { name: 'Sale completed', exact: true }).getByRole('button', { name: /New sale/ }).click();
    await navigate(shop, 'Sync status'); await shop.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shop.getByText('Offline', { exact: true }).first().waitFor();
    expect((host.engine.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'").get() as any).n).toBeGreaterThan(0);
    app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url] });
    await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    await shop.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shop.getByText('Everything is synced', { exact: true }).waitFor();
    expect((host.engine.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'").get() as any).n).toBe(0);
    const cloudSales = await cloud.db.tenant(host.engine.meta('tenant_id')!, q => q('SELECT id, total FROM sales WHERE id = $1', [sale.id]));
    expect(cloudSales).toHaveLength(1); expect(cloudSales[0].total).toBe(500);
    const [retry] = await Promise.all([
      shop.waitForResponse((response: any) => response.url().endsWith('/invoke') && response.request().postDataJSON()?.command === 'sync.run'),
      shop.getByRole('button', { name: 'Sync now', exact: true }).click(),
    ]);
    expect((await retry.json()).data.ok).toBe(true);
    expect((await cloud.db.tenant(host.engine.meta('tenant_id')!, q => q('SELECT id FROM sales WHERE id = $1', [sale.id]))).length).toBe(1);
    expect(errors).toEqual([]);
  });
});
