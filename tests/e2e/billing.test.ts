import { navigate } from './navigation';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { serveStatic } from '../../scripts/static';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { GHS, mkClient, mkPlan, subscribe } from '../billing/helpers';

const require = createRequire(import.meta.url);
let pw: any;
try { pw = require('playwright'); } catch { /* available in CI or via NODE_PATH */ }
const dist = join(import.meta.dirname, '../../apps/admin-web/dist');

describe.skipIf(!pw || !existsSync(join(dist, 'index.html')))('administrator billing screens', () => {
  let cloud: Cloud, browser: any, page: any, app: Awaited<ReturnType<typeof buildApp>>;
  let web: Awaited<ReturnType<typeof serveStatic>>;
  const errors: string[] = [];
  beforeAll(async () => {
    cloud = await startCloud();
    web = await serveStatic(dist, 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    const client = await mkClient(cloud, 'Browser Billing Shop');
    const plan = await mkPlan(cloud, { name: 'Gold plan', price: GHS(400) });
    await subscribe(cloud, client.id, plan);
    await cloud.app.close();
    app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url], billing: cloud.billing });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    browser = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(20_000);
    page.on('pageerror', (error: Error) => errors.push(error.message));
  });
  afterAll(async () => {
    await browser?.close();
    await app?.close();
    if (web) await new Promise<void>((resolve) => web.server.close(() => resolve()));
    await cloud?.db.close();
  });
  const nav = (name: string) => navigate(page, name);

  it('shows who owes what, records a payment against the invoice and reports it as revenue', async () => {
    await page.goto(web.url);
    await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await nav('Collections');
    const row = page.getByRole('row', { name: /Browser Billing Shop/ });
    await row.waitFor();
    await expect(row.innerText()).resolves.toContain('400.00');

    await nav('Invoices');
    await page.getByRole('row', { name: /Browser Billing Shop/ }).click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByLabel('Amount received (GH₵)').fill('400');
    await page.getByLabel('Reference (transaction ID)').fill('MM-BROWSER-1');
    await page.getByRole('button', { name: 'Record payment', exact: true }).last().click();
    await page.getByRole('dialog').getByText('paid', { exact: true }).first().waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();

    await nav('Payments');
    await page.getByRole('row', { name: /Browser Billing Shop/ }).waitFor();

    await nav('Revenue reports');
    await expect(page.getByText('Collected this month').locator('..').innerText()).resolves.toContain('400.00');
  });

  it('shows the provider blockers honestly instead of pretending to be connected', async () => {
    await nav('Payment settings');
    const hubtel = page.getByRole('row', { name: /Hubtel/ });
    await hubtel.waitFor();
    await expect(hubtel.innerText()).resolves.toMatch(/blocked/i);
    expect(errors).toEqual([]);
  });
});
