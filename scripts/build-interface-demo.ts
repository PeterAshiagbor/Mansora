/** Build a static, sample-only interface preview from the real interfaces and engine responses. */
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../apps/api/src/app';
import { connectEmbedded } from '../apps/api/src/db';
import { createAdmin } from '../apps/api/src/modules/admin';
import { openEngine, syncNow } from '../apps/desktop/src/core';
import { NoEmail, type Billing } from '../apps/api/src/billing';
import { createProviders } from '../apps/api/src/billing/providers/registry';

const root = resolve(import.meta.dirname, '..');
const target = resolve(process.argv[2] ?? join(root, '.interface-demo'));
const temporary = mkdtempSync(join(tmpdir(), 'mansora-interface-fixture-'));
const secrets: string[] = [randomUUID(), randomUUID(), randomUUID()];
const db = await connectEmbedded(); await db.migrate();
const admin = { email: 'preview@mansora.example', name: 'Sample Platform Administrator', password: secrets[0] };
await db.platform((q) => createAdmin(q, admin));
const billingEnv = { publicBaseUrl: 'http://127.0.0.1:0', payLinkSecret: randomUUID(), encryptionKey: randomBytes(32), adminEmail: 'preview@mansora.example' };
secrets.push(billingEnv.payLinkSecret, billingEnv.encryptionKey.toString('hex'));
const { registry, sandbox } = createProviders({ allowSandbox: true, publicBaseUrl: billingEnv.publicBaseUrl });
const billing: Billing = { db, providers: registry, email: new NoEmail(), env: billingEnv, now: () => new Date() };
const app = await buildApp({ db, backupDir: join(temporary, 'backups'), billing });
await app.listen({ port: 0, host: '127.0.0.1' });
const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
billingEnv.publicBaseUrl = origin;
sandbox!.baseUrl = origin;
let adminToken = '';
async function api(method: string, url: string, payload?: unknown) {
  const response = await app.inject({ method: method as any, url, headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {}, ...(payload ? { payload } : {}) });
  if (response.statusCode >= 400) throw new Error(`${method} ${url}: ${response.body}`);
  return response.json();
}
let engine: ReturnType<typeof openEngine> | undefined;
try {
  adminToken = (await api('POST', '/v1/admin/login', admin)).token; secrets.push(adminToken);
  const plan = await api('POST', '/v1/admin/plans', { name: 'Sample Retail Plan — illustrative pricing', price: 30000, billingPeriod: 'monthly', includedSupport: 'Demonstration plan; pricing is not an offer' });
  const client = await api('POST', '/v1/admin/clients', { name: 'Sample Mini Mart', ownerName: 'Sample Business Owner', address: 'Accra — sample location', businessType: 'mini mart', planId: plan.id });
  const secondClient = await api('POST', '/v1/admin/clients', { name: 'Sample General Store', ownerName: 'Sample Store Owner', businessType: 'retail' });
  const subscriptions = [];
  for (const tenant of [client, secondClient]) {
    const subscription = await api('POST', '/v1/admin/billing/subscriptions', { tenantId: tenant.id, planId: plan.id, paymentMethod: 'manual' });
    const issued = await api('POST', `/v1/admin/billing/subscriptions/${subscription.id}/submit`);
    subscriptions.push({ ...subscription, invoiceId: issued.invoiceId });
  }
  await api('POST', `/v1/admin/billing/invoices/${subscriptions[0].invoiceId}/payment`, { amount: 10000, method: 'bank', reference: 'SAMPLE-PART-PAYMENT', notes: 'Synthetic partial payment; no money moved' });
  await api('POST', `/v1/admin/billing/invoices/${subscriptions[1].invoiceId}/payment`, { amount: 30000, method: 'bank', reference: 'SAMPLE-PAID-INVOICE', notes: 'Synthetic sample receipt; no money moved' });
  const activation = await api('POST', `/v1/admin/clients/${client.id}/activation-codes`); secrets.push(activation.code);
  engine = openEngine({ dataDir: join(temporary, 'laptop'), dbKey: secrets[2], appVersion: '0.1.0-interface-demo' });
  const e = engine;
  await e.execute(null, 'activation.activate', { apiUrl: origin, code: activation.code, deviceName: 'Sample laptop', owner: { name: 'Sample Owner', username: 'owner', password: secrets[1] } });
  const token = (await e.execute(null, 'auth.login', { username: 'owner', password: secrets[1] })).token; secrets.push(token);
  await e.execute(token, 'staff.save', { name: 'Sample Cashier', username: 'cashier', role: 'cashier', password: secrets[1] });
  const categories = new Map<string, string>();
  const ids: string[] = [];
  const products: [string, string, number, number, number][] = [
    ['Milo 400g (sample)', 'Beverages', 3850, 4500, 24], ['Ideal Milk 160g (sample)', 'Beverages', 650, 800, 96],
    ['Lipton Tea 25s (sample)', 'Beverages', 1200, 1500, 30], ['Rice 5kg (sample)', 'Groceries', 9500, 11500, 20],
    ['Cooking Oil 1L (sample)', 'Groceries', 3600, 4200, 18], ['Tomato Paste 70g (sample)', 'Groceries', 250, 350, 120],
    ['Soap Bar (sample)', 'Household', 700, 900, 40], ['Detergent 900g (sample)', 'Household', 2800, 3400, 4], ['Toothpaste 140g (sample)', 'Household', 1100, 1400, 0],
  ];
  for (const [name, category, costPrice, sellingPrice, openingStock] of products) {
    if (!categories.has(category)) categories.set(category, (await e.execute(token, 'category.save', { name: category })).id);
    ids.push((await e.execute(token, 'product.save', { name, sku: `SAMPLE-${ids.length + 1}`, barcode: `99000000000${String(ids.length + 1).padStart(2, '0')}`, categoryId: categories.get(category), costPrice, sellingPrice, openingStock, reorderLevel: 6 })).id);
  }
  const customer = await e.execute(token, 'customer.save', { name: 'Sample Customer', notes: 'Synthetic demo record' });
  await e.execute(token, 'supplier.save', { name: 'Sample Supplier', notes: 'Synthetic demo record' });
  await e.execute(token, 'shift.open', { openingFloat: 20000 });
  await e.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId: ids[0], quantity: 2 }], tenders: [{ method: 'cash', amount: 9000 }] });
  await e.execute(token, 'sale.complete', { id: randomUUID(), customerId: customer.id, lines: [{ productId: ids[1], quantity: 5 }], tenders: [{ method: 'credit', amount: 4000 }] });
  await e.execute(token, 'expense.create', { id: randomUUID(), category: 'Transport', description: 'Sample delivery transport', amount: 1200, expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'cash', paidFromTill: true });
  await syncNow(e);
  const snapshot: Record<string, any> = {};
  const day = new Date().toISOString().slice(0, 10);
  const range = { from: day.slice(0, 8) + '01', to: day };
  for (const command of ['billing.summary', 'app.state', 'category.list', 'product.list', 'customer.list', 'supplier.list', 'purchase.list', 'stock.overview', 'stock.movements', 'shift.current', 'shift.list', 'sale.list', 'credit.list', 'expense.list', 'staff.list', 'sync.status', 'sync.queue', 'backup.list', 'support.list', 'audit.list', 'import.history', 'report.dashboard', 'report.sales', 'report.profit', 'report.stock']) {
    snapshot[command] = await e.execute(token, command, command.startsWith('report.') || ['sale.list', 'shift.list', 'expense.list', 'audit.list'].includes(command) ? range : {});
  }
  // These responses contain display data only; never serialize engine sessions or raw database files.
  for (const command of ['sale', 'customer', 'purchase']) for (const row of snapshot[`${command}.list`]) snapshot[`${command}.get:${row.id}`] = await e.execute(token, `${command}.get`, { id: row.id });
  for (const format of ['csv', 'xlsx']) snapshot[`import.template:${format}`] = await e.execute(token, 'import.template', { format });
  const cashierToken = (await e.execute(null, 'auth.login', { username: 'cashier', password: secrets[1] })).token; secrets.push(cashierToken);
  await e.execute(cashierToken, 'shift.open', { openingFloat: 10000 });
  snapshot.cashierShift = await e.execute(cashierToken, 'shift.current');
  snapshot.cashier = await e.execute(cashierToken, 'app.state');
  snapshot.cashierDashboard = await e.execute(cashierToken, 'report.dashboard');
  const provider: Record<string, any> = {};
  for (const path of ['/v1/admin/overview', '/v1/admin/clients', '/v1/admin/plans', '/v1/admin/audit', '/v1/admin/totp']) provider[path] = await api('GET', path);
  for (const c of provider['/v1/admin/clients']) {
    provider[`/v1/admin/clients/${c.id}`] = await api('GET', `/v1/admin/clients/${c.id}`);
    provider[`/v1/admin/audit?tenantId=${c.id}`] = await api('GET', `/v1/admin/audit?tenantId=${c.id}`);
  }
  const prefix = '/v1/admin/billing';
  for (const path of ['/collections', '/exceptions', '/notifications', '/attempts', '/invoices', '/subscriptions', '/payments', '/settlements', '/providers', '/settings', '/merchant-accounts']) provider[prefix + path] = await api('GET', prefix + path);
  for (const filter of ['all', 'active', 'pending_mandate', 'upcoming', 'paid', 'overdue', 'failed', 'cancelled', 'disputed']) provider[`${prefix}/collections?filter=${filter}`] = await api('GET', `${prefix}/collections?filter=${filter}`);
  for (const status of ['draft', 'awaiting_approval', 'trial', 'active', 'payment_due', 'payment_failed', 'overdue', 'paused', 'cancelled', 'expired']) provider[`${prefix}/subscriptions?status=${status}`] = await api('GET', `${prefix}/subscriptions?status=${status}`);
  provider[`${prefix}/reports/summary?from=${range.from}&to=${range.to}`] = await api('GET', `${prefix}/reports/summary?from=${range.from}&to=${range.to}`);
  for (const row of provider[prefix + '/invoices']) provider[`${prefix}/invoices/${row.id}`] = await api('GET', `${prefix}/invoices/${row.id}`);
  for (const row of provider[prefix + '/subscriptions']) provider[`${prefix}/subscriptions/${row.id}`] = await api('GET', `${prefix}/subscriptions/${row.id}`);
  for (const c of provider['/v1/admin/clients']) provider[`${prefix}/audit?tenantId=${c.id}`] = await api('GET', `${prefix}/audit?tenantId=${c.id}`);
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), reportRange: range, desktop: snapshot, admin: provider });
  for (const secret of secrets) if (json.includes(secret)) throw new Error('Refusing to publish an authentication secret');
  if (/"(?:password_hash|device_token|secret_encrypted|token_hash|token_encrypted|payLinkSecret|encryptionKey)"/.test(json)) throw new Error('Refusing credential fields');
  mkdirSync(join(target, 'dist'), { recursive: true });
  for (const [name, folder] of [['client', 'apps/desktop/dist/renderer'], ['admin', 'apps/admin-web/dist']] as const) {
    rmSync(join(target, 'dist', name), { recursive: true, force: true });
    cpSync(join(root, folder), join(target, 'dist', name), { recursive: true });
    const path = join(target, 'dist', name, 'index.html');
    // Admin Vite output has root-relative asset paths. Each interface lives under its own directory.
    let html = readFileSync(path, 'utf8').replaceAll('src="/assets/', `src="/${name}/assets/`).replaceAll('href="/assets/', `href="/${name}/assets/`).replace('href="/mansora-favicon.png"', `href="/${name}/mansora-favicon.png"`).replace('src="/config.js"', 'src="/admin/config.js"');
    html = html.replace('<head>', `<head><meta name="robots" content="noindex,nofollow"><script src="/demo-data.js"></script><script src="/demo.js"></script><link rel="stylesheet" href="/demo.css">`);
    writeFileSync(path, html);
    if (name === 'admin') {
      // Vite's default absolute base also appears in the generated JS and font CSS.
      const { readdirSync } = await import('node:fs');
      for (const file of readdirSync(join(target, 'dist', name, 'assets'))) if (/\.(js|css)$/.test(file)) {
        const asset = join(target, 'dist', name, 'assets', file);
        writeFileSync(asset, readFileSync(asset, 'utf8').replaceAll('/assets/', '/admin/assets/'));
      }
    }
  }
  writeFileSync(join(target, 'dist', 'admin', 'config.js'), 'window.MANSORA_API_URL = "";\n');
  writeFileSync(join(target, 'dist', 'demo-data.js'), `window.MANSORA_DEMO_DATA = ${json};\n`);
  for (const file of ['index.html', 'demo.js', 'demo.css']) cpSync(join(root, 'scripts/interface-demo', file), join(target, 'dist', file));
  cpSync(join(root, 'packages/ui/src/assets/mansora-logo.webp'), join(target, 'dist', 'logo.webp'));
  mkdirSync(join(target, 'dist', 'walkthrough'), { recursive: true });
  cpSync(join(root, 'docs/team-walkthrough.html'), join(target, 'dist', 'walkthrough/index.html'));
  cpSync(join(root, 'docs/screenshots'), join(target, 'dist', 'walkthrough/screenshots'), { recursive: true });
  console.log(`Built sample-only interface demo: ${target}/dist`);
} finally {
  engine?.db.close(); await app.close(); await db.close(); rmSync(temporary, { recursive: true, force: true });
}
