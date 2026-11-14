import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { serveStatic } from '../../scripts/static';
import { navigate } from './navigation';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { admin, approveOnProviderPage, asClient, at, mkClient, mkPlan, subscribe } from '../billing/helpers';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const hasPdfText = spawnSync('pdftotext', ['-v']).status === 0;
const evidence = process.env.MANSORA_DOCUMENT_PDF_DIR ?? tempDir('mansora-print-documents-');
describe.skipIf(!pw)('printable billing documents through real API and Chromium PDFs', () => {
  let web: Awaited<ReturnType<typeof serveStatic>>, app: Awaited<ReturnType<typeof buildApp>>;
  let cloud: Cloud, browser: any, page: any, invoice: any, receipt: any, other: { id: string; token: string };
  const requests: string[] = [], errors: string[] = [];
  beforeAll(async () => {
    if (process.env.MANSORA_REQUIRE_PDF_TEXT === '1' && !hasPdfText) throw new Error('Install poppler-utils for the dedicated PDF-content acceptance job.');
    mkdirSync(evidence, { recursive: true }); cloud = await startCloud(); at(cloud, '2026-11-14'); const a = admin(cloud);
    const settings = (await a.get('/settings')).body;
    expect((await a.put('/settings', { ...settings, issuer: { name: 'Mansora print fixture', address: 'Synthetic address, Accra', phone: '0000000000', email: 'print@example.test', tin: 'TEST-TIN-ONLY', paymentInstructions: 'Synthetic invoice only.' } })).status).toBe(200);
    const client = await mkClient(cloud, 'Print fixture <not-markup>');
    const created = await a.post('/invoices', { tenantId: client.id, issue: true, taxBps: 0, notes: 'N'.repeat(600), lines: Array.from({ length: 100 }, (_, index) => ({ description: `Line ${index + 1} ${index === 0 ? '<script>window.printExploit=1</script>' : index === 99 ? 'FINAL-LINE' : 'Synthetic service detail'}`, quantity: 1, unitPrice: 1250 })) });
    expect(created.status).toBe(200); invoice = (await a.get(`/invoices/${created.body.id}`)).body;
    other = await mkClient(cloud, 'Paid document fixture'); const plan = await mkPlan(cloud, { price: 35000 }); await subscribe(cloud, other.id, plan);
    const checkout = await asClient(cloud, other.token).post('/mandate', { method: 'card' }); expect(checkout.status).toBe(200); await approveOnProviderPage(checkout.body.url);
    receipt = (await a.get('/payments')).body.find((payment: any) => payment.tenant_id === other.id); expect(receipt.sandbox).toBe(true);
    web = await serveStatic(join(import.meta.dirname, '../../apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL=${JSON.stringify(cloud.url)};` });
    await cloud.app.close(); app = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir(), adminOrigins: [web.url] }); await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    browser = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined }); page = await browser.newPage(); page.on('pageerror', (error: Error) => errors.push(error.message)); page.on('request', (request: any) => requests.push(request.url()));
  });
  afterAll(async () => { await browser?.close(); if (web) await new Promise<void>(resolve => web.server.close(() => resolve())); await app?.close(); await cloud?.close(); if (!process.env.MANSORA_DOCUMENT_PDF_DIR) rmSync(evidence, { recursive: true, force: true }); });
  async function pdf(html: string, name: string) {
    await page.setContent(html); await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => (window as any).printExploit)).toBeUndefined();
    const path = join(evidence, name + '.pdf'), bytes: Buffer = await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const boxes = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/g)]; expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) { expect(Number(box[1])).toBeCloseTo(595.28, 0); expect(Number(box[2])).toBeCloseTo(841.89, 0); }
    const text = hasPdfText ? execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }) : undefined;
    return { boxes, text };
  }
  it('prints all 100 invoice lines on A4, repeats headers and keeps totals together without changing the issued invoice', async () => {
    const a = admin(cloud), before = (await a.get(`/invoices/${invoice.id}`)).body, result = await a.get(`/invoices/${invoice.id}/document`); expect(result.status).toBe(200);
    await page.setContent(result.body.html); expect(await page.getByRole('heading', { name: 'Invoice', exact: true }).count()).toBe(1); expect(await page.getByText('TEST-TIN-ONLY', { exact: false }).count()).toBe(1);
    const printed = await pdf(result.body.html, 'multi-page-invoice'); expect(printed.boxes.length).toBeGreaterThan(1);
    if (printed.text) {
      for (const text of [invoice.number, 'Mansora print fixture', 'Print fixture <not-markup>', 'TEST-TIN-ONLY', 'Line 1 ', 'Line 100 FINAL-LINE', '1,250.00', 'Balance due']) expect(printed.text).toContain(text);
      expect((printed.text.match(/Description/g) ?? []).length).toBeGreaterThan(1);
      const pages = printed.text.split('\f'); expect(pages.findIndex(p => p.includes('Subtotal'))).toBe(pages.findIndex(p => p.includes('Balance due')));
      expect(printed.text).not.toContain('browser’s Print menu');
    }
    expect((await a.get(`/invoices/${invoice.id}`)).body).toEqual(before);
  });
  it('prints a real sandbox receipt with the same number, issuer, allocation and payment amount', async () => {
    const a = admin(cloud), before = (await a.get('/payments')).body, result = await a.get(`/payments/${receipt.id}/receipt`); expect(result.status).toBe(200);
    const printed = await pdf(result.body.html, 'sandbox-receipt'); expect(printed.boxes).toHaveLength(1);
    if (printed.text) for (const text of [receipt.receipt_number, 'Mansora print fixture', 'Paid document fixture', 'TEST-TIN-ONLY', '350.00', 'Amount received', 'SANDBOX', receipt.invoices]) expect(printed.text).toContain(text);
    expect((await a.get('/payments')).body).toEqual(before); expect(errors).toEqual([]); expect(requests).toEqual([]);
  });
  it('opens the real administrator printable invoice and hides screen guidance in print media', async () => {
    const adminPage = await browser.newPage(); adminPage.on('pageerror', (error: Error) => errors.push(error.message));
    try {
      await adminPage.goto(web.url); await adminPage.getByLabel('Email', { exact: true }).fill(ADMIN.email); await adminPage.getByLabel('Password', { exact: true }).fill(ADMIN.password); await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click();
      await navigate(adminPage, 'Invoices'); await adminPage.getByRole('row', { name: /Print fixture <not-markup>/ }).click();
      const [document] = await Promise.all([adminPage.waitForEvent('popup'), adminPage.getByRole('button', { name: 'Open printable invoice', exact: true }).click()]);
      try {
        await document.getByRole('heading', { name: 'Invoice', exact: true }).waitFor(); expect(document.url()).toMatch(/^blob:/);
        expect(await document.getByText('Line 100 FINAL-LINE', { exact: true }).count()).toBe(1); await document.locator('.print-help').waitFor();
        await document.emulateMedia({ media: 'print' }); expect(await document.locator('.print-help').isVisible()).toBe(false); expect(await document.locator('script').count()).toBe(0);
      } finally { await document.close(); }
      expect(errors).toEqual([]);
    } finally { await adminPage.close(); }
  });
  it('preserves authentication and tenant isolation and reports missing documents as not found', async () => {
    expect((await cloud.api('GET', `/v1/admin/billing/invoices/${invoice.id}/document`, undefined, null)).status).toBe(401);
    expect((await asClient(cloud, other.token).get(`/invoices/${invoice.id}/document`)).status).toBe(404);
    expect((await admin(cloud).get(`/invoices/${randomUUID()}/document`)).status).toBe(404);
    expect((await admin(cloud).get(`/payments/${randomUUID()}/receipt`)).status).toBe(404);
  });
});
