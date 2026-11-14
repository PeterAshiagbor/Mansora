import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { OWNER, tempDir } from '../helpers';
import { startDevHost } from '../../apps/desktop/dev/host';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();

describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html')))('choosing or adding a customer on New sale (owner request 2026-11-14)', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any, token: string;
  const read = (sql: string) => host.engine.db.prepare(sql).get() as any;
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Customer at sale shop');
    host = await startDevHost({ dataDir: tempDir(), port: 0 });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Till', owner: OWNER });
    token = (await host.engine.execute(null, 'auth.login', OWNER)).token;
    await host.engine.execute(token, 'product.save', { name: 'Gari 1kg', sellingPrice: 2000, costPrice: 1200, openingStock: 30 });
    await host.engine.execute(token, 'customer.save', { name: 'Ama Mensah', phone: '0241112222' });
    await host.engine.execute(token, 'shift.open', { openingFloat: 0 });
    browser = await pw.chromium.launch(); page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(10_000);
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(OWNER.username); await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(page, 'New sale');
  });
  afterAll(async () => { await browser?.close(); if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); } await cloud?.close(); });

  it('shows matches as you type, refuses a phone already on file, adds a new customer and sells to them on credit', async () => {
    await page.getByRole('button').filter({ hasText: 'Gari 1kg' }).click();
    const box = page.getByRole('combobox', { name: 'Customer', exact: true });
    await box.fill('024 111');
    await page.getByRole('option', { name: /Ama Mensah/ }).waitFor();
    await box.fill('Kwesi Appiah');
    await page.getByRole('option', { name: '+ Add "Kwesi Appiah" as a new customer', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a new customer', exact: true });
    expect(await dialog.getByLabel('Name', { exact: true }).inputValue()).toBe('Kwesi Appiah');
    // The same phone as Ama Mensah, written differently: refused, with the option to use Ama instead.
    await dialog.getByLabel('Phone (optional)', { exact: true }).fill('+233 24 111 2222');
    await dialog.getByRole('button', { name: 'Save and use for this sale', exact: true }).click();
    await dialog.getByRole('button', { name: 'Use Ama Mensah', exact: true }).waitFor();
    await dialog.getByLabel('Phone (optional)', { exact: true }).fill('0209998888');
    await dialog.getByRole('button', { name: 'Save and use for this sale', exact: true }).click();
    await page.getByRole('button', { name: 'Remove customer Kwesi Appiah', exact: true }).waitFor();
    expect(read(`SELECT name, phone FROM customers WHERE name = 'Kwesi Appiah'`)).toEqual({ name: 'Kwesi Appiah', phone: '0209998888' });

    await page.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    await page.getByRole('button', { name: 'Credit', exact: true }).click();
    await page.getByLabel('Credit amount', { exact: true }).fill('20');
    await page.getByRole('button', { name: /Complete sale/ }).click();
    await page.getByRole('dialog', { name: 'Sale completed', exact: true }).waitFor();
    expect(read(`SELECT c.name, a.outstanding_balance FROM credit_accounts a JOIN customers c ON c.id = a.customer_id`)).toEqual({ name: 'Kwesi Appiah', outstanding_balance: 2000 });
  });
});
