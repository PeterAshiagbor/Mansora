import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { toXlsx } from '../../apps/desktop/src/core/importer';
import { startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const built = existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html'));
// The main CI browser job installs Chromium and builds the renderer; core-only jobs do neither.
describe.skipIf(!pw || !built)('retail pricing through Chromium and the real engine', () => {
let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
const dir = tempDir('mansora-retail-browser-');
const owner = { name: 'Test owner', username: 'owner', password: randomUUID() };
const cashier = { name: 'Test cashier', username: 'cashier', password: randomUUID() };
beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Retail browser fixture');
  host = await startDevHost({ dataDir: dir, port: 0, dbKey: randomUUID() });
  await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Browser fixture', owner });
  const token = (await host.engine.execute(null, 'auth.login', owner)).token;
  await host.engine.execute(token, 'staff.save', { ...cashier, role: 'cashier' });
  const cashierToken = (await host.engine.execute(null, 'auth.login', cashier)).token;
  await host.engine.execute(cashierToken, 'shift.open', { openingFloat: 0 });
  browser = await pw.chromium.launch();
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(10_000);
  await page.goto(host.url);
});
afterAll(async () => {
  await browser?.close();
  if (host) { await new Promise<void>((resolve) => host.server.close(() => resolve())); host.engine.db.close(); }
  await cloud?.close();
  rmSync(dir, { recursive: true, force: true });
});
const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
const signIn = async (who: typeof owner) => {
  await page.getByLabel('Username', { exact: true }).fill(who.username);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Lock / sign out' }).waitFor();
};
it('calculates carton costs, shows margin, uploads Excel and restricts cashier discounts', async () => {
  await signIn(owner);
  await nav('Products');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Product name').fill('Carton calculator item');
  await form.getByLabel('Selling price (GHS)', { exact: true }).fill('6.00');
  await form.getByLabel('Carton purchase cost (GHS)', { exact: true }).fill('100.00');
  await form.getByLabel('Selling units per carton').fill('24');
  await form.getByText('Unit cost: GHS 4.17', { exact: true }).waitFor();
  await form.getByRole('button', { name: 'Use calculated unit cost' }).click();
  await form.getByText(/Gross margin: 30.50%/).waitFor();
  await expect.poll(() => form.getByLabel('Cost price (GHS)', { exact: true }).inputValue()).toBe('4.17');
  await form.getByLabel('Opening stock').fill('24');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'Carton calculator item' }).getByRole('cell', { name: '30.50%', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Upload Excel / CSV' }).click();
  await page.getByRole('heading', { name: 'Import & export', exact: true }).waitFor();
  const workbook = await toXlsx([{ name: 'Products', rows: [['Name', 'Carton cost', 'Units per carton', 'Selling price'], ['Excel carton item', '120', '24', '8']] }]);
  await page.getByLabel('Choose import file').setInputFiles({ name: 'pricing.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook });
  await page.getByRole('row').filter({ hasText: 'Excel carton item' }).getByRole('cell', { name: '37.50%', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Import 1 product(s)', exact: true }).click();
  await page.getByText('Imported 1 product(s)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Lock / sign out' }).click();
  await signIn(cashier);
  await nav('Products');
  expect(await page.getByRole('columnheader', { name: 'Gross margin', exact: true }).count()).toBe(0);
  expect(await page.getByRole('columnheader', { name: 'Cost', exact: true }).count()).toBe(0);
  await nav('New sale');
  expect(await page.getByLabel('Basket discount', { exact: true }).count()).toBe(0);
  await page.getByRole('button', { name: 'Request discount', exact: true }).click();
  await page.getByText('Discount requests need an authorised approver at payment.', { exact: false }).waitFor();
  await page.getByLabel('Basket discount', { exact: true }).fill('1.00');
  await page.getByRole('button').filter({ hasText: 'Carton calculator item' }).click();
  await page.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Exact', exact: true }).click();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await page.getByLabel('Manager username').waitFor();
  expect((host.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n).toBe(0);
  await page.getByLabel('Manager username').fill(owner.username);
  await page.getByLabel('Manager password').fill(owner.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sale completed', exact: true }).waitFor();
  expect((host.engine.db.prepare('SELECT total, discount_total FROM sales').get() as any)).toMatchObject({ total: 500, discount_total: 100 });
}, 60_000);

});
