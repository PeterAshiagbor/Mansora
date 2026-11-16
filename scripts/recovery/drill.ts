/**
 * Audit F19: scripted laptop-loss recovery drill. Disposable synthetic data only.
 *
 *   npx tsx scripts/recovery/drill.ts
 *
 * Runs a real API on embedded PostgreSQL and a real shop engine, then:
 *   1. trades through a day: sales, credit, a refund, an expense; syncs; makes an encrypted backup at midday;
 *   2. trades on and syncs; then makes sales while offline that are neither synced nor backed up;
 *   3. "loses" the laptop, restores the midday backup on a replacement, catches up from the cloud, and
 *   4. checks every figure against the cloud copy, measures recovery time and counts what was lost (RPO).
 * Prints a Markdown record for docs/disaster-recovery. It does not touch Railway or any real shop.
 */
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openEngine, restoreBackupFile, syncNow } from '../../apps/desktop/src/core';
import { startCloud } from '../../tests/cloud';
import { CASHIER, login, makeShop, MANAGER, tempDir, uuid } from '../../tests/helpers';

const cloud = await startCloud();
const C = await cloud.createClient('Recovery Drill Mart');
const s = await makeShop({ apiUrl: cloud.url, code: C.code, fetch });
const approver = { username: MANAGER.username, password: MANAGER.password };
const sell = (run: typeof s.run, token: string, productId: string, qty: number, tenders = [{ method: 'cash', amount: 1_000_000 }]) =>
  run(token, 'sale.complete', { id: uuid(), lines: [{ productId, quantity: qty }], tenders });
const net = { online: true };
const flaky: typeof fetch = (url, init) => (net.online ? fetch(url, init) : Promise.reject(new TypeError('fetch failed (offline)')));
s.engine.setMeta('api_url', cloud.url);
(s.engine as any).fetch = flaky;

// 1. Morning trade.
const customer = (await s.run(s.owner, 'customer.save', { name: 'Drill Customer', phone: '0240000009' })).id;
for (let i = 0; i < 40; i++) await sell(s.run, s.cashier, s.products.milk, 1);
const credit = await s.run(s.cashier, 'sale.complete', { id: uuid(), customerId: customer, approver, lines: [{ productId: s.products.rice, quantity: 2 }], tenders: [{ method: 'credit', amount: 16_000 }] });
await s.run(s.manager, 'expense.create', { id: uuid(), category: 'Transport', description: 'Delivery', amount: 1500, expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'momo' });
await syncNow(s.engine);
const backup = await s.run(s.owner, 'backup.create', { passphrase: 'drill passphrase 2026' });
const backupAt = new Date().toISOString();

