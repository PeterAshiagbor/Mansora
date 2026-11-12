import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { toXlsx } from '../../apps/desktop/src/core/importer';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadWorkspaces, type StagingConfig } from '../../scripts/staging/config';
import { startStagingGateway, type StagingWorkspace } from '../../scripts/staging/gateway';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/admin-web/dist/index.html')))('team staging through real independent browsers', () => {
  let cloud: Cloud, api: Awaited<ReturnType<typeof buildApp>>, config: StagingConfig, workspaces: StagingWorkspace[], gateway: Awaited<ReturnType<typeof startStagingGateway>>, accounts: TestAccount[], browser: any, owner: any, cashier: any, admin: any;
  const errors: string[] = [];
  beforeAll(async () => {
    cloud = await startCloud(); config = { origin: 'http://127.0.0.1:0', apiUrl: cloud.url, dataDir: tempDir(), key: randomBytes(32).toString('hex'), clientDir: join(root, 'apps/desktop/dist/renderer'), adminDir: join(root, 'apps/admin-web/dist') };
    await provisionStaging(config, ADMIN); accounts = JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')); workspaces = loadWorkspaces(config); gateway = await startStagingGateway({ ...config, workspaces, port: 0 });
    cloud.billing.env.publicBaseUrl = gateway.publicOrigin + '/api'; cloud.sandbox.baseUrl = gateway.publicOrigin + '/api';
    await cloud.app.close(); api = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [gateway.publicOrigin], billing: cloud.billing }); await api.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    browser = await pw.chromium.launch();
    for (const role of ['owner', 'cashier']) {
      const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage(); page.setDefaultTimeout(10_000); page.on('pageerror', (e: Error) => errors.push(e.message));
      const account = accounts.find(a => a.workspace === 'shop-a' && a.role === role)!;
      await page.goto(gateway.url + '/client/shop-a/#email=invited%40example.test');
      expect(await page.getByLabel('Username', { exact: true }).inputValue()).toBe('invited@example.test');
      await page.getByText('Use your invitation email or staff username.', { exact: true }).waitFor();
      await page.getByLabel('Username', { exact: true }).fill(account.username);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      expect(await page.getByLabel('Password', { exact: true }).getAttribute('type')).toBe('text');
      await page.getByRole('button', { name: 'Hide password', exact: true }).click();
      expect(await page.getByLabel('Password', { exact: true }).getAttribute('type')).toBe('password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      if (role === 'owner') owner = page; else cashier = page;
    }
    admin = await (await browser.newContext()).newPage(); admin.setDefaultTimeout(10_000); admin.on('pageerror', (e: Error) => errors.push(e.message));
  });
  afterAll(async () => { await browser?.close(); await gateway?.close(); for (const w of workspaces ?? []) w.engine.db.close(); await api?.close(); await cloud?.db.close(); });
  it('keeps owner and cashier independent while they save and sell shared records', async () => {
    expect((await owner.evaluate(() => (window as any).mansora.invoke('app.state'))).data.user.role).toBe('owner');
    expect((await cashier.evaluate(() => (window as any).mansora.invoke('app.state'))).data.user.role).toBe('cashier');
    expect(await owner.evaluate(() => Object.keys((window as any).mansora))).toEqual(['invoke']); expect(await owner.evaluate(() => document.cookie.includes('mansora-stage'))).toBe(false);
    await navigate(owner, 'Products'); await owner.getByRole('button', { name: 'Add product', exact: true }).click(); const form = owner.getByRole('dialog', { name: 'Add product', exact: true });
    await form.getByLabel('Product name', { exact: true }).fill('Team browser item'); await form.getByLabel('Selling price (GHS)', { exact: true }).fill('2'); await form.getByLabel('Cost price (GHS)', { exact: true }).fill('1'); await form.getByLabel('Opening stock', { exact: true }).fill('5'); await form.getByRole('button', { name: 'Save', exact: true }).click(); await owner.getByRole('cell', { name: 'Team browser item', exact: true }).waitFor();
    await navigate(cashier, 'New sale'); await cashier.getByLabel('Opening cash float (GHS)', { exact: true }).fill('0'); await cashier.getByRole('button', { name: 'Open shift', exact: true }).click();
    await cashier.getByLabel('Search or scan product', { exact: true }).fill('Team browser item'); await cashier.getByRole('button').filter({ hasText: 'Team browser item' }).click(); await cashier.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    const payment = cashier.getByRole('dialog', { name: 'Take payment', exact: true }); await payment.getByLabel('Cash received', { exact: true }).fill('2'); await payment.getByRole('button', { name: 'Complete sale (Enter)', exact: true }).click(); await cashier.getByTestId('receipt-no').waitFor();
    await navigate(owner, 'Sales history'); await owner.getByRole('cell', { name: 'Test cashier', exact: true }).waitFor();
    expect((await owner.evaluate(() => (window as any).mansora.invoke('app.state'))).data.user.role).toBe('owner');
    const records = await owner.evaluate(() => (window as any).mansora.invoke('product.list', { search: 'Team browser item' })); expect(records.data[0].quantity).toBe(4);
  });
  it('uploads Excel and previews actual rows through the authenticated gateway', async () => {
    await navigate(owner, 'Import & export');
    const bytes = await toXlsx([{ name: 'Products', rows: [['Name', 'Cost price', 'Selling price', 'Opening stock'], ['Team Excel item', '3', '4', '12']] }]);
    await owner.getByLabel('Choose import file', { exact: true }).setInputFiles({ name: 'team-test.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
    await owner.getByText('Team Excel item', { exact: true }).waitFor();
    expect(workspaces[0].engine.db.prepare("SELECT COUNT(*) AS n FROM products WHERE name = 'Team Excel item'").get()).toMatchObject({ n: 0 });
  });
  it('serves the actual platform dashboard through the same-origin API proxy', async () => {
    await admin.goto(gateway.url + '/admin/'); await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password); await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(admin, 'Clients'); await admin.getByRole('row').filter({ hasText: 'Team Test Shop A' }).waitFor(); await admin.getByRole('row').filter({ hasText: 'Team Test Shop B' }).waitFor(); expect(errors).toEqual([]);
  });
  it('completes a sandbox checkout through proxied forms and redirects', async () => {
    const summary = await owner.evaluate(() => (window as any).mansora.invoke('billing.summary'));
    expect(summary.ok).toBe(true); expect(summary.data.nextPayment.amount).toBe(30000);
    const checkout = await owner.evaluate((invoiceId: string) => (window as any).mansora.invoke('billing.pay', { invoiceId }), summary.data.nextPayment.invoiceId);
    expect(checkout.ok).toBe(true); expect(checkout.data.url.startsWith(gateway.publicOrigin + '/api/sandbox/checkout/')).toBe(true);
    const payment = await (await browser.newContext()).newPage();
    await payment.goto(checkout.data.url); const approved = payment.waitForResponse((r: any) => r.request().method() === 'POST'); await payment.getByRole('button', { name: 'Approve', exact: true }).click(); expect((await approved).status()).toBe(303);
    await payment.getByRole('heading', { name: 'Thank you', exact: true }).waitFor(); expect(new URL(payment.url()).pathname).toBe('/api/pay/done');
    const paid = await owner.evaluate(() => (window as any).mansora.invoke('billing.summary')); expect(paid.data.invoices.find((i: any) => i.id === summary.data.nextPayment.invoiceId).status).toBe('paid');
    await payment.close();
  });

});
