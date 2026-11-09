/**
 * Local demonstration of the whole platform on one machine, with no installs
 * beyond `npm install`:
 *
 *   cloud API (embedded PostgreSQL)  http://127.0.0.1:4000
 *   Mansora admin dashboard          http://127.0.0.1:5174
 *   shop laptop app (browser host)   http://127.0.0.1:5173
 *
 * Run `npm run build` first, then `npm run demo`. Add `-- --seed` to also
 * activate the laptop and load clearly-labelled SAMPLE products.
 * Data is kept in ./.demo-data (delete the folder to start again).
 * This is for demonstrations and development only - not a production setup.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ONBOARDING_STEPS } from '@mansora/domain';
import { buildApp } from '../apps/api/src/app';
import { connectEmbedded } from '../apps/api/src/db';
import { createAdmin } from '../apps/api/src/modules/admin';
import { newActivationCode, sha256 } from '../apps/api/src/security';
import { startDevHost } from '../apps/desktop/dev/host';
import { syncNow } from '../apps/desktop/src/core';
import { serveStatic } from './static';

const root = join(import.meta.dirname, '..');
const data = join(root, '.demo-data');
mkdirSync(data, { recursive: true });
const seed = process.argv.includes('--seed');
const API = 'http://127.0.0.1:4000';
const ADMIN_EMAIL = 'demo.admin@mansora.example';

const db = await connectEmbedded(join(data, 'cloud-pg'));
await db.migrate();
const lines: string[] = [];

// Passwords are generated per installation and printed once; nothing is hard-coded.
const adminExists = (await db.platform((q) => q('SELECT 1 FROM admins WHERE email = $1', [ADMIN_EMAIL]))).length > 0;
if (!adminExists) {
  const password = process.env.DEMO_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  await db.platform((q) => createAdmin(q, { email: ADMIN_EMAIL, name: 'Demo Administrator', password }));
  lines.push(`Admin sign-in   ${ADMIN_EMAIL}  /  ${password}   (shown once - note it down)`);
} else lines.push(`Admin sign-in   ${ADMIN_EMAIL}  /  (the password printed on first run)`);

const app = await buildApp({ db, backupDir: join(data, 'cloud-backups'), adminOrigins: ['http://127.0.0.1:5174', 'http://localhost:5174'] });
await app.listen({ port: 4000, host: '127.0.0.1' });

const laptop = await startDevHost({ dataDir: join(data, 'laptop'), port: 5173, syncEveryMs: 15_000 });
const adminDist = join(root, 'apps', 'admin-web', 'dist');
if (!existsSync(adminDist)) throw new Error('Run `npm run build` first');
await serveStatic(adminDist, 5174, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(API)};` });

if (!laptop.engine.activated) {
  // A sample client with a fresh activation code, created the same way the dashboard would.
  const code = newActivationCode();
  await db.platform(async (q) => {
    const [admin] = await q('SELECT id FROM admins WHERE email = $1', [ADMIN_EMAIL]);
    let [tenant] = await q(`SELECT id FROM tenants WHERE name = 'Sample Mini Mart (SAMPLE DATA)'`);
    if (!tenant) {
      const id = randomUUID();
      await q(`INSERT INTO tenants (id, name, owner_name, phone, address, business_type, support_contact) VALUES ($1, 'Sample Mini Mart (SAMPLE DATA)', 'Sample Owner', '0240000000', 'Osu, Accra', 'mini mart', 'Demo Administrator')`, [id]);
      for (const [step] of ONBOARDING_STEPS) await q(`INSERT INTO onboarding_steps (tenant_id, step, completed_at, completed_by) VALUES ($1, $2, $3, $4)`, [id, step, step === 'create_account' ? new Date().toISOString() : null, step === 'create_account' ? admin.id : null]);
      tenant = { id };
    }
    await q(`INSERT INTO activation_codes (code_hash, tenant_id, expires_at, created_by) VALUES ($1, $2, now() + interval '72 hours', $3)`, [sha256(code), tenant.id, admin.id]);
  });
  if (seed) {
    const ownerPassword = randomBytes(6).toString('base64url');
    const e = laptop.engine;
    await e.execute(null, 'activation.activate', { apiUrl: API, code, deviceName: 'Demo laptop', owner: { name: 'Sample Owner', username: 'owner', password: ownerPassword } });
    const { token } = await e.execute(null, 'auth.login', { username: 'owner', password: ownerPassword });
    await e.execute(token, 'staff.save', { name: 'Sample Cashier', username: 'cashier', role: 'cashier', password: ownerPassword });
    const sample: [string, string, string, number, number, number][] = [
      ['Milo 400g tin', '6001068000012', 'Beverages', 3850, 4500, 24], ['Ideal Milk 160g', '6001068000029', 'Beverages', 650, 800, 96], ['Lipton Yellow Label 25s', '6001068000036', 'Beverages', 1200, 1500, 30],
      ['Royal Aroma Rice 5kg', '6001068000043', 'Groceries', 9500, 11500, 20], ['Frytol Oil 1L', '6001068000050', 'Groceries', 3600, 4200, 18], ['Gino Tomato Paste 70g', '6001068000067', 'Groceries', 250, 350, 120],
      ['Key Soap bar', '6001068000074', 'Household', 700, 900, 40], ['Omo 900g', '6001068000081', 'Household', 2800, 3400, 4], ['Pepsodent 140g', '6001068000098', 'Household', 1100, 1400, 0],
    ];
    const cats = new Map<string, string>();
    for (const [name, barcode, cat, cost, price, stock] of sample) {
      if (!cats.has(cat)) cats.set(cat, (await e.execute(token, 'category.save', { name: cat })).id);
      await e.execute(token, 'product.save', { name: `${name} (sample)`, barcode, categoryId: cats.get(cat), costPrice: cost, sellingPrice: price, openingStock: stock, reorderLevel: 6 });
    }
    await e.execute(token, 'customer.save', { name: 'Sample Customer', phone: '0200000000' });
    e.endSession(token);
    await syncNow(e);
    lines.push(`Shop sign-in    owner / ${ownerPassword}    or    cashier / ${ownerPassword}   (SAMPLE data, shown once)`);
  } else lines.push(`Activation      server ${API}   code ${code}`);
} else lines.push('Shop laptop     already activated - sign in with the staff logins you created');

console.log(['', 'Mansora demo stack is running (development only):', `  Shop laptop app   ${laptop.url}`, '  Admin dashboard   http://127.0.0.1:5174', `  Cloud API         ${API}`, '', ...lines.map((l) => `  ${l}`), '', 'Press Ctrl+C to stop.'].join('\n'));
