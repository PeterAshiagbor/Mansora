import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { OWNER, tempDir } from '../helpers';
import { startDevHost } from '../../apps/desktop/dev/host';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
// Set STATEMENT_SHOTS to a folder to keep screenshots of each step.
const shots = process.env.STATEMENT_SHOTS;

describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html')))('a practice MTN MoMo statement in a test shop like Mansora TSB', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
  const dir = tempDir();
  const shot = async (name: string) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); } };
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Mansora TSB');
    host = await startDevHost({ dataDir: tempDir(), port: 0 });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'TSB till', owner: OWNER });
    const token = (await host.engine.execute(null, 'auth.login', OWNER)).token;
    const soap = await host.engine.execute(token, 'product.save', { name: 'Key soap', sellingPrice: 1500, costPrice: 900, openingStock: 50 });
    const rice = await host.engine.execute(token, 'product.save', { name: 'Rice 5kg', sellingPrice: 12000, costPrice: 9500, openingStock: 20 });
    await host.engine.execute(token, 'supplier.save', { name: 'Kofi Wholesale' });
    await host.engine.execute(token, 'shift.open', { openingFloat: 0 });
    const sell = (productId: string, quantity: number, amount: number, reference?: string) =>
      host.engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId, quantity }], tenders: [{ method: 'momo', amount, ...(reference ? { reference } : {}) }] });
    await sell(soap.id, 3, 4500, '61234567890');
    await sell(rice.id, 1, 12000, '61234567911');
    await sell(soap.id, 2, 3000);
    await host.engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId: soap.id, quantity: 1 }], tenders: [{ method: 'cash', amount: 1500 }] });
    const sample = await host.engine.execute(token, 'statement.sample', { format: 'xlsx' });
    writeFileSync(join(dir, sample.fileName), Buffer.from(sample.contentBase64, 'base64'));
    browser = await pw.chromium.launch(); page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(10_000);
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(OWNER.username); await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(page, 'Bank & MoMo statements');
  });
  afterAll(async () => { await browser?.close(); if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); } await cloud?.close(); });

  it('reads the MTN layout, matches the shop\'s Mobile Money sales, splits off fees, and records expenses on accept', async () => {
    await shot('1-statements-page');
    await page.getByLabel('Choose statement file').setInputFiles(join(dir, 'mansora-practice-momo-statement.xlsx'));
    await page.getByText(/This is a practice statement made by Mansora/).waitFor();
    // 3 sales + 6 typical lines + 2 fee lines (power and supplier transfer).
    await page.getByRole('button', { name: 'Import 11 line(s)', exact: true }).waitFor();
    await shot('2-preview');
    await page.getByRole('button', { name: 'Import 11 line(s)', exact: true }).click();
    await page.getByText('Matches Sale R-', { exact: false }).first().waitFor();
    await shot('3-suggestions');
    const lines = host.engine.db.prepare(`SELECT description, amount_in, amount_out, suggestion FROM statement_lines ORDER BY line_no, amount_out DESC`).all() as any[];
    const kinds = lines.map((l) => [l.description, JSON.parse(l.suggestion).kind]);
    expect(kinds.filter(([, k]) => k === 'confirm')).toHaveLength(3);
    expect(kinds).toContainEqual(['TRANSFER KOFI WHOLESALE', 'supplier']);
    expect(kinds).toContainEqual(['TRANSFER KWAME ASANTE', 'unmatched']);
    expect(lines.find((l) => l.description === 'PAYMENT MANSORA CONSULTING')).toMatchObject({ amount_out: 12900 });
    expect(JSON.parse(lines.find((l) => l.description === 'PAYMENT ECG PREPAID').suggestion)).toMatchObject({ kind: 'expense', category: 'Electricity' });
    expect(lines.filter((l) => l.description.startsWith('Charges (fees)')).map((l) => l.amount_out).sort()).toEqual([300, 50]);

    await page.getByRole('button', { name: /Accept all suggested \(9\)/ }).click();
    await page.getByText(/9 line\(s\) accepted, 6 expense\(s\) recorded/).waitFor();
    await shot('4-accepted');
    const expenses = host.engine.db.prepare(`SELECT category, SUM(amount) AS total FROM expenses GROUP BY category ORDER BY category`).all();
    expect(expenses).toEqual([
      { category: 'Airtime & data', total: 1000 }, { category: 'Bank charges', total: 350 }, { category: 'Electricity', total: 5000 },
      { category: 'Mansora subscription', total: 12900 }, { category: 'Transport', total: 2500 },
    ]);
  });
});
