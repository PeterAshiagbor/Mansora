import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { startDevHost } from '../../apps/desktop/dev/host';
import { serveStatic } from '../../scripts/static';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { mkPlan, subscribe } from '../billing/helpers';
import { tempDir } from '../helpers';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/admin-web/dist/index.html')))('deployment-ready billing interface', () => {
  let cloud: Cloud, app: Awaited<ReturnType<typeof buildApp>>, web: Awaited<ReturnType<typeof serveStatic>>, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, admin: any, shop: any;
  let clientId: string, planId: string;
  const owner = { name: 'Deployment fixture', username: 'owner', password: randomUUID() }, errors: string[] = [];
  const nav = (page: any, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Deployment interface shop'); clientId = client.id;
    host = await startDevHost({ dataDir: tempDir(), port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'UI acceptance', owner });
    planId = await mkPlan(cloud, { name: 'Deployment plan', price: 30000 });
    const sub = await subscribe(cloud, clientId, planId, { paymentMethod: 'manual' });
    expect((await cloud.api('POST', `/v1/admin/billing/invoices/${sub.invoiceId}/payment`, { amount: 30000, method: 'bank', reference: 'SYNTHETIC-UI-ONLY' })).status).toBe(200);
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close(); app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url], billing: cloud.billing });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    browser = await pw.chromium.launch(); admin = await browser.newPage(); shop = await browser.newPage();
    for (const p of [admin, shop]) { p.setDefaultTimeout(10_000); p.on('pageerror', (e: Error) => errors.push(e.message)); }
    await admin.goto(web.url); await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email); await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password); await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await shop.goto(host.url); await shop.getByLabel('Username', { exact: true }).fill(owner.username); await shop.getByLabel('Password', { exact: true }).fill(owner.password); await shop.getByRole('button', { name: 'Sign in', exact: true }).click();
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); }
    if (web) await new Promise<void>(r => web.server.close(() => r()));
    await app?.close(); await cloud?.db.close();
  });
  it('offers retry after payment-settings read failure, rather than loading forever', async () => {
    let refuse = true;
    await admin.route('**/v1/admin/billing/settings', (r: any) => refuse && r.request().method() === 'GET' ? r.fulfill({ status: 503, json: { message: 'Synthetic settings read unavailable' } }) : r.continue());
    await nav(admin, 'Payment settings');
    await admin.getByText('Could not load billing settings.', { exact: true }).waitFor();
    expect(await admin.getByRole('button', { name: 'Save settings', exact: true }).count()).toBe(0);
    refuse = false; await admin.getByRole('button', { name: 'Retry', exact: true }).click();
    await admin.getByLabel('Payment terms (days)', { exact: true }).waitFor();
    expect(await admin.getByLabel('Payment terms (days)', { exact: true }).inputValue()).toBe('14');
    await admin.unroute('**/v1/admin/billing/settings');
  });
  it('rejects blank/fractional settings, protects edits and preserves a failed save for retry', async () => {
    const terms = admin.getByLabel('Payment terms (days)', { exact: true }), save = admin.getByRole('button', { name: 'Save settings', exact: true });
    let writes = 0, refuse = true;
    await admin.route('**/v1/admin/billing/settings', (r: any) => {
      if (r.request().method() === 'PUT') { writes++; if (refuse) return r.fulfill({ status: 503, json: { message: 'Synthetic save refused; retry' } }); }
      return r.continue();
    });
    for (const value of ['', '1.5']) { await terms.fill(value); await save.click(); expect(writes).toBe(0); expect(await terms.evaluate((e: HTMLInputElement) => e.checkValidity())).toBe(false); }
    await terms.fill('21'); await nav(admin, 'Clients');
    const discard = admin.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }); await discard.waitFor(); await discard.getByRole('button', { name: 'Keep working', exact: true }).click();
    await save.click(); await admin.getByText('Synthetic save refused; retry', { exact: true }).waitFor(); expect(await terms.inputValue()).toBe('21');
    refuse = false; await save.click(); await admin.getByText('Settings saved', { exact: true }).waitFor();
    expect((await cloud.api('GET', '/v1/admin/billing/settings')).body.defaultDueDays).toBe(21); expect(writes).toBe(2);
    await admin.unroute('**/v1/admin/billing/settings'); await nav(admin, 'Subscriptions'); await admin.getByRole('heading', { name: 'Subscriptions', exact: true }).waitFor();
    expect(await discard.count()).toBe(0);
  });
  it('does not reinterpret an invalid agreed fee as the plan price, and guards Cancel', async () => {
    await admin.getByRole('button', { name: 'New subscription', exact: true }).click();
    const modal = admin.getByRole('dialog', { name: 'New subscription', exact: true });
    await modal.getByLabel('Client', { exact: true }).selectOption(clientId); await modal.getByLabel('Plan', { exact: true }).selectOption(planId);
    const fee = modal.getByLabel(/Agreed amount/); await fee.fill('10.999');
    let writes = 0; await admin.route('**/v1/admin/billing/subscriptions', (r: any) => { if (r.request().method() === 'POST') writes++; return r.continue(); });
    await modal.getByRole('button', { name: 'Create draft', exact: true }).click();
    expect(writes).toBe(0); expect(await fee.evaluate((e: HTMLInputElement) => e.checkValidity())).toBe(false);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    const discard = admin.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }); await discard.waitFor(); await discard.getByRole('button', { name: 'Keep working', exact: true }).click(); expect(await fee.inputValue()).toBe('10.999');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click(); await discard.getByRole('button', { name: 'Discard changes', exact: true }).click(); await admin.unroute('**/v1/admin/billing/subscriptions');
  });
  it('distinguishes a failed invoice list from an empty list and retries', async () => {
    let refuse = true;
    await admin.route('**/v1/admin/billing/invoices?*', (r: any) => refuse ? r.fulfill({ status: 503, json: { message: 'Synthetic invoice read unavailable' } }) : r.continue());
    await nav(admin, 'Invoices'); await admin.getByText('Synthetic invoice read unavailable', { exact: true }).waitFor();
    expect(await admin.getByText('No invoices yet', { exact: true }).count()).toBe(0);
    refuse = false; await admin.getByRole('button', { name: 'Retry', exact: true }).click(); await admin.getByRole('row').filter({ hasText: 'Deployment interface shop' }).waitFor(); await admin.unroute('**/v1/admin/billing/invoices?*');
  });
  it('keeps a failed client cancellation request open with its reason, then submits once', async () => {
    await nav(shop, 'Billing & payments'); await shop.getByRole('button', { name: 'Ask to cancel my subscription', exact: true }).click();
    const modal = shop.getByRole('dialog', { name: 'Ask to cancel', exact: true }); const reason = modal.getByLabel('Why would you like to cancel?', { exact: true });
    await reason.fill('Synthetic acceptance request'); let refuse = true;
    await shop.route('**/invoke', (r: any) => r.request().postDataJSON()?.command === 'billing.cancellation.request' && refuse ? r.fulfill({ json: { ok: false, error: { message: 'Synthetic cancellation refused; retry' } } }) : r.continue());
    await modal.getByRole('button', { name: 'Send request', exact: true }).click(); await shop.getByText('Synthetic cancellation refused; retry', { exact: true }).waitFor();
    expect(await modal.isVisible()).toBe(true); expect(await reason.inputValue()).toBe('Synthetic acceptance request');
    refuse = false; await modal.getByRole('button', { name: 'Send request', exact: true }).click(); await shop.getByText('You asked to cancel.', { exact: false }).waitFor();
    expect(await modal.count()).toBe(0); await shop.unroute('**/invoke'); expect(errors).toEqual([]);
  });
  it('shows subscription action errors inside the edited dialog and preserves its reason', async () => {
    await nav(admin, 'Subscriptions'); await admin.getByRole('row').filter({ hasText: 'Deployment interface shop' }).click();
    await admin.getByRole('button', { name: 'Pause', exact: true }).click();
    const modal = admin.getByRole('dialog', { name: 'Pause subscription', exact: true });
    const reason = modal.getByLabel('Reason or note (kept in the audit log)', { exact: true }); await reason.fill('Synthetic pause reason');
    await admin.route('**/v1/admin/billing/subscriptions/*/pause', (r: any) => r.fulfill({ status: 503, json: { message: 'Synthetic pause refused' } }));
    await modal.getByRole('button', { name: 'Pause', exact: true }).click(); await modal.getByText('Synthetic pause refused', { exact: true }).waitFor();
    expect(await reason.inputValue()).toBe('Synthetic pause reason');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await admin.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
    await admin.unroute('**/v1/admin/billing/subscriptions/*/pause');
  });
  it('retains a separate settlement-account draft while settings refresh after saving', async () => {
    await nav(admin, 'Payment settings');
    const account = admin.getByLabel('Account name', { exact: true }); await account.fill('Synthetic unsaved account');
    await admin.getByLabel('Payment terms (days)', { exact: true }).fill('22'); await admin.getByRole('button', { name: 'Save settings', exact: true }).click();
    await admin.getByText('Settings saved', { exact: true }).waitFor();
    await expect.poll(() => admin.getByLabel('Payment terms (days)', { exact: true }).inputValue()).toBe('22');
    expect(await account.inputValue()).toBe('Synthetic unsaved account');
    await nav(admin, 'Clients'); await admin.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();
    await admin.getByRole('heading', { name: 'Clients', exact: true }).waitFor();
  });
  it('keeps payment-setup consent open if the secure-page request fails', async () => {
    await shop.getByRole('button', { name: 'Set up automatic payments', exact: true }).click();
    const modal = shop.getByRole('dialog', { name: 'Set up automatic payments', exact: true });
    const agree = modal.getByRole('checkbox', { name: /I agree that Mansora may collect/ }); await agree.check();
    await shop.route('**/invoke', (r: any) => r.request().postDataJSON()?.command === 'billing.mandate.start' ? r.fulfill({ json: { ok: false, error: { message: 'Synthetic secure-page request refused' } } }) : r.continue());
    await modal.getByRole('button', { name: 'Continue to secure page', exact: true }).click(); await shop.getByText('Synthetic secure-page request refused', { exact: true }).waitFor();
    expect(await modal.isVisible()).toBe(true); expect(await agree.isChecked()).toBe(true);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click(); await shop.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();
    await shop.unroute('**/invoke'); expect(errors).toEqual([]);
  });

  it('keeps report date controls available during a failed read and recovers', async () => {
    let refuse = true;
    await admin.route('**/v1/admin/billing/reports/summary?*', (r: any) => refuse ? r.fulfill({ status: 503, json: { message: 'Synthetic revenue read unavailable' } }) : r.continue());
    await nav(admin, 'Revenue reports'); await admin.getByText('Synthetic revenue read unavailable', { exact: true }).waitFor();
    expect(await admin.getByLabel('From', { exact: true }).isVisible()).toBe(true); expect(await admin.getByLabel('To', { exact: true }).isVisible()).toBe(true);
    expect(await admin.getByRole('button', { name: 'Export invoices', exact: true }).isDisabled()).toBe(true);
    refuse = false; await admin.getByRole('button', { name: 'Retry', exact: true }).click(); await admin.getByText('Monthly recurring revenue', { exact: true }).waitFor();
    await admin.unroute('**/v1/admin/billing/reports/summary?*');
  });
  it('explains blocked document popups and opens the real printable invoice on retry', async () => {
    await nav(admin, 'Invoices'); await admin.getByRole('row').filter({ hasText: 'Deployment interface shop' }).click();
    const invoice = admin.getByRole('dialog', { name: 'Invoice', exact: true });
    await admin.evaluate(() => { (window as any).__originalOpen = window.open; window.open = (() => null) as any; });
    await invoice.getByRole('button', { name: 'Open printable invoice', exact: true }).click(); await invoice.getByText('Allow pop-ups for Mansora, then open the printable document again.', { exact: true }).waitFor();
    await admin.evaluate(() => { window.open = (window as any).__originalOpen; delete (window as any).__originalOpen; });
    const [popup] = await Promise.all([admin.waitForEvent('popup'), invoice.getByRole('button', { name: 'Open printable invoice', exact: true }).click()]);
    await popup.getByText('Deployment interface shop', { exact: false }).first().waitFor(); expect(await popup.evaluate(() => window.opener === null)).toBe(true); await popup.close();
    await invoice.getByRole('button', { name: 'Close', exact: true }).last().click(); expect(errors).toEqual([]);
  });

});