// 2. Afternoon trade, synced; then offline sales that only this laptop holds.
for (let i = 0; i < 25; i++) await sell(s.run, s.cashier, s.products.soap, 1);
const sale = await s.run(s.owner, 'sale.get', { id: credit.id });
await s.run(s.manager, 'shift.open', { openingFloat: 0 });
await s.run(s.manager, 'refund.create', { id: uuid(), saleId: credit.id, reason: 'Torn bag', lines: [{ saleItemId: sale.items[0].id, quantity: 1 }] });
await s.run(s.manager, 'credit.repay', { id: uuid(), creditAccountId: sale.credit.id, amount: 3000, method: 'cash' });
const lastSync = await syncNow(s.engine);
const lastSyncAt = new Date().toISOString();
net.online = false;
for (let i = 0; i < 5; i++) await sell(s.run, s.cashier, s.products.milk, 1);
const unprotected = (await s.run(s.owner, 'sync.status', {})).unprotected as number;
const original = {
  sales: (s.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n as number,
};
s.engine.db.close(); // 3. the laptop is lost

// Restore on a replacement and catch up.
const t0 = performance.now();
const dir = tempDir('mansora-drill-');
restoreBackupFile(backup.path, 'drill passphrase 2026', join(dir, 'mansora.db'), 'replacement-drill-key');
const e = openEngine({ dataDir: dir, dbKey: 'replacement-drill-key', fetch });
e.setMeta('restore_pending_reconcile', '1');
const catchUp = await syncNow(e);
const rto = performance.now() - t0;

// 4. Verify against the cloud.
const local = (sql: string) => (e.db.prepare(sql).get() as any).v;
const remote = await cloud.db.tenant(C.id, async (q) => ({
  sales: Number((await q(`SELECT COUNT(*) AS v FROM sales`))[0].v),
  salesTotal: Number((await q(`SELECT COALESCE(SUM(total), 0) AS v FROM sales`))[0].v),
  refunds: Number((await q(`SELECT COALESCE(SUM(amount), 0) AS v FROM refunds`))[0].v),
  credit: Number((await q(`SELECT COALESCE(SUM(outstanding_balance), 0) AS v FROM credit_accounts`))[0].v),
  stock: Number((await q(`SELECT COALESCE(SUM(quantity), 0) AS v FROM stock_balances`))[0].v),
}));
const restored = {
  sales: local('SELECT COUNT(*) AS v FROM sales'), salesTotal: local('SELECT COALESCE(SUM(total), 0) AS v FROM sales'), refunds: local('SELECT COALESCE(SUM(amount), 0) AS v FROM refunds'),
  credit: local('SELECT COALESCE(SUM(outstanding_balance), 0) AS v FROM credit_accounts'), stock: local('SELECT COALESCE(SUM(quantity), 0) AS v FROM stock_balances'),
};
const cashier = await login(e, CASHIER);
await e.execute(cashier, 'shift.close', { countedCash: 0 }).catch(() => {});
await e.execute(cashier, 'shift.open', { openingFloat: 0 });
const next = await sell((t, c, i) => e.execute(t, c, i), cashier, s.products.rice, 1);
const after = await syncNow(e);
const receipts = await cloud.db.tenant(C.id, (q) => q(`SELECT receipt_no, COUNT(*) AS n FROM sales GROUP BY 1 HAVING COUNT(*) > 1`));
const checks = [
  ['Restored sales equal the cloud copy', restored.sales === remote.sales],
  ['Sales value equals the cloud copy', restored.salesTotal === remote.salesTotal],
  ['Refunds equal the cloud copy', restored.refunds === remote.refunds],
  ['Customer credit equals the cloud copy', restored.credit === remote.credit],
  ['Stock units equal the cloud copy', restored.stock === remote.stock],
  ['Only the unsynced, unbacked-up sales are lost', original.sales - restored.sales === unprotected],
  ['Catch-up sync succeeded', catchUp.ok && catchUp.rejected === 0],
  ['New receipt number continues without collision', next.receiptNo === `R-${String(remote.sales + 1).padStart(6, '0')}` && receipts.length === 0],
  ['Cloud accepts the replacement laptop again', after.ok && after.rejected === 0],
] as const;
const pass = checks.every(([, ok]) => ok);
console.log(`# Laptop-loss recovery drill: ${new Date().toISOString().slice(0, 10)}

Environment: disposable container, embedded PostgreSQL and a real Mansora engine (scripts/recovery/drill.ts). Synthetic data. **Not** Railway, and **not** a physical Windows laptop.

| Measure | Result |
| --- | --- |
| Backup taken | ${backupAt} |
| Last successful sync before the loss | ${lastSyncAt} (pushed ${lastSync.pushed} changes) |
| Changes only on the lost laptop (not synced, not backed up) | ${unprotected} sale(s): the recovery point is the last sync |
| Sales on the lost laptop / after recovery | ${original.sales} / ${restored.sales} |
| Records added from the cloud during catch-up | ${(e.db.prepare(`SELECT detail FROM audit_logs WHERE action = 'sync.reconciled_after_restore'`).get() as any)?.detail ?? 'n/a'} |
| Recovery time (restore file, open, catch up from cloud) | ${(rto / 1000).toFixed(2)} s (excludes installing the app and fetching the backup file) |

| Check | Result |
| --- | --- |
${checks.map(([name, ok]) => `| ${name} | ${ok ? 'Pass' : '**FAIL**'} |`).join('\n')}

Overall: **${pass ? 'PASS' : 'FAIL'}**
`);
e.db.close();
await cloud.close();
process.exit(pass ? 0 : 1);
