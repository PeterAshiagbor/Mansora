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
const SKIP = new Set(['Report a problem', 'Lock / sign out', 'Sign out']);

/**
 * Every page in both apps: a refresh stays on the same page, and opening sections, tabs or menu groups never
 * throws the page or the menu back to the top.
 */
describe.skipIf(!pw || !existsSync(join(root, 'apps/admin-web/dist/index.html')))('navigation stays where the person is', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, app: Awaited<ReturnType<typeof buildApp>>, web: Awaited<ReturnType<typeof serveStatic>>, browser: any, shop: any, admin: any;
  const owner = { username: 'owner', name: 'Stability owner', password: randomUUID() };
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Stability shop');
    host = await startDevHost({ dataDir: tempDir(), port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Stability fixture', owner });
    const token = (await host.engine.execute(null, 'auth.login', owner)).token;
    for (let i = 0; i < 40; i++) await host.engine.execute(token, 'product.save', { name: `Product ${i}`, sellingPrice: 1200, costPrice: 600, openingStock: 30, reorderLevel: 40 });
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close(); app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url], billing: cloud.billing }); await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    browser = await pw.chromium.launch(); shop = await browser.newPage({ viewport: { width: 1366, height: 768 } }); admin = await browser.newPage({ viewport: { width: 951, height: 888 } }); // the owner's reported window size
    for (const p of [shop, admin]) p.setDefaultTimeout(10_000);
    await shop.goto(host.url); await signInShop();
    await admin.goto(web.url); await signInAdmin();
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); }
    if (web) await new Promise<void>(r => web.server.close(() => r())); await app?.close(); await cloud?.db.close();
  });
  async function signInShop() { await shop.getByLabel('Username', { exact: true }).fill(owner.username); await shop.getByLabel('Password', { exact: true }).fill(owner.password); await shop.getByRole('button', { name: 'Sign in', exact: true }).click(); await shop.locator('.m-breadcrumb strong').waitFor(); }
  async function signInAdmin() { await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password); await admin.getByRole('button', { name: 'Sign in', exact: true }).click(); await admin.locator('.m-breadcrumb strong').waitFor(); }

  async function allPages(page: any): Promise<string[]> {
    const nav = page.getByRole('navigation', { name: 'Main' });
    const tools = nav.locator('details.m-nav-tools');
    if (await tools.count() && !await tools.evaluate((e: HTMLDetailsElement) => e.open)) await tools.locator(':scope > summary').click();
    for (const g of await nav.locator('details[data-nav-group]').all()) if (!await g.evaluate((e: HTMLDetailsElement) => e.open)) await g.locator(':scope > summary').click();
    return (await nav.locator('button.m-nav-item').allInnerTexts()).map((t: string) => t.trim()).filter((t: string) => t && !SKIP.has(t));
  }

  /** Open every section and tab on the current page after scrolling down; report any that jumps the page to the top. */
  async function jumps(page: any): Promise<string[]> {
    const found: string[] = [];
    const controls = await page.locator('main summary:visible, main [role="tab"]:visible').all();
    for (const c of controls.slice(0, 12)) {
      await page.evaluate(() => { const s = document.querySelector('.m-content-scroll'); if (s) s.scrollTop = Math.max(0, (s.scrollHeight - s.clientHeight) / 2); });
      await c.scrollIntoViewIfNeeded().catch(() => {});
      const before = await page.evaluate(() => document.querySelector('.m-content-scroll')?.scrollTop ?? window.scrollY);
      const label = (await c.innerText().catch(() => '')).split('\n')[0].slice(0, 40);
      await c.click().catch(() => {}); await page.waitForTimeout(150);
      const after = await page.evaluate(() => document.querySelector('.m-content-scroll')?.scrollTop ?? window.scrollY);
      if (before > 150 && after < 20) found.push(`"${label}" scrolled the page from ${Math.round(before)} to ${Math.round(after)}`);
    }
    return found;
  }

  for (const [which, pageOf, signIn] of [['shop', () => shop, () => signInShop()], ['admin', () => admin, () => signInAdmin()]] as const) {
    it(`${which}: every page survives a refresh and never jumps to the top`, async () => {
      const page = pageOf();
      const names = await allPages(page);
      expect(names.length).toBeGreaterThan(4);
      const problems: string[] = [];
      for (const name of names) {
        await navigate(page, name);
        await page.locator('.m-breadcrumb strong').filter({ hasText: name }).waitFor().catch(() => {});
        await page.waitForTimeout(250);
        problems.push(...(await jumps(page)).map((j) => `${which} ${name}: ${j}`));
        // Only the content area scrolls: the window itself must never get a second, outer scrollbar.
        const outer = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
        if (outer > 1) problems.push(`${which} ${name}: the whole window scrolls by ${outer}px`);
        await page.reload();
        if (await page.getByRole('button', { name: 'Sign in', exact: true }).isVisible().catch(() => false)) await signIn();
        await page.locator('.m-breadcrumb strong').waitFor();
        const shown = (await page.locator('.m-breadcrumb strong').innerText()).trim();
        if (shown !== name) problems.push(`${which} ${name}: a refresh went to "${shown}"`);
      }
      expect(problems).toEqual([]);
    });

    it(`${which}: opening menu sections keeps them where they were`, async () => {
      const page = pageOf();
      await allPages(page);
      const nav = page.getByRole('navigation', { name: 'Main' }).locator('.m-nav-groups');
      const groups = await page.getByRole('navigation', { name: 'Main' }).locator('details[data-nav-group] > summary').all();
      // Start with every section closed, then open them one after another, as a person does.
      for (const g of groups) if (await g.evaluate((e: HTMLElement) => (e.parentElement as HTMLDetailsElement).open)) await g.click();
      const problems: string[] = [];
      for (const g of groups) {
        await g.scrollIntoViewIfNeeded();
        const before = await g.boundingBox();
        await g.click(); await page.waitForTimeout(120);
        const after = await g.boundingBox();
        if (before && after && Math.abs(after.y - before.y) > 40) problems.push(`${which} menu "${(await g.innerText()).trim()}" moved ${Math.round(after.y - before.y)}px`);
      }
      void nav;
      expect(problems).toEqual([]);
    });
  }

  it('keeps a half-written problem report while the administrator moves between pages', async () => {
    const report = admin.getByRole('button', { name: 'Report a problem to Mansora' }).first();
    await report.click();
    const dialog = admin.getByRole('dialog', { name: 'Tell Mansora about a problem', exact: true });
    await dialog.getByLabel('What happened?').fill('Draft that must survive');
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await navigate(admin, 'Clients'); await navigate(admin, 'Overview');
    await report.click();
    expect(await dialog.getByLabel('What happened?').inputValue()).toBe('Draft that must survive');
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  });
});
