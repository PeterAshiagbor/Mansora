import { navigate } from './navigation';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { buildApp } from '../../apps/api/src/app';
import { serveStatic } from '../../scripts/static';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
const built = ['apps/desktop/dist/renderer/index.html', 'apps/admin-web/dist/index.html'].every((p) => existsSync(join(root, p)));
describe.skipIf(!pw || !built)('Mansora provider branding and client workspace identity', () => {
  let cloud: Cloud, browser: any, admin: any, web: Awaited<ReturnType<typeof serveStatic>>, app: Awaited<ReturnType<typeof buildApp>>;
  const shops: { host: Awaited<ReturnType<typeof startDevHost>>; page: any; dir: string; name: string; password: string }[] = [];
  const external: string[] = [], errors: string[] = [];
  beforeAll(async () => {
    cloud = await startCloud(); browser = await pw.chromium.launch();
    for (const name of ['Alpha client shop', 'Beta client shop']) {
      const client = await cloud.createClient(name); const dir = tempDir('mansora-brand-fixture-'); const password = randomUUID();
      const host = await startDevHost({ dataDir: dir, port: 0, dbKey: randomUUID() });
      await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Synthetic client laptop', owner: { name: 'Client owner', username: 'owner', password } });
      const token = (await host.engine.execute(null, 'auth.login', { username: 'owner', password })).token;
      const product = await host.engine.execute(token, 'product.save', { name: name === 'Alpha client shop' ? 'Alpha stock item' : 'Beta stock item', sellingPrice: 1200, costPrice: 800, openingStock: 24 });
      if (name === 'Alpha client shop') {
        await host.engine.execute(token, 'shift.open', { openingFloat: 0 });
        await host.engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId: product.id, quantity: 1 }], tenders: [{ method: 'cash', amount: 1200 }] });
      }
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      shops.push({ host, page, dir, name, password });
    }
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close(); app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url] });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    admin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    for (const page of [...shops.map((shop) => shop.page), admin]) {
      page.setDefaultTimeout(10_000); page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.route('**/*', (route: any) => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.origin); return route.abort(); }
        return route.continue();
      });
    }
  });
  afterAll(async () => {
    await browser?.close();
    for (const shop of shops) { await new Promise<void>((resolve) => shop.host.server.close(() => resolve())); shop.host.engine.db.close(); rmSync(shop.dir, { recursive: true, force: true }); }
    if (web) await new Promise<void>((resolve) => web.server.close(() => resolve()));
    await app?.close(); await cloud?.close();
  });
  async function checkBrand(page: any) {
    const mark = page.getByTestId('mansora-brand');
    await mark.getByText('MANSORA', { exact: true }).waitFor();
    await mark.getByText('Consulting & Business Solutions', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.fonts.load('400 16px "DM Sans"', 'Ɛ'));
    expect(await page.evaluate(() => document.fonts.check('400 16px "DM Sans"'))).toBe(true);
    expect(await page.locator('body').evaluate((el: HTMLElement) => getComputedStyle(el).fontFamily)).toContain('DM Sans');
    expect(await page.getByRole('heading').first().evaluate((el: HTMLElement) => getComputedStyle(el).fontFamily)).toContain('DM Sans');
    expect(await mark.getByText('MANSORA', { exact: true }).evaluate((el: HTMLElement) => getComputedStyle(el).fontFamily)).toContain('Georgia');
    await expect.poll(() => mark.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(new URL(await mark.locator('img').getAttribute('src'), page.url()).origin).toBe(new URL(page.url()).origin);
    const colors = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return ['--color-brand-700', '--color-brand-900', '--color-mansora-gold'].map((key) => css.getPropertyValue(key).trim());
    });
    expect(colors).toEqual(['#5c2d85', '#38145c', '#c48b17']);
    const license = await page.request.get(new URL('/licenses/OFL-DM-Sans.txt', page.url()).href);
    expect(license.status()).toBe(200); expect(await license.text()).toContain('SIL OPEN FONT LICENSE Version 1.1');
  }
  async function screenshot(page: any, name: string) {
    if (!process.env.MANSORA_BRAND_SCREENSHOTS) return;
    mkdirSync(process.env.MANSORA_BRAND_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.MANSORA_BRAND_SCREENSHOTS, name + '.png') });
  }
  it('keeps each business identity inside the shared Mansora SaaS brand with local logos/fonts', async () => {
    for (const shop of shops) {
      await shop.page.goto(shop.host.url); await checkBrand(shop.page);
      await shop.page.getByRole('heading', { name: shop.name, exact: true }).waitFor();
      await shop.page.getByLabel('Username', { exact: true }).fill('owner');
      await shop.page.getByLabel('Password', { exact: true }).fill(shop.password);
      await shop.page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await shop.page.getByRole('navigation').getByText('Client workspace', { exact: true }).waitFor();
      await shop.page.getByRole('navigation').getByText(shop.name, { exact: true }).waitFor();
      await checkBrand(shop.page);
      if (shop.name === 'Alpha client shop') await screenshot(shop.page, 'client-dashboard');
      await shop.page.getByRole('navigation').getByRole('button', { name: 'Products', exact: true }).click();
      await shop.page.getByRole('cell', { name: shop.name === 'Alpha client shop' ? 'Alpha stock item' : 'Beta stock item', exact: true }).waitFor();
      expect(await shop.page.getByRole('cell', { name: shop.name === 'Alpha client shop' ? 'Beta stock item' : 'Alpha stock item', exact: true }).count()).toBe(0);
      expect(await shop.page.getByRole('button', { name: 'Add product', exact: true }).evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor)).toBe('rgb(92, 45, 133)');
    }
    await screenshot(shops[0].page, 'client-workspace');
    expect(external).toEqual([]);
  });
  it('identifies provider administration separately from client workspaces', async () => {
    await admin.goto(web.url); await checkBrand(admin);
    await admin.getByRole('heading', { name: 'Administrator sign in', exact: true }).waitFor();
    await screenshot(admin, 'platform-sign-in');
    await admin.getByLabel('Email').fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await admin.getByRole('navigation').getByText('Platform administration', { exact: true }).waitFor();
    await checkBrand(admin);
    await admin.getByRole('navigation').getByRole('button', { name: 'Clients', exact: true }).click();
    await admin.getByRole('cell', { name: /Alpha client shop/ }).waitFor();
    await admin.getByRole('cell', { name: /Beta client shop/ }).waitFor();
    await screenshot(admin, 'platform-clients');
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
  it('finds permitted pages, explains reports and provides searchable task guides', async () => {
    const page = shops[0].page;
    await page.keyboard.press('Control+k');
    const finder = page.getByRole('dialog', { name: 'Find a page', exact: true });
    await finder.getByLabel('Find a page', { exact: true }).fill('reports');
    await finder.getByLabel('Find a page', { exact: true }).press('Enter');
    await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
    await page.getByRole('button', { name: /Business summary/ }).click();
    await page.getByText('Collections after refunds', { exact: true }).first().waitFor();
    expect(await page.getByRole('row').filter({ hasText: 'Collections after refunds' }).getByRole('cell').last().innerText()).toBe('GHS 12.00');
    await screenshot(page, 'business-summary');
    await page.getByRole('tab', { name: 'Expenses', exact: true }).click();
    await page.getByRole('heading', { name: 'Expense detail', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Customer balances', exact: true }).click();
    await page.getByText('Current customer balances as of now.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'How to use this page', exact: true }).click();
    const guide = page.getByRole('dialog', { name: 'How to use: Reports', exact: true });
    await guide.getByText('Net sales = sales after discounts less refunds.', { exact: false }).waitFor();
    await guide.getByRole('button', { name: 'Got it', exact: true }).click();
    await navigate(page, 'Help & getting started');
    await page.getByLabel('Search help guides', { exact: true }).fill('carton');
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Products', exact: true }) }).getByRole('button', { name: 'Read guide', exact: true }).click();
    const productGuide = page.getByRole('dialog', { name: 'How to use: Products', exact: true });
    await productGuide.getByText('Example: GHS 100', { exact: false }).waitFor();
    await screenshot(page, 'product-help');
    await productGuide.getByRole('button', { name: 'Close', exact: true }).last().click();
    expect(errors).toEqual([]);
  });

});
