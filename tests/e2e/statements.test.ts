import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { OWNER, tempDir } from '../helpers';
import { startDevHost } from '../../apps/desktop/dev/host';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html')))('Bank & MoMo statements through the real interface', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
  const dir = tempDir();
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Statement UI shop');
    host = await startDevHost({ dataDir: tempDir(), port: 0 });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Statements', owner: OWNER });
    const token = (await host.engine.execute(null, 'auth.login', OWNER)).token;
    const product = await host.engine.execute(token, 'product.save', { name: 'Soap', sellingPrice: 2500, costPrice: 1500, openingStock: 10 });
    await host.engine.execute(token, 'shift.open', { openingFloat: 0 });
    await host.engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId: product.id, quantity: 1 }], tenders: [{ method: 'momo', amount: 2500, reference: 'MP-555' }] });
    const d = new Date().toISOString().slice(0, 10);
    writeFileSync(join(dir, 'momo.csv'), ['Date,Description,Transaction ID,Credit,Debit', `${d},Payment received,MP-555,25.00,`, `${d},ECG prepaid,TX-1,,40.00`, `${d},Mystery deposit,TX-2,10.00,`].join('\n'));
    browser = await pw.chromium.launch(); page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(10_000);
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(OWNER.username); await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(page, 'Bank & MoMo statements');
  });
  afterAll(async () => { await browser?.close(); if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); } await cloud?.close(); });

  it('imports a statement, shows suggestions, accepts all suggested lines and ignores the rest', async () => {
    await page.getByLabel('Choose statement file').setInputFiles(join(dir, 'momo.csv'));
    await page.getByRole('button', { name: 'Import 3 line(s)', exact: true }).click();
    await page.getByText('Matches Sale').waitFor();
    await page.getByText('Record as an expense').waitFor();
    await page.getByRole('button', { name: /Accept all suggested \(2\)/ }).click();
    await page.getByText(/2 line\(s\) accepted, 1 expense\(s\) recorded/).waitFor();
    const expense = host.engine.db.prepare(`SELECT category, amount, payment_method FROM expenses`).get() as any;
    expect(expense).toEqual({ category: 'Electricity', amount: 4000, payment_method: 'momo' });
    await page.getByLabel('Select line 4').check();
    await page.getByRole('button', { name: 'Ignore selected', exact: true }).click();
    await page.getByRole('button', { name: 'Back to statements', exact: true }).click();
    await page.getByRole('cell', { name: 'Done', exact: true }).waitFor();
  });
});
