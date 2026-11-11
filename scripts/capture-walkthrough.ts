import { navigate } from '../tests/e2e/navigation';
/**
 * Regenerates docs/screenshots from the REAL running build (laptop app, admin dashboard, cloud API on
 * embedded PostgreSQL, sandbox payment provider) using clearly-labelled SAMPLE data. Nothing is mocked.
 *
 *   npm run build && npx tsx scripts/capture-walkthrough.ts
 *
 * Development only: credentials are generated for each throwaway local database.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/api/src/app';
import { connectEmbedded } from '../apps/api/src/db';
import { createAdmin } from '../apps/api/src/modules/admin';
import { startDevHost } from '../apps/desktop/dev/host';
import { syncNow } from '../apps/desktop/src/core';
import { serveStatic } from './static';

const root = join(import.meta.dirname, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
for (const d of ['apps/desktop/dist/renderer/index.html', 'apps/admin-web/dist/index.html']) if (!existsSync(join(root, d))) throw new Error('Run `npm run build` first');
const pw = createRequire(import.meta.url)('playwright');

const API = 'http://127.0.0.1:4100';
process.env.PUBLIC_BASE_URL = API;
const ADMIN = { email: 'demo.admin@mansora.example', name: 'Demo Administrator', password: randomUUID() };
const PASS = randomUUID();
const db = await connectEmbedded(mkdtempSync(join(tmpdir(), 'mns-cap-pg-')));
await db.migrate();
await db.platform((q) => createAdmin(q, ADMIN));
const web = await serveStatic(join(root, 'apps/admin-web/dist'), 5184, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(API)};` });
const app = await buildApp({ db, backupDir: mkdtempSync(join(tmpdir(), 'mns-cap-bk-')), adminOrigins: [web.url, 'http://localhost:5184'] });
await app.listen({ port: 4100, host: '127.0.0.1' });
const host = await startDevHost({ dataDir: mkdtempSync(join(tmpdir(), 'mns-cap-laptop-')), port: 5183 });
const e = host.engine;

let adminToken = '';
const api = async (method: string, path: string, body?: unknown, token?: string | null) => {
  const t = token === undefined ? adminToken : token;
  const res = await fetch(API + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
};
adminToken = (await api('POST', '/v1/admin/login', { email: ADMIN.email, password: ADMIN.password }, null)).body.token;
const must = async (p: Promise<{ status: number; body: any }>) => { const r = await p; if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; };
const GHS = (n: number) => Math.round(n * 100);

// ------------------------------------------------------------------ cloud-side sample data
const plans: Record<string, string> = {};
for (const [name, price, period, support] of [['Starter', 150, 'monthly', 'Email support'], ['Standard', 300, 'monthly', 'Phone and email support'], ['Standard (yearly)', 3000, 'yearly', 'Phone and email support, priority']] as const)
  plans[name] = (await must(api('POST', '/v1/admin/plans', { name, price: GHS(price), billingPeriod: period, includedSupport: support, description: `${name} plan (SAMPLE)`, setupFee: 0 }))).id;
const mkClient = async (name: string, owner: string, email: string) => (await must(api('POST', '/v1/admin/clients', { name, ownerName: owner, phone: '0240000000', address: 'Osu, Accra', email, businessType: 'mini mart' }))).id as string;
const shopId = await mkClient('Sample Mini Mart (SAMPLE DATA)', 'Ama Owusu', 'ama@sample-minimart.example');
const kwesi = await mkClient('Kwesi Provisions (sample)', 'Kwesi Boateng', 'kwesi@sample.example');
const adjoa = await mkClient('Adjoa General Store (sample)', 'Adjoa Mensah', 'adjoa@sample.example');
const code = (await must(api('POST', `/v1/admin/clients/${shopId}/activation-codes`))).code as string;
const billing = (path: string, body: unknown = {}) => must(api('POST', `/v1/admin/billing${path}`, body));
const subscribe = async (tenantId: string, planId: string, over: Record<string, unknown> = {}) => {
  const s = await billing('/subscriptions', { tenantId, planId, ...over });
  const r = await billing(`/subscriptions/${s.id}/submit`);
  return { id: s.id as string, invoiceId: r.invoiceId as string };
};
const subShop = await subscribe(shopId, plans.Standard, { paymentMethod: 'momo' });
const subKwesi = await subscribe(kwesi, plans.Starter, { paymentMethod: 'manual' });
const subAdjoa = await subscribe(adjoa, plans['Standard (yearly)'], { paymentMethod: 'bank' });
// Kwesi paid by bank transfer; Adjoa's invoice is overdue.
await billing(`/invoices/${subKwesi.invoiceId}/payment`, { amount: GHS(150), method: 'bank', reference: 'BNK-SAMPLE-1', notes: 'Bank transfer (sample)' });
await db.platform((q) => q(`UPDATE invoices SET due_date = (now() - interval '9 days')::date, issue_date = (now() - interval '23 days')::date WHERE id = $1`, [subAdjoa.invoiceId]));
await billing('/run/reminders').catch(() => {});

// ------------------------------------------------------------------ laptop-side sample data
await e.execute(null, 'activation.activate', { apiUrl: API, code, deviceName: 'Front counter laptop', owner: { name: 'Ama Owusu', username: 'ama', password: PASS } });
const owner = (await e.execute(null, 'auth.login', { username: 'ama', password: PASS })).token;
await e.execute(owner, 'business.update', { name: 'Sample Mini Mart (SAMPLE DATA)', phone: '0240000000', address: 'Osu, Accra', receiptFooter: 'Thank you for shopping with us', lockMinutes: 10, allowNegativeStock: false, maxDiscountBps: 1000 }).catch(() => {});
await e.execute(owner, 'staff.save', { name: 'Kofi Mensah', username: 'kofi', role: 'manager', password: PASS });
await e.execute(owner, 'staff.save', { name: 'Esi Boateng', username: 'esi', role: 'cashier', password: PASS });
const cats: Record<string, string> = {};
const products: Record<string, string> = {};
for (const [name, barcode, cat, cost, price, stock] of [
  ['Milo 400g tin', '6001068000012', 'Beverages', 3850, 4500, 24], ['Ideal Milk 160g', '6001068000029', 'Beverages', 650, 800, 96], ['Lipton Yellow Label 25s', '6001068000036', 'Beverages', 1200, 1500, 30],
  ['Royal Aroma Rice 5kg', '6001068000043', 'Groceries', 9500, 11500, 20], ['Frytol Oil 1L', '6001068000050', 'Groceries', 3600, 4200, 18], ['Gino Tomato Paste 70g', '6001068000067', 'Groceries', 250, 350, 120],
  ['Key Soap bar', '6001068000074', 'Household', 700, 900, 40], ['Omo 900g', '6001068000081', 'Household', 2800, 3400, 4], ['Pepsodent 140g', '6001068000098', 'Household', 1100, 1400, 0],
] as [string, string, string, number, number, number][]) {
  cats[cat] ??= (await e.execute(owner, 'category.save', { name: cat })).id;
  products[name] = (await e.execute(owner, 'product.save', { name: `${name} (sample)`, barcode, categoryId: cats[cat], costPrice: cost, sellingPrice: price, openingStock: stock, reorderLevel: 6 })).id;
}
const sup = (await e.execute(owner, 'supplier.save', { name: 'Accra Wholesale (sample)', phone: '0300000000' })).id;
await e.execute(owner, 'purchase.receive', { supplierId: sup, reference: 'INV-5521', items: [{ productId: products['Omo 900g'], quantity: 24, unitCost: 2750 }, { productId: products['Frytol Oil 1L'], quantity: 12, unitCost: 3550 }] });
const cust = (await e.execute(owner, 'customer.save', { name: 'Mama Efua (sample)', phone: '0200000000' })).id;
const cust2 = (await e.execute(owner, 'customer.save', { name: 'Kojo Traders (sample)', phone: '0200000001' })).id;
const esi = (await e.execute(null, 'auth.login', { username: 'esi', password: PASS })).token;
const kofi = (await e.execute(null, 'auth.login', { username: 'kofi', password: PASS })).token;
await e.execute(esi, 'shift.open', { openingFloat: GHS(200) });
const sale = (tenders: any[], items: [string, number][], extra: Record<string, unknown> = {}, token = esi) => e.execute(token, 'sale.complete', { id: randomUUID(), lines: items.map(([n, q]) => ({ productId: products[n], quantity: q })), tenders, ...extra });
const total = (items: [string, number][]) => items.reduce((n, [name, q]) => n + q * ({ 'Milo 400g tin': 4500, 'Ideal Milk 160g': 800, 'Lipton Yellow Label 25s': 1500, 'Royal Aroma Rice 5kg': 11500, 'Frytol Oil 1L': 4200, 'Gino Tomato Paste 70g': 350, 'Key Soap bar': 900, 'Omo 900g': 3400 } as any)[name], 0);
const baskets: [string, number][][] = [[['Milo 400g tin', 1], ['Ideal Milk 160g', 2], ['Key Soap bar', 1]], [['Royal Aroma Rice 5kg', 1], ['Gino Tomato Paste 70g', 3]], [['Frytol Oil 1L', 2]], [['Lipton Yellow Label 25s', 2], ['Ideal Milk 160g', 4]], [['Omo 900g', 1], ['Key Soap bar', 2]], [['Milo 400g tin', 2]]];
const made: any[] = [];
for (const [i, b] of baskets.entries()) {
  const t = total(b);
  made.push(await sale(i % 3 === 1 ? [{ method: 'momo', amount: t, reference: `MM${1000 + i}` }] : i % 3 === 2 ? [{ method: 'card', amount: t, reference: `CD${200 + i}` }] : [{ method: 'cash', amount: Math.ceil(t / 1000) * 1000 }], b));
}
// A credit sale (manager approves) with a part repayment, and an approved refund.
const creditBasket: [string, number][] = [['Royal Aroma Rice 5kg', 2], ['Frytol Oil 1L', 1]];
await sale([{ method: 'credit', amount: total(creditBasket) }], creditBasket, { customerId: cust, dueDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), approver: { username: 'kofi', password: PASS } });
const old = [['Gino Tomato Paste 70g', 5]] as [string, number][];
await sale([{ method: 'credit', amount: total(old) }], old, { customerId: cust2, dueDate: new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10), approver: { username: 'kofi', password: PASS } });
const credit = await e.execute(owner, 'credit.list', {});
const acct = (credit.accounts ?? credit)[0];
if (acct) await e.execute(owner, 'credit.repay', { id: randomUUID(), creditAccountId: acct.id ?? acct.credit_account_id, amount: GHS(50), method: 'cash' }).catch(() => {});
const first = await e.execute(owner, 'sale.get', { id: made[0].id });
await e.execute(esi, 'refund.create', { id: randomUUID(), saleId: made[0].id, reason: 'Dented tin', payoutMethod: 'cash', lines: [{ saleItemId: first.items[1].id, quantity: 1, restock: false }], approver: { username: 'kofi', password: PASS } });
await e.execute(owner, 'expense.create', { id: randomUUID(), category: 'Transport', description: 'Delivery from wholesaler (sample)', amount: GHS(60), expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'cash', paidFromTill: false });
await e.execute(owner, 'expense.create', { id: randomUUID(), category: 'Electricity', description: 'Prepaid units (sample)', amount: GHS(120), expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'momo', paidFromTill: false });
await e.execute(owner, 'stock.adjust', { productId: products['Key Soap bar'], type: 'DAMAGE', delta: -2, reason: 'Water damage' });
const cur = await e.execute(esi, 'shift.current', {});
await e.execute(esi, 'shift.close', { countedCash: cur.totals.expectedCash - 100 });
await e.execute(esi, 'shift.open', { openingFloat: GHS(150) });
await e.execute(owner, 'support.grant', { scope: 'reports', purpose: 'Help with first month reports', hours: 24 });
{
  const { url } = await e.execute(owner, 'billing.pay', { invoiceId: subShop.invoiceId });
  const r = await fetch(`${url}/approve`, { method: 'POST', redirect: 'manual' });
  if (![302, 303].includes(r.status)) throw new Error('sandbox approve failed');
  await e.execute(owner, 'billing.summary', {});
}
await syncNow(e);
await api('GET', `/v1/admin/clients/${shopId}/reports/summary`).catch(() => {});
await e.execute(owner, 'sync.run', {}).catch(() => {});
for (const t of [owner, esi, kofi]) e.endSession(t);

// ------------------------------------------------------------------ screenshots
const browser = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const mk = async () => { const p = await browser.newPage({ viewport: { width: 1366, height: 768 } }); p.setDefaultTimeout(20_000); return p; };
const shot = (p: any, name: string) => p.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
const shop = await mk();
const admin = await mk();
const signIn = async (u: string) => {
  await shop.goto(host.url);
  await shop.getByText('Sign in with your staff username and password. This works without internet.', { exact: true }).waitFor();
  await shop.getByLabel('Username').fill(u);
  await shop.getByLabel('Password', { exact: true }).fill(PASS);
  await shop.getByRole('button', { name: 'Sign in' }).click();
  await shop.getByRole('button', { name: 'Lock / sign out' }).waitFor();
};
const nav = async (name: string) => { await navigate(shop, name); await shop.waitForTimeout(500); };
const settle = (p: any) => p.waitForTimeout(600);

// 01 sign-in screen
await shop.goto(host.url);
await shop.getByText('Sign in with your staff username and password. This works without internet.', { exact: true }).waitFor();
await shot(shop, '01-login');

// cashier screens
await signIn('esi');
await nav('New sale');
const search = shop.getByLabel('Search or scan product');
for (const barcode of ['6001068000012', '6001068000029', '6001068000029', '6001068000074']) { await search.pressSequentially(barcode, { delay: 1 }); await search.press('Enter'); }
await shop.getByText('4 item(s)').waitFor();
await shot(shop, '02-checkout');
await shop.keyboard.press('F9');
await shop.getByLabel('Cash received').fill('100');
await settle(shop);
await shot(shop, '03-payment');
await shop.keyboard.press('Enter');
await shop.getByTestId('receipt-no').waitFor();
await shot(shop, '04-sale-done');
await shop.keyboard.press('Enter');
await nav('Sales history');
await shot(shop, '05-sales-history');
await shop.getByText('R-000001').first().click();
await shop.getByText('RF-000001').first().waitFor().catch(() => {});
await settle(shop);
await shot(shop, '06-receipt-detail');
await shop.keyboard.press('Escape');
await nav('Cashier shifts');
await shot(shop, '07-shift-cashier');
await shop.getByRole('button', { name: 'Lock / sign out' }).click();

// owner screens
await signIn('ama');
await shot(shop, '10-dashboard');
for (const [label, file] of [['Products', '11-products'], ['Stock', '12-stock'], ['Purchases & suppliers', '13-purchases'], ['Customers', '14-customers'], ['Credit & repayments', '15-credit'], ['Cashier shifts', '16-shifts-owner'], ['Expenses', '17-expenses']] as const) { await nav(label); await shot(shop, file); }
await nav('Reports');
await shot(shop, '18-reports-sales');
await shop.getByRole('tab', { name: 'Payments' }).click(); await settle(shop); await shot(shop, '19-reports-payments');
await shop.getByRole('tab', { name: 'Gross profit' }).click(); await settle(shop); await shot(shop, '20-reports-profit');
await nav('Staff'); await shot(shop, '21-staff');
await shop.getByRole('row', { name: /Esi Boateng/ }).click();
await settle(shop); await shot(shop, '22-staff-permissions'); await shop.keyboard.press('Escape');
await nav('Import & export'); await shot(shop, '23-import-export');
await nav('Settings'); await shot(shop, '24-settings');
await nav('Sync status'); await shot(shop, '25-sync');
await nav('Backup & recovery'); await shot(shop, '26-backup');
await nav('Mansora access'); await shot(shop, '27-owner-grants-access');
await nav('Audit history'); await shot(shop, '28-audit');
await nav('Billing & payments'); await shop.getByText('Your plan').waitFor(); await shot(shop, '60-client-billing');
// pay the invoice through the sandbox provider page, as the client would

// admin screens
await admin.goto(web.url);
await admin.getByLabel('Email', { exact: true }).fill(ADMIN.email);
await admin.getByLabel('Password', { exact: true }).fill(ADMIN.password);
await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
const anav = async (name: string) => { await navigate(admin, name); await admin.waitForTimeout(700); };
await anav('Overview'); await settle(admin); await shot(admin, '30-admin-overview');
await anav('Clients'); await shot(admin, '31-admin-clients');
await admin.getByText('Sample Mini Mart (SAMPLE DATA)').first().click(); await settle(admin);
await shot(admin, '32-admin-client');
await admin.getByRole('button', { name: 'View sales summary' }).click().catch(() => {}); await settle(admin);
await shot(admin, '33-admin-reports-with-consent');
await anav('Clients'); await admin.getByText('Kwesi Provisions (sample)').first().click(); await settle(admin);
await admin.getByRole('button', { name: 'Create activation code' }).click().catch(() => {}); await settle(admin);
await shot(admin, '34-admin-activation-code'); await admin.getByRole('button', { name: 'Done' }).click().catch(() => {});
await admin.getByRole('button', { name: 'View sales summary' }).click().catch(() => {}); await settle(admin);
await shot(admin, '38-admin-no-consent');
await anav('Service plans'); await shot(admin, '36-admin-plans');
await anav('Audit log'); await shot(admin, '37-admin-audit');
await anav('Collections'); await admin.getByRole('row', { name: /Sample Mini Mart/ }).waitFor(); await shot(admin, '40-admin-collections');
await admin.getByRole('button', { name: 'Manage' }).first().click(); await settle(admin); await shot(admin, '41-admin-collections-manage'); await admin.keyboard.press('Escape');
await anav('Subscriptions'); await shot(admin, '42-admin-subscriptions');
await anav('Invoices'); await shot(admin, '43-admin-invoices');
await admin.getByRole('row', { name: /Sample Mini Mart/ }).click(); await settle(admin); await shot(admin, '44-admin-invoice-detail'); await admin.keyboard.press('Escape');
await anav('Payments'); await shot(admin, '45-admin-payments');
await admin.setViewportSize({ width: 1366, height: 1250 });
await anav('Revenue reports'); await settle(admin); await shot(admin, '46-admin-revenue');
await anav('Payment settings'); await settle(admin); await shot(admin, '47-admin-payment-settings');
await admin.setViewportSize({ width: 1366, height: 768 });
await anav('Clients'); await admin.getByText('Sample Mini Mart (SAMPLE DATA)').first().click(); await settle(admin);
await admin.getByRole('button', { name: 'Owner recovery code' }).click(); await settle(admin); await shot(admin, '35-admin-recovery'); await admin.keyboard.press('Escape');
await syncNow(e);
await shop.goto(host.url);
await shop.getByRole('button', { name: 'Lock / sign out' }).waitFor();
await nav('Mansora access'); await shop.waitForTimeout(1500);
await shot(shop, '27b-owner-sees-access-log');
await nav('Billing & payments'); await shop.getByText('Your plan').waitFor(); await settle(shop); await shot(shop, '60-client-billing');
await browser.close();
await app.close(); host.server.close(); web.server.close(); host.engine.db.close(); await db.close();
console.log('screenshots written to', out);
