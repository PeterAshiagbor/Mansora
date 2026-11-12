import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { OWNER, tempDir } from '../helpers';
import { startDevHost } from '../../apps/desktop/dev/host';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html')))('parked basket with actual inventory and sale commits', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any, owner: string, productId: string;
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Parked-basket test');
    host = await startDevHost({ dataDir: tempDir(), port: 0 });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Parked basket', owner: OWNER });
    owner = (await host.engine.execute(null, 'auth.login', OWNER)).token;
    productId = (await host.engine.execute(owner, 'product.save', { name: 'Paper', barcode: '6001000000011', sku: 'PAPER', sellingPrice: 200, costPrice: 100, openingStock: 10 })).id;
    await host.engine.execute(owner, 'shift.open', { openingFloat: 0 });
    browser = await pw.chromium.launch(); page = await browser.newPage(); page.setDefaultTimeout(10_000);
    await page.goto(host.url); await signIn(); await navigate(page, 'New sale');
  });
  afterAll(async () => { await browser?.close(); if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); } await cloud?.close(); });
  async function signIn() { await page.getByLabel('Username', { exact: true }).fill(OWNER.username); await page.getByLabel('Password', { exact: true }).fill(OWNER.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor(); }
  async function scan() { const input = page.getByLabel('Search or scan product', { exact: true }); await input.fill('6001000000011'); await input.press('Enter'); await page.getByLabel('Quantity of Paper', { exact: true }).waitFor(); }
  const count = () => (host.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n;
  const quantity = () => (host.engine.db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(productId) as any).quantity;
  it('parks without stock changes, survives navigation, refreshes prices and resumes only once before one real sale', async () => {
    await scan(); await page.getByLabel('Quantity of Paper', { exact: true }).fill('2'); await page.getByLabel('Quantity of Paper', { exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Park basket (F4)', exact: true }).click();
    await page.getByRole('button', { name: 'Parked baskets (1) · F6', exact: true }).waitFor();
    expect(count()).toBe(0); expect(quantity()).toBe(10);
    await navigate(page, 'Products'); await navigate(page, 'New sale');
    await host.engine.execute(owner, 'product.save', { id: productId, name: 'Paper', sku: 'PAPER', barcode: '6001000000011', sellingPrice: 300 });
    await page.keyboard.press('F6'); await page.getByRole('button', { name: 'Resume basket 1', exact: true }).click();
    await expect.poll(() => page.getByTestId('basket-total').innerText()).toBe('GHS 6.00');
    expect(await page.getByLabel('Quantity of Paper', { exact: true }).inputValue()).toBe('2');
    await page.getByRole('button', { name: 'Parked baskets (0) · F6', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Resume basket 1', exact: true }).count()).toBe(0); await page.keyboard.press('Escape');
    let submittedId = ''; await page.route('**/invoke', (route: any) => { const body = route.request().postDataJSON(); if (body.command === 'sale.complete') submittedId = body.input.id; return route.continue(); });
    await page.keyboard.press('F9'); const payment = page.getByRole('dialog', { name: 'Take payment', exact: true }); await payment.getByRole('button', { name: 'Exact', exact: true }).click(); await payment.getByRole('button', { name: /Complete sale/ }).click();
    await page.getByTestId('receipt-no').waitFor(); expect(count()).toBe(1); expect(quantity()).toBe(8);
    expect(host.engine.db.prepare('SELECT id, total FROM sales').get()).toMatchObject({ id: submittedId, total: 600 });
    await page.getByRole('button', { name: /New sale.*Enter/ }).click();
  });
  it('preserves an unavailable draft on failed resume and confirms discard without a sale or stock movement', async () => {
    await scan(); await page.keyboard.press('F4'); await page.getByRole('button', { name: 'Parked baskets (1) · F6', exact: true }).click();
    await host.engine.execute(owner, 'product.save', { id: productId, name: 'Paper', sku: 'PAPER', barcode: '6001000000011', sellingPrice: 300, active: false });
    await page.getByRole('button', { name: 'Resume basket 1', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The parked basket is preserved' }).waitFor();
    expect(count()).toBe(1); expect(quantity()).toBe(8);
    await page.getByRole('button', { name: 'Discard basket 1', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Discard parked basket?', exact: true });
    await confirm.getByRole('button', { name: 'Keep basket', exact: true }).click();
    await page.getByRole('button', { name: 'Discard basket 1', exact: true }).click();
    await confirm.getByRole('button', { name: 'Discard parked basket', exact: true }).click();
    await page.getByText('No parked baskets.', { exact: true }).waitFor(); await page.keyboard.press('Escape');
    await host.engine.execute(owner, 'product.save', { id: productId, name: 'Paper', sku: 'PAPER', barcode: '6001000000011', sellingPrice: 300, active: true });
    expect(count()).toBe(1); expect(quantity()).toBe(8);
  });
  it('clears parked data when the user signs out instead of exposing a prior session after login', async () => {
    await scan();
    expect(await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', altKey: true, cancelable: true })))).toBe(true);
    await page.getByLabel('Quantity of Paper', { exact: true }).waitFor();
    await page.keyboard.press('F4'); await page.getByRole('button', { name: 'Parked baskets (1) · F6', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Lock / sign out', exact: true }).click(); await signIn(); await navigate(page, 'New sale');
    await page.getByRole('button', { name: 'Parked baskets (0) · F6', exact: true }).waitFor(); expect(count()).toBe(1);
  });
});
