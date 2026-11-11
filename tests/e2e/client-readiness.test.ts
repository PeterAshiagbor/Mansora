import { navigate } from './navigation';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/desktop/dist/renderer/index.html')))('client readiness with real saved records and recoverable failures', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, context: any, page: any, token: string;
  const dir = tempDir('mansora-client-acceptance-');
  const owner = { name: 'Readiness Owner', username: 'owner', password: randomUUID() };
  const errors: string[] = [];
  const evidence = process.env.MANSORA_READINESS_EVIDENCE;
  const read = (sql: string, ...values: any[]) => host.engine.db.prepare(sql).get(...values) as any;
  const balance = () => read("SELECT b.quantity, b.average_cost FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE p.sku = 'READY-1'");
  const nav = (name: string) => navigate(page, name);
  async function screenshot(name: string) { if (evidence) await page.screenshot({ path: join(evidence, name + '.png'), fullPage: false }); }
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Client readiness business');
    host = await startDevHost({ dataDir: dir, port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Acceptance laptop', owner });
    token = (await host.engine.execute(null, 'auth.login', owner)).token;
    browser = await pw.chromium.launch();
    if (evidence) mkdirSync(evidence, { recursive: true });
    context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...(evidence ? { recordVideo: { dir: join(evidence, 'raw'), size: { width: 1366, height: 768 } } } : {}) });
    page = await context.newPage(); page.setDefaultTimeout(10_000);
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(owner.username);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  });
  afterAll(async () => {
    const video = page?.video(); await context?.close();
    if (evidence && video) await video.saveAs(join(evidence, 'client-workflow.webm'));
    await browser?.close();
    if (host) { await new Promise<void>((resolve) => host.server.close(() => resolve())); host.engine.db.close(); }
    await cloud?.close(); rmSync(dir, { recursive: true, force: true });
  });
  it('guides a new owner and refuses invalid prices or fractional opening stock before saving', async () => {
    await page.getByRole('button', { name: 'Start business setup', exact: true }).click();
    await page.getByRole('heading', { name: 'Getting started', exact: true }).waitFor();
    await page.getByText('Add your catalogue', { exact: true }).waitFor();
    await page.getByText('Backup needed', { exact: true }).waitFor();
    await screenshot('01-owner-setup');
    await page.getByRole('button', { name: 'Review products', exact: true }).click();
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add product', exact: true });
    await form.getByLabel('Product name').fill('Readiness product');
    await form.getByText('More product details', { exact: true }).click();
    await form.getByLabel('SKU / item code').fill('READY-1');
    await form.getByLabel('Selling price (GHS)').fill('12');
    await form.getByLabel('Cost price (GHS)').fill('not-an-amount');
    expect(await form.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(true);
    expect(await form.getByLabel('Cost price (GHS)').evaluate((el: HTMLInputElement) => el.validity.customError)).toBe(true);
    await form.getByLabel('Cost price (GHS)').fill('8');
    await form.getByLabel('Opening stock', { exact: true }).fill('6.5');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    expect(read('SELECT COUNT(*) AS n FROM products').n).toBe(0);
    await form.getByLabel('Opening stock', { exact: true }).fill('6');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('cell', { name: 'Readiness product', exact: true }).waitFor();
    expect(balance()).toMatchObject({ quantity: 6, average_cost: 800 });
  });
  it('receives whole selling units without rounding an invalid purchase quantity', async () => {
    await nav('Purchases & suppliers'); await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Receive stock', exact: true });
    await form.getByLabel('Product', { exact: true }).selectOption({ label: 'Readiness product' });
    await form.getByLabel('Quantity', { exact: true }).fill('4.5');
    await form.getByLabel('Unit cost', { exact: true }).fill('9');
    expect(await form.getByRole('button', { name: 'Receive into stock', exact: true }).isDisabled()).toBe(true);
    expect(read('SELECT COUNT(*) AS n FROM purchases').n).toBe(0);
    await form.getByLabel('Quantity', { exact: true }).fill('4');
    await form.getByRole('button', { name: 'Receive into stock', exact: true }).click();
    await expect.poll(() => balance()).toMatchObject({ quantity: 10, average_cost: 840 });
  });
  it('protects a basket, preserves a refused payment and saves one real sale with correct change', async () => {
    await nav('New sale'); await page.getByLabel('Opening cash float (GHS)').fill('100');
    await page.getByRole('button', { name: 'Open shift', exact: true }).click();
    await page.getByRole('button').filter({ hasText: 'Readiness product' }).click();
    await nav('Reports');
    let guard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
    await guard.getByRole('button', { name: 'Keep working', exact: true }).click();
    const quantity = page.getByLabel('Quantity of Readiness product', { exact: true });
    await quantity.fill('1.5');
    expect(await page.getByRole('button', { name: 'Pay (F9)', exact: true }).isDisabled()).toBe(true);
    await quantity.fill('2');
    await page.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    const payment = page.getByRole('dialog', { name: 'Take payment', exact: true });
    await payment.getByLabel('Cash received', { exact: true }).fill('25');
    await payment.getByRole('button', { name: 'Mobile money', exact: true }).click();
    await payment.getByLabel('Mobile money amount', { exact: true }).fill('invalid');
    await payment.getByRole('button', { name: /Complete sale/ }).click();
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
    await payment.getByLabel('Mobile money amount', { exact: true }).fill('');
    let refuse = true;
    await page.route('**/invoke', async (route: any) => {
      if (route.request().postDataJSON()?.command === 'sale.complete' && refuse) { refuse = false; return route.fulfill({ json: { ok: false, error: { code: 'ACCEPTANCE_REFUSAL', message: 'The sale was not saved. Retry without entering it again.' } } }); }
      return route.continue();
    });
    await payment.getByRole('button', { name: /Complete sale/ }).click();
    await payment.getByText('The sale was not saved.', { exact: false }).waitFor();
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
    expect(await payment.getByLabel('Cash received', { exact: true }).inputValue()).toBe('25');
    await screenshot('02-payment-recovery');
    await payment.getByRole('button', { name: /Complete sale/ }).click();
    const done = page.getByRole('dialog', { name: 'Sale completed', exact: true }); await done.waitFor();
    await done.getByTestId('receipt-no').waitFor();
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(1);
    expect(read('SELECT total, change_given FROM sales')).toMatchObject({ total: 2400, change_given: 100 });
    expect(balance().quantity).toBe(8);
    await screenshot('03-sale-saved');
    await done.getByRole('button', { name: /New sale/ }).click(); await page.unroute('**/invoke');
  });
  it('keeps physical counts in whole units and records the verified difference', async () => {
    await nav('Stock'); await page.getByRole('tab', { name: 'Stock count', exact: true }).click();
    const counted = page.getByLabel('Counted quantity of Readiness product', { exact: true });
    await counted.fill('7.5'); expect(await page.getByRole('button', { name: /Save count/ }).isDisabled()).toBe(true);
    expect(balance().quantity).toBe(8);
    await counted.fill('7'); await page.getByRole('button', { name: /Save count/ }).click();
    await expect.poll(() => balance().quantity).toBe(7);
    expect(read("SELECT quantity_delta FROM inventory_movements WHERE type = 'STOCK_COUNT_ADJUSTMENT' ORDER BY rowid DESC LIMIT 1").quantity_delta).toBe(-1);
  });
  it('hides stale report amounts on failure and retries the selected period', async () => {
    await nav('Reports');
    await page.getByRole('button', { name: 'Business summary', exact: false }).click();
    const total = () => page.getByRole('row').filter({ hasText: /^Net sales/ }).getByRole('cell').last();
    await expect.poll(() => total().innerText()).toBe('GHS 24.00');
    let blocked = true;
    await page.route('**/invoke', async (route: any) => {
      if (route.request().postDataJSON()?.command === 'report.sales' && blocked) return route.fulfill({ json: { ok: false, error: { code: 'ACCEPTANCE_READ', message: 'The report could not be read. Your saved sales are unchanged.' } } });
      return route.continue();
    });
    await page.getByRole('button', { name: 'Last month', exact: true }).click();
    await page.getByText('Could not load report data.', { exact: true }).waitFor();
    expect(await page.getByText('GHS 24.00', { exact: true }).count()).toBe(0);
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(1);
    await screenshot('04-report-retry');
    blocked = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => total().innerText()).toBe('GHS 0.00');
    await page.getByRole('button', { name: 'This month', exact: true }).click();
    await expect.poll(() => total().innerText()).toBe('GHS 24.00');
    await page.unroute('**/invoke');
  });
  it('ignores an older report response after a newer period has loaded', async () => {
    const total = () => page.getByRole('row').filter({ hasText: /^Net sales/ }).getByRole('cell').last();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect.poll(() => total().innerText()).toBe('GHS 24.00');
    let release!: () => void, started = false, delivered = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const from = new Date().toISOString().slice(0, 8) + '01';
    await page.route('**/invoke', async (route: any) => {
      const input = route.request().postDataJSON();
      if (input.command === 'report.sales' && input.input.from === from && !started) {
        started = true; const response = await route.fetch(); await gate; await route.fulfill({ response }); delivered = true; return;
      }
      return route.continue();
    });
    try {
      await page.getByRole('button', { name: 'This month', exact: true }).click();
      await expect.poll(() => started).toBe(true);
      await page.getByRole('button', { name: 'Last month', exact: true }).click();
      await expect.poll(() => total().innerText()).toBe('GHS 0.00');
      release(); await expect.poll(() => delivered).toBe(true);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await total().innerText()).toBe('GHS 0.00');
    } finally { release(); await page.unroute('**/invoke'); }
  });
  it('protects edited forms and saves settings without a false discard prompt', async () => {
    await nav('Products'); await page.getByRole('row').filter({ hasText: 'Readiness product' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit product', exact: true });
    await edit.getByLabel('Selling price (GHS)').fill('15'); await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    let guard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
    await guard.getByRole('button', { name: 'Keep working', exact: true }).click();
    expect(await edit.getByLabel('Selling price (GHS)').inputValue()).toBe('15');
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    guard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
    await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
    expect(read("SELECT selling_price FROM products WHERE sku = 'READY-1'").selling_price).toBe(1200);
    await nav('Settings'); await page.getByLabel('Business name', { exact: true }).fill('Client readiness reviewed business');
    await nav('Products'); guard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
    await guard.getByRole('button', { name: 'Keep working', exact: true }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Settings saved', { exact: true }).waitFor();
    await nav('Products'); await page.getByRole('heading', { name: 'Products', exact: true }).waitFor();
    expect(await page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }).count()).toBe(0);
  });
  it('finds a customer beyond the initial result limit and keeps the selected customer while searching', async () => {
    let chosen = '';
    for (let i = 0; i < 501; i++) {
      const customer = await host.engine.execute(token, 'customer.save', { name: i === 500 ? 'ZZ Search Customer' : `Customer ${String(i).padStart(3, '0')}` });
      if (i === 500) chosen = customer.id;
    }
    await nav('New sale'); await page.getByRole('button').filter({ hasText: 'Readiness product' }).click();
    await page.getByText('Customer not listed? Search customers', { exact: true }).click();
    await page.getByLabel('Find a customer', { exact: true }).fill('ZZ Search');
    await page.getByLabel('Customer (optional)', { exact: true }).selectOption({ label: 'ZZ Search Customer' });
    await page.getByLabel('Find a customer', { exact: true }).fill('Customer 001');
    await expect.poll(() => page.getByLabel('Customer (optional)', { exact: true }).inputValue()).toBe(chosen);
    await page.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    const payment = page.getByRole('dialog', { name: 'Take payment', exact: true });
    await payment.getByLabel('Cash received', { exact: true }).fill('12');
    await payment.getByRole('button', { name: /Complete sale/ }).click();
    const done = page.getByRole('dialog', { name: 'Sale completed', exact: true }); await done.waitFor();
    expect(read('SELECT customer_id FROM sales ORDER BY rowid DESC LIMIT 1').customer_id).toBe(chosen);
    await done.getByRole('button', { name: /New sale/ }).click();
  });
  it('paginates and sorts a larger catalogue without changing records', async () => {
    for (let i = 1; i <= 60; i++) await host.engine.execute(token, 'product.save', { name: `Paged product ${String(i).padStart(2, '0')}`, sellingPrice: 100 + i, costPrice: 50 });
    await nav('Products'); await page.getByText('Showing 1–50 of 61 loaded rows', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByText('Showing 51–61 of 61 loaded rows', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Selling price', exact: true }).click();
    expect(await page.getByRole('columnheader', { name: 'Selling price', exact: true }).getAttribute('aria-sort')).toBe('ascending');
    expect(await page.getByRole('row').nth(1).innerText()).toContain('Paged product 01');
    await page.getByRole('button', { name: 'Selling price', exact: true }).click();
    expect(await page.getByRole('row').nth(1).innerText()).toContain('Readiness product');
    expect(read('SELECT COUNT(*) AS n FROM products').n).toBe(61);
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(2);
    await screenshot('05-catalogue-pagination'); expect(errors).toEqual([]);
  });
});
