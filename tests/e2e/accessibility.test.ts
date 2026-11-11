import { navigate } from './navigation';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { buildApp } from '../../apps/api/src/app';
import { serveStatic } from '../../scripts/static';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
const built = ['apps/desktop/dist/renderer/index.html', 'apps/admin-web/dist/index.html'].every((p) => existsSync(join(root, p)));
describe.skipIf(!pw || !built)('accessibility in Chromium', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, web: Awaited<ReturnType<typeof serveStatic>>, app: Awaited<ReturnType<typeof buildApp>>, browser: any, shop: any, admin: any;
  const dir = tempDir('mansora-accessibility-');
  const owner = { name: 'Accessibility fixture', username: 'owner', password: randomUUID() };
  const failures: any[] = [];
  beforeAll(async () => {
    cloud = await startCloud();
    const client = await cloud.createClient('Accessibility test business');
    host = await startDevHost({ dataDir: dir, port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Accessibility fixture', owner });
    const token = (await host.engine.execute(null, 'auth.login', owner)).token;
    await host.engine.execute(token, 'product.save', { name: 'Keyboard product', sellingPrice: 500, costPrice: 300, openingStock: 10, reorderLevel: 5 });
    // Force a wide intrinsic table so grid cards must shrink and scroll their contents.
    await host.engine.execute(token, 'product.save', { name: 'Long' + 'x'.repeat(100), sku: 'S'.repeat(60), sellingPrice: 700, costPrice: 500, openingStock: 2, reorderLevel: 5 });
    await host.engine.execute(token, 'customer.save', { name: 'Test customer' });
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close();
    app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url] });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    browser = await pw.chromium.launch();
    shop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    admin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    shop.setDefaultTimeout(10_000); admin.setDefaultTimeout(10_000);
    await shop.goto(host.url); await admin.goto(web.url);
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>((resolve) => host.server.close(() => resolve())); host.engine.db.close(); }
    if (web) await new Promise<void>((resolve) => web.server.close(() => resolve()));
    await app?.close(); await cloud?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function scan(page: any, name: string) {
    await page.waitForFunction(() => !document.body.innerText.includes('Loading…') && !document.body.innerText.includes('Starting…'));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(axe.source);
    const result = await page.evaluate(async () => {
      const result = await (window as any).axe.run(document, { resultTypes: ['violations'] });
      return result.violations.filter((v: any) => v.impact === 'serious' || v.impact === 'critical').map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n: any) => ({ target: n.target, summary: n.failureSummary })) }));
    });
    if (result.length) failures.push({ page: name, violations: result });
    const overflow = await page.locator('main').evaluateAll((elements: HTMLElement[]) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => ({ actual: el.scrollWidth, available: el.clientWidth })));
    if (overflow.length) failures.push({ page: name, violations: [{ id: 'main-layout-overflow', measurements: overflow }] });
    if (process.env.MANSORA_A11Y_SCREENSHOTS && /zoom 2$/.test(name) && /New sale|Products|Admin Overview|product dialog/.test(name)) {
      mkdirSync(process.env.MANSORA_A11Y_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.MANSORA_A11Y_SCREENSHOTS, name.replace(/[^a-z0-9]+/gi, '-') + '.png') });
    }
    const unlabelledTables = await page.locator('table').evaluateAll((tables: HTMLTableElement[]) => tables.filter((table) => !table.caption?.textContent?.trim() && !table.getAttribute('aria-label') && !table.getAttribute('aria-labelledby')).length);
    expect(unlabelledTables, `${name}: table labels`).toBe(0);
  }
  const nav = navigate;
  it('checks every desktop page and tab, login and a modal at normal size and 200% zoom equivalent viewport', async () => {
    await scan(shop, 'Desktop sign in');
    await shop.getByLabel('Username', { exact: true }).fill(owner.username);
    await shop.getByLabel('Password', { exact: true }).fill(owner.password);
    await shop.getByRole('button', { name: 'Sign in', exact: true }).click();
    await shop.getByRole('button', { name: 'Lock / sign out' }).waitFor();
    await nav(shop, 'New sale');
    await scan(shop, 'Desktop open shift');
    await shop.getByLabel('Opening cash float (GHS)', { exact: true }).fill('0');
    await shop.getByRole('button', { name: 'Open shift', exact: true }).click();
    await shop.getByLabel('Search or scan product').waitFor();
    const names = ['Getting started', 'Billing & payments', 'New sale', 'Sales history', 'Cashier shifts', 'Customers', 'Credit & repayments', 'Products', 'Categories', 'Stock', 'Purchases & suppliers', 'Dashboard', 'Reports', 'Expenses', 'Staff', 'Settings', 'Import & export', 'Sync status', 'Backup & recovery', 'Mansora access', 'Audit history', 'Help & getting started'];
    for (const zoom of [1, 2]) {
      await shop.setViewportSize({ width: 1366 / zoom, height: 768 / zoom });
      for (const name of names) {
        await nav(shop, name);
        await scan(shop, `Desktop ${name} zoom ${zoom}`);
        if (name === 'Reports') { await shop.getByRole('button', { name: /Business summary/ }).click(); await scan(shop, `Desktop report summary zoom ${zoom}`); }
        const tabs = await shop.getByRole('tab').count();
        for (let i = 1; i < tabs; i++) { await shop.getByRole('tab').nth(i).click(); await scan(shop, `Desktop ${name} tab ${i} zoom ${zoom}`); }
      }
      await nav(shop, 'Products');
      await shop.getByRole('button', { name: 'Add product', exact: true }).click();
      await scan(shop, `Desktop product dialog zoom ${zoom}`);
      await shop.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await shop.getByRole('button', { name: 'How to use this page', exact: true }).click();
    await scan(shop, 'Desktop contextual help zoom 2');
    await shop.getByRole('dialog').getByRole('button', { name: 'Got it', exact: true }).click();
    await shop.keyboard.press('Control+k');
    await scan(shop, 'Desktop page finder zoom 2');
    await shop.keyboard.press('Escape');
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
  it('checks all administrator pages, client detail and create dialogs', async () => {
    failures.length = 0;
    await scan(admin, 'Admin sign in');
    await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email);
    await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await admin.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    for (const zoom of [1, 2]) {
      await admin.setViewportSize({ width: 1366 / zoom, height: 768 / zoom });
      for (const name of ['Overview', 'Clients', 'Service plans', 'Collections', 'Subscriptions', 'Invoices', 'Payments', 'Revenue reports', 'Payment settings', 'Audit log', 'Account security']) {
        await nav(admin, name); await scan(admin, `Admin ${name} zoom ${zoom}`);
      }
      await nav(admin, 'Clients');
      await admin.getByRole('button', { name: 'Add client', exact: true }).click();
      await scan(admin, `Admin add client zoom ${zoom}`);
      await admin.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await admin.getByRole('row').filter({ hasText: 'Accessibility test business' }).click();
      await admin.getByRole('heading', { name: 'Accessibility test business', exact: true }).waitFor();
      await scan(admin, `Admin client detail zoom ${zoom}`);
      const tabs = admin.getByRole('tab');
      for (let i = 1; i < await tabs.count(); i++) {
        await tabs.nth(i).click(); await scan(admin, `Admin client detail tab ${i} zoom ${zoom}`);
      }
      if (await tabs.count()) await tabs.first().click();
      const deactivate = admin.getByRole('button', { name: 'Deactivate laptop', exact: true });
      if (await deactivate.count()) {
        await deactivate.click(); await scan(admin, `Admin deactivate laptop dialog zoom ${zoom}`);
        await admin.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    }
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
  it('checks representative desktop and administrator forms at 200% zoom', async () => {
    failures.length = 0;
    await shop.setViewportSize({ width: 683, height: 384 });
    for (const [name, button, tab] of [
      ['Categories', 'Add category'], ['Customers', 'Add customer'], ['Staff', 'Add staff member'],
      ['Purchases & suppliers', 'Receive stock'], ['Purchases & suppliers', 'Add supplier', 'Suppliers'], ['Expenses', 'Record expense'],
    ]) {
      await nav(shop, name);
      if (tab) await shop.getByRole('tab', { name: tab, exact: true }).click();
      await shop.getByRole('button', { name: button, exact: true }).click();
      await scan(shop, `Desktop ${button} dialog zoom 2`);
      await shop.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await nav(shop, 'New sale');
    await shop.getByRole('button').filter({ hasText: 'Keyboard product' }).click();
    await shop.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    await scan(shop, 'Desktop payment dialog zoom 2');
    for (const method of ['Mobile money', 'Card', 'Credit', 'Split payment']) { await shop.getByRole('dialog').getByRole('button', { name: method, exact: true }).click(); await scan(shop, `Desktop ${method} payment zoom 2`); }
    await shop.getByRole('dialog').getByRole('button', { name: 'Back to basket', exact: true }).click();
    // Exercise the discard confirmation before the next test leaves this basket.
    await nav(shop, 'Products');
    const discard = shop.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
    await discard.waitFor();
    await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await shop.getByRole('heading', { name: 'Products', exact: true }).waitFor();
    await nav(admin, 'Clients');
    await admin.getByRole('row').filter({ hasText: 'Accessibility test business' }).click();
    await admin.getByRole('button', { name: 'Edit', exact: true }).click();
    await scan(admin, 'Admin edit client dialog zoom 2');
    await admin.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await nav(admin, 'Service plans');
    await admin.getByRole('button', { name: 'Add plan', exact: true }).click();
    await scan(admin, 'Admin add plan dialog zoom 2');
    await admin.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
  it('supports keyboard table activation, modal focus trap/return and tab arrow keys', async () => {
    await shop.setViewportSize({ width: 1366, height: 768 });
    await nav(shop, 'Products');
    const row = shop.getByRole('row').filter({ hasText: 'Keyboard product' });
    await row.focus(); await shop.keyboard.press('Space');
    const modal = shop.getByRole('dialog', { name: 'Edit product', exact: true });
    await modal.waitFor();
    expect(await modal.evaluate((el: HTMLElement) => el.contains(document.activeElement))).toBe(true);
    const close = modal.getByRole('button', { name: 'Close', exact: true });
    await close.focus(); await shop.keyboard.press('Shift+Tab');
    expect(await modal.getByRole('button', { name: 'Save', exact: true }).evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
    await shop.keyboard.press('Tab');
    expect(await close.evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
    await shop.keyboard.press('Escape');
    await expect.poll(() => row.evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
    await nav(shop, 'Stock');
    await shop.getByRole('tab').first().focus();
    await shop.keyboard.press('ArrowRight');
    await expect.poll(() => shop.getByRole('tab').nth(1).getAttribute('aria-selected')).toBe('true');
    await shop.keyboard.press('Home');
    expect(await shop.getByRole('tab').first().getAttribute('aria-selected')).toBe('true');
  });
});
