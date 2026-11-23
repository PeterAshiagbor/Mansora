import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultTaxConfig } from '@mansora/domain';
import { startDevHost } from '../../apps/desktop/dev/host';
import { makeShop, OWNER, TEST_DB_KEY } from '../helpers';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html')))('VAT classification before adding stock', () => {
  let host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
  beforeAll(async () => {
    const shop = await makeShop();
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'TEST-TIN', reason: 'Synthetic setup' });
    shop.engine.db.close();
    host = await startDevHost({ dataDir: shop.dir, dbKey: TEST_DB_KEY, port: 0 });
    browser = await pw.chromium.launch(); page = await browser.newPage(); page.setDefaultTimeout(10000);
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(OWNER.username);
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  });
  afterAll(async () => { await browser?.close(); if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); } });
  it('highlights missing classification for opening stock, then allows classified stock', async () => {
    await navigate(page, 'Products');
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add product', exact: true });
    await dialog.getByLabel('Product name', { exact: true }).fill('Classified browser item');
    await dialog.getByLabel('Selling price (GHS)', { exact: true }).fill('12');
    await dialog.getByLabel('Cost price (GHS)', { exact: true }).fill('6');
    await dialog.getByLabel('Opening stock', { exact: true }).fill('2');
    await dialog.getByRole('button', { name: 'Complete Ghana VAT classification', exact: true }).waitFor();
    expect(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(true);
    await dialog.getByLabel('Ghana VAT classification', { exact: true }).selectOption('exempt');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(host.engine.db.prepare('SELECT tax_class FROM products WHERE name=?').get('Classified browser item')).toEqual({ tax_class: 'exempt' });
  });
  it('blocks receiving an unclassified product with a clear explanation', async () => {
    await navigate(page, 'Purchases & suppliers');
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Receive stock', exact: true });
    await dialog.getByLabel('Product', { exact: true }).selectOption({ label: 'Milk tin (VAT classification required)' });
    await dialog.getByLabel('Quantity', { exact: true }).fill('2');
    await dialog.getByText('Choose VAT classifications in Products before receiving stock for: Milk tin.', { exact: true }).waitFor();
    expect(await dialog.getByRole('button', { name: 'Receive into stock', exact: true }).isDisabled()).toBe(true);
  });
});
