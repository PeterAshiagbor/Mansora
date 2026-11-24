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
import { rehearsePublicSignIn } from '../../scripts/staging/sign-in-acceptance';
import { hashPassword } from '../../apps/desktop/src/core/passwords';
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
      // An invitation link opens the one sign-in page with the email filled in.
      await page.goto(gateway.url + '/signin/#email=invited%40example.test');
      expect(await page.getByLabel('Username or email', { exact: true }).inputValue()).toBe('invited@example.test');
      expect(new URL(page.url()).hash).toBe('');
      await page.getByLabel('Username or email', { exact: true }).fill(account.username + '@shop-a');
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
  it('opens branded sign-in without a public shop directory and routes an authenticated manager to their own shop', async () => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.setDefaultTimeout(10_000); page.on('pageerror', (error: Error) => errors.push(error.message));
    try {
      await page.goto(gateway.url + '/'); await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe('/signin/');
      expect(await page.locator('body').innerText()).not.toMatch(/TEAM TEST|Mansora TSA|Mansora TSB/);
      expect(await page.locator('a[href^="/client/"]').count()).toBe(0);
      expect(await page.locator('body').evaluate((body: HTMLElement) => body.scrollWidth <= innerWidth)).toBe(true);
      const manager = accounts.find(account => account.workspace === 'shop-b' && account.role === 'manager')!;
      await page.getByLabel('Username or email', { exact: true }).fill(manager.username + '@shop-b');
      await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Incorrect username or password' }).waitFor();
      expect(new URL(page.url()).pathname).toBe('/signin/');
      await page.getByLabel('Password', { exact: true }).fill(manager.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe('/app/');
      const state = await page.evaluate(() => (window as any).mansora.invoke('app.state'));
      expect(state.data.user.role).toBe('manager'); expect(state.data.business.name).toBe('Mansora TSB');
    } finally { await page.context().close(); }
  });
  it('has one sign-in form for every account and never shows a second one after sign-out, back or an old address', async () => {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    page.setDefaultTimeout(10_000); page.on('pageerror', (error: Error) => errors.push(error.message));
    const path = () => new URL(page.url()).pathname;
    const signIn = async (username: string, password: string) => {
      await page.getByLabel('Username or email', { exact: true }).fill(username); await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    };
    try {
      await page.goto(gateway.url + '/'); await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
      expect(await page.locator('select').count()).toBe(0); expect(await page.locator('body').innerText()).not.toMatch(/Account type|Business workspace|Mansora administration/);
      // "cashier" exists in both shops; the password alone finds the right one. The address never names the shop.
      const cashierB = accounts.find(account => account.workspace === 'shop-b' && account.role === 'cashier')!;
      await signIn('cashier', cashierB.password); await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      expect(path()).toBe('/app/'); expect((await page.evaluate(() => (window as any).mansora.invoke('app.state'))).data.business.tenantId).toBe(workspaces.find(w => w.id === 'shop-b')!.engine.meta('tenant_id'));
      await page.goto(gateway.url + '/client/shop-a/'); await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor(); expect(path()).toBe('/app/');
      expect((await page.evaluate(() => (window as any).mansora.invoke('app.state'))).data.user.role).toBe('cashier');
      await page.getByRole('button', { name: 'Lock / sign out', exact: true }).click(); await page.waitForURL('**/signin/');
      await page.goBack().catch(() => {}); await page.waitForTimeout(300);
      expect(['/signin/', '/', 'blank']).toContain(page.url() === 'about:blank' ? 'blank' : path());
      for (const address of ['/app/', '/client/shop-b/', '/admin/']) {
        await page.goto(gateway.url + address); await page.waitForURL('**/signin/');
        expect(await page.getByLabel('Username', { exact: true }).count()).toBe(0); // no shop- or console-specific form
      }
      // Administrators use the same form, and leave through it too.
      await signIn(ADMIN.email, ADMIN.password); await page.waitForURL('**/admin/'); await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL('**/signin/');
      await page.goto(gateway.url + '/admin/'); await page.waitForURL('**/signin/');
      // An emailed administrator invitation is still accepted in the console before the one sign-in page takes over.
      const mails: any[] = []; cloud.billing.email = { configured: () => true, send: async (message: any) => { mails.push(message); return { id: 'm' + mails.length }; } } as any;
      expect((await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Hosted Colleague', email: 'hosted.colleague@example.test' })).status).toBe(200);
      const token = /#admin-invite=([A-Za-z0-9_-]{43})/.exec(mails.at(-1).body)![1];
      await page.goto(gateway.url + '/admin/#admin-invite=' + token);
      await page.getByLabel('New password', { exact: true }).fill('hosted-colleague-pass'); await page.getByLabel('Repeat password', { exact: true }).fill('hosted-colleague-pass');
      await page.getByRole('button', { name: 'Create my account', exact: true }).click(); await page.waitForURL('**/signin/');
      expect(await page.getByLabel('Username or email', { exact: true }).inputValue()).toBe('hosted.colleague@example.test');
      await page.getByLabel('Password', { exact: true }).fill('hosted-colleague-pass'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL('**/admin/'); await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });
  it('rehearses all six existing synthetic identities through the public sign-in without financial writes or email', async () => {
    const before = workspaces.map(workspace => workspace.engine.db.prepare('SELECT COUNT(*) AS count FROM sales').get());
    expect(await rehearsePublicSignIn({ version: 'signin-v1', origin: gateway.publicOrigin, dataDir: config.dataDir, workspaces })).toMatchObject({ passed: true, failures: [], skippedPasswordChangedByUser: [], accountsChecked: 6, authenticatedRouting: 'passed', crossShopIsolation: 'passed', financialWrites: 0, emailsSent: 0 });
    expect(workspaces.map(workspace => workspace.engine.db.prepare('SELECT COUNT(*) AS count FROM sales').get())).toEqual(before);
    // A tester who chose their own password is reported as such, not as a sign-in fault, and costs them no failed attempt.
    const shopB = workspaces.find(w => w.id === 'shop-b')!.engine.db, manager = accounts.find(a => a.workspace === 'shop-b' && a.role === 'manager')!;
    const original = shopB.prepare('SELECT password_hash, failed_attempts FROM users WHERE username = ?').get(manager.username) as { password_hash: string; failed_attempts: number };
    shopB.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword('a-password-the-tester-chose'), manager.username);
    try {
      expect(await rehearsePublicSignIn({ version: 'signin-v1', origin: gateway.publicOrigin, dataDir: config.dataDir, workspaces })).toMatchObject({ passed: true, accountsChecked: 5, failures: [], skippedPasswordChangedByUser: [{ workspace: 'shop-b', role: 'manager' }] });
      expect((shopB.prepare('SELECT failed_attempts FROM users WHERE username = ?').get(manager.username) as any).failed_attempts).toBe(original.failed_attempts);
    } finally { shopB.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(original.password_hash, manager.username); }
    // Without the private list, the rehearsal says so instead of failing silently.
    expect(await rehearsePublicSignIn({ version: 'signin-v1', origin: gateway.publicOrigin, dataDir: tempDir(), workspaces })).toMatchObject({ passed: false, accountsChecked: 0, setup: 'no private test-account list on this deployment' });
    // A disabled assigned account is a failure, never mistaken for a changed password.
    shopB.prepare("UPDATE users SET status = 'disabled' WHERE username = ?").run(manager.username);
    try {
      expect(await rehearsePublicSignIn({ version: 'signin-v1', origin: gateway.publicOrigin, dataDir: config.dataDir, workspaces })).toMatchObject({ passed: false, accountsChecked: 5, skippedPasswordChangedByUser: [], failures: [{ workspace: 'shop-b', role: 'manager', step: 'account-disabled' }] });
    } finally { shopB.prepare("UPDATE users SET status = 'active' WHERE username = ?").run(manager.username); }
  });
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
    await admin.goto(gateway.url + '/'); await admin.getByLabel('Username or email', { exact: true }).fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password); await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(admin, 'Clients'); await admin.getByRole('row').filter({ hasText: 'Mansora TSA' }).waitFor(); await admin.getByRole('row').filter({ hasText: 'Mansora TSB' }).waitFor(); expect(errors).toEqual([]);
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
