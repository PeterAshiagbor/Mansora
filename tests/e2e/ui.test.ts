/**
 * End-to-end test through the real user interface (Chromium), the real local
 * engine and the real API: onboarding a client, activating a laptop, a full
 * cashier workflow by barcode, an approved refund, owner reporting, consent
 * and the admin's view. Needs `npm run build` and Playwright; skipped otherwise.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { serveStatic } from '../../scripts/static';
import { ADMIN, count, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const root = join(import.meta.dirname, '..', '..');
function loadPlaywright(): any {
  const require = createRequire(import.meta.url);
  for (const from of ['playwright', (() => { try { return join(execSync('npm root -g').toString().trim(), 'playwright'); } catch { return ''; } })()]) {
    try {
      if (from) return require(from);
    } catch { /* try next */ }
  }
  return null;
}
const pw = loadPlaywright();
const built = existsSync(join(root, 'apps/desktop/dist/renderer/index.html')) && existsSync(join(root, 'apps/admin-web/dist/index.html'));

describe.skipIf(!pw || !built)('end to end through the user interface', () => {
  let cloud: Cloud, browser: any, shop: any, admin: any, shopUrl: string, adminUrl: string;
  const closers: (() => unknown)[] = [];
  const errors: string[] = [];

  beforeAll(async () => {
    cloud = await startCloud();
    const host = await startDevHost({ dataDir: tempDir('mansora-e2e-'), port: 0 });
    shopUrl = host.url;
    const web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    adminUrl = web.url;
    await cloud.app.close(); // restart the API with CORS for the dashboard origin
    const { buildApp } = await import('../../apps/api/src/app');
    const app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [adminUrl] });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    closers.push(() => app.close(), () => host.server.close(), () => web.server.close(), () => host.engine.db.close());
    browser = await pw.chromium.launch();
    const page = async () => {
      const p = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      p.setDefaultTimeout(30_000);
      p.on('pageerror', (e: Error) => errors.push(e.message));
      return p;
    };
    shop = await page();
    admin = await page();
  });
  afterAll(async () => {
    await browser?.close();
    for (const c of closers) await c();
    await cloud?.db.close();
  });

  const signIn = async (username: string, password: string) => {
    // Activation also has username/password fields; wait for the login screen before filling.
    await shop.getByText('Sign in with your staff username and password. This works without internet.', { exact: true }).waitFor();
    await shop.getByLabel('Username').fill(username);
    await shop.getByLabel('Password', { exact: true }).fill(password);
    await shop.getByRole('button', { name: 'Sign in' }).click();
  };
  const nav = (name: string) => shop.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  let code = '';

  it('Mansora creates a client and an activation code in the dashboard', async () => {
    await admin.goto(adminUrl);
    await admin.getByLabel('Email').fill(ADMIN.email);
    await admin.getByLabel('Password').fill(ADMIN.password);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await admin.getByRole('button', { name: 'Clients' }).click();
    await admin.getByRole('button', { name: 'Add client' }).click();
    await admin.getByLabel('Business name').fill('Adwoa Provisions');
    await admin.getByLabel('Primary owner').fill('Adwoa Asante');
    await admin.getByRole('button', { name: 'Create client' }).click();
    await admin.getByRole('button', { name: 'Create activation code' }).click();
    code = await admin.getByTestId('activation-code').innerText();
    expect(code).toMatch(/^MNS-/);
    await admin.getByRole('button', { name: 'Done' }).click();
    // No consent yet: the dashboard cannot show this client's sales.
    await admin.getByRole('button', { name: 'View sales summary' }).click();
    await admin.getByText('has not granted access').waitFor();
  });

  it('the owner activates the laptop, adds a product and staff', async () => {
    await shop.goto(shopUrl);
    await shop.getByLabel('Mansora server address').fill(cloud.url);
    await shop.getByLabel('Activation code').fill(code);
    await shop.getByLabel("Owner's full name").fill('Adwoa Asante');
    await shop.getByLabel('Username').fill('adwoa');
    await shop.getByLabel(/^Password/).fill('owner-pass-9');
    await shop.getByLabel('Repeat password').fill('owner-pass-9');
    await shop.getByRole('button', { name: 'Activate' }).click();
    await signIn('adwoa', 'owner-pass-9');
    await nav('Products');
    for (const [name, barcode, cost, price, stock] of [['Milo 400g', '6001068000012', '38.50', '45', '20'], ['Ideal Milk', '6001068000029', '6.50', '8', '50']]) {
      await shop.getByRole('button', { name: 'Add product' }).click();
      await shop.getByLabel('Product name').fill(name);
      await shop.getByLabel('Barcode').fill(barcode);
      await shop.getByLabel('Selling price (GHS)').fill(price);
      await shop.getByLabel('Cost price (GHS)').fill(cost);
      await shop.getByLabel('Opening stock').fill(stock);
      await shop.getByRole('button', { name: 'Save' }).click();
      await shop.getByRole('cell', { name }).waitFor();
    }
    await nav('Staff');
    await shop.getByRole('button', { name: 'Add staff member' }).click();
    await shop.getByLabel('Full name').fill('Kojo Cashier');
    await shop.getByLabel('Username').fill('kojo');
    await shop.getByLabel(/^Password/).fill('cashier-pass-9');
    await shop.getByRole('button', { name: 'Save' }).click();
    await shop.getByRole('cell', { name: 'Kojo Cashier' }).waitFor();
    await shop.getByRole('button', { name: 'Lock / sign out' }).click();
  });

  it('TEST 01/02 - a cashier completes a sale by barcode scan with keyboard only', async () => {
    await signIn('kojo', 'cashier-pass-9');
    const items = await shop.getByRole('navigation').getByRole('button').allInnerTexts();
    for (const hidden of ['Reports', 'Staff', 'Audit history', 'Stock', 'Import & export', 'Backup & recovery']) expect(items).not.toContain(hidden);
    await nav('New sale');
    await shop.getByLabel('Opening cash float (GHS)').fill('100');
    await shop.getByRole('button', { name: 'Open shift' }).click();
    const search = shop.getByLabel('Search or scan product');
    // A USB scanner types the digits very quickly and presses Enter. Three scans back to back, one a repeat.
    for (const scan of ['6001068000012', '6001068000029', '6001068000029']) {
      await search.pressSequentially(scan, { delay: 1 });
      await search.press('Enter');
    }
    await shop.getByText('3 item(s)').waitFor();
    expect(await shop.getByTestId('basket-total').innerText()).toBe('GHS 61.00');
    await shop.keyboard.press('F9');
    await shop.getByLabel('Cash received').fill('100');
    expect(await shop.getByTestId('change').innerText()).toBe('GHS 39.00');
    await shop.keyboard.press('Enter');
    expect(await shop.getByTestId('receipt-no').innerText()).toBe('R-000001');
    await shop.keyboard.press('Enter'); // new sale
    await shop.getByText('Scan or choose a product').waitFor();
    await shop.getByText('19 left').waitFor(); // stock on screen went down
  });

  it('TEST 06 - a refund needs a manager\'s approval at the till', async () => {
    await nav('Sales history');
    await shop.getByText('R-000001').click();
    await shop.getByRole('button', { name: 'Refund…' }).click();
    await shop.getByLabel('Refund quantity for Ideal Milk').fill('1');
    await shop.getByLabel('Reason for refund').fill('Dented tin');
    await shop.getByRole('button', { name: 'Refund GHS 8.00' }).click();
    await shop.getByLabel('Manager username').fill('adwoa');
    await shop.getByLabel('Manager password').fill('owner-pass-9');
    await shop.getByRole('button', { name: 'Approve' }).click();
    await shop.getByText('RF-000001').waitFor();
    await shop.keyboard.press('Escape');
    await nav('Cashier shifts');
    await shop.getByText('Cash expected in till').waitFor();
    await shop.getByText('GHS 153.00').first().waitFor(); // 100 float + 61 sale - 8 refund
    await shop.getByRole('button', { name: 'Lock / sign out' }).click();
  });

  it('the owner sees reports, grants access, and everything syncs', async () => {
    await signIn('adwoa', 'owner-pass-9');
    await shop.getByText('Sales today').waitFor();
    await nav('Reports');
    await shop.getByText('GHS 53.00').first().waitFor(); // net sales
    await shop.getByRole('tab', { name: 'Gross profit' }).click();
    await shop.getByText('GHS 8.00').first().waitFor(); // 53.00 - (38.50 + 6.50) cost
    await nav('Mansora access');
    await shop.getByLabel('Why is access needed?').fill('Review first week');
    await shop.getByRole('button', { name: 'Grant access' }).click();
    await nav('Sync status');
    await shop.getByRole('button', { name: 'Sync now' }).click();
    await shop.getByText('Everything is synced').waitFor();
    const tenant = (await cloud.api('GET', '/v1/admin/clients')).body.find((c: any) => c.name === 'Adwoa Provisions');
    expect(await count(cloud.db, tenant.id, 'sales')).toBe(1);
    expect(await count(cloud.db, tenant.id, 'refunds')).toBe(1);
  });

  it('TEST 14 - with consent, the admin sees the summary and the view is logged', async () => {
    await admin.reload();
    await admin.getByRole('button', { name: 'Clients' }).click();
    await admin.getByText('Adwoa Provisions').click();
    await admin.getByText('The owner has allowed report access').waitFor();
    await admin.getByRole('button', { name: 'View sales summary' }).click();
    await admin.getByText('GHS 53.00').waitFor();
    await admin.getByRole('button', { name: 'Audit log' }).click();
    await admin.getByText('support.report_viewed').first().waitFor();
    await admin.getByText('support.access_denied').first().waitFor();
    expect(errors).toEqual([]);
  });
});
