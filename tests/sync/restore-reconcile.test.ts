/**
 * Audit F04: a laptop restored from a backup file that is older than the cloud copy catches up before selling,
 * continues receipt numbering without collisions, and the cloud accepts its stock updates again.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openEngine, restoreBackupFile, syncNow } from '../../apps/desktop/src/core';
import { startCloud, type Cloud } from '../cloud';
import { CASHIER, expectCode, login, makeShop, OWNER, tempDir, uuid } from '../helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

describe('restore from an older backup file', () => {
  it('reconciles with the cloud, keeps numbering unique and converges stock', async () => {
    const C = await cloud.createClient('Restore Reconcile Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: C.code, fetch });
    const sell = (run: typeof s.run, token: string, qty: number) => run(token, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: qty }], tenders: [{ method: 'cash', amount: 100_000 }] });
    for (let i = 0; i < 3; i++) await sell(s.run, s.cashier, 1);   // R-000001..3
    // New synced data from the hardening: a ledger record and a customer TIN reach the cloud.
    await s.run(s.owner, 'clock.acknowledge', { reason: 'Clock checked at go-live' });
    await s.run(s.owner, 'customer.save', { name: 'Ama Retail', tin: 'C0012345678' });
    const first = await syncNow(s.engine);
    expect(first).toMatchObject({ ok: true, rejected: 0 });
    const synced = await cloud.db.tenant(C.id, async (q) => ({ ledger: (await q(`SELECT kind FROM ledger_records`)).map((r: any) => r.kind), tin: (await q(`SELECT tin FROM customers`))[0]?.tin }));
    expect(synced).toEqual({ ledger: ['clock_override'], tin: 'C0012345678' });
    const passphrase = 'correct horse battery';
    const backup = await s.run(s.owner, 'backup.create', { passphrase });
    for (let i = 0; i < 2; i++) await sell(s.run, s.cashier, 2);   // R-000004..5, after the backup
    expect((await syncNow(s.engine)).ok).toBe(true);
    // Milk: 50 opening - 3 - 4 = 43 on the original laptop and in the cloud.
    expect((s.engine.db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(s.products.milk) as any).quantity).toBe(43);
    s.engine.db.close();

    // The laptop is lost; the owner restores the older backup on a replacement.
    const dir = tempDir('mansora-restore-reconcile-');
    restoreBackupFile(backup.path, passphrase, join(dir, 'mansora.db'), 'replacement-key');
    const e = openEngine({ dataDir: dir, dbKey: 'replacement-key', fetch });
    e.setMeta('restore_pending_reconcile', '1'); // set by the desktop app's restore handler
    const run = (t: string | null, c: string, i?: unknown) => e.execute(t, c, i);
    const cashier = await login(e, CASHIER);
    await run(cashier, 'shift.close', { countedCash: 0 }).catch(() => {});
    await run(cashier, 'shift.open', { openingFloat: 0 }).catch(() => {});
    await expectCode(sell(run, cashier, 1), 'RECONCILE_REQUIRED');

    const out = await syncNow(e);
    expect(out.ok).toBe(true);
    expect((e.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n).toBe(5);
    expect((e.db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(s.products.milk) as any).quantity).toBe(43);
    expect(e.meta('restore_pending_reconcile')).toBeUndefined();

    const next = await sell(run, cashier, 1);
    expect(next.receiptNo).toBe('R-000006');
    expect((await syncNow(e)).ok).toBe(true);
    // Cloud: 6 distinct receipts, and the stock balance followed the restored laptop (43 - 1 = 42).
    const cloudRows = await cloud.db.tenant(C.id, async (q) => ({
      receipts: (await q(`SELECT receipt_no FROM sales ORDER BY receipt_no`)).map((r: any) => r.receipt_no),
      milk: (await q(`SELECT quantity FROM stock_balances WHERE product_id = $1`, [s.products.milk]))[0].quantity,
    }));
    expect(cloudRows.receipts).toEqual(['R-000001', 'R-000002', 'R-000003', 'R-000004', 'R-000005', 'R-000006']);
    expect(Number(cloudRows.milk)).toBe(42);
    expect(OWNER.username).toBe('ama');
    e.db.close();
  });

  it('can continue offline after a restore, with numbering moved to a new block', async () => {
    const C = await cloud.createClient('Restore Offline Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: C.code, fetch });
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 100_000 }] });
    s.engine.setMeta('restore_pending_reconcile', '1');
    await expectCode(s.run(s.manager, 'sync.continueOffline', { reason: 'No internet' }), 'PERMISSION_DENIED');
    const r = await s.run(s.owner, 'sync.continueOffline', { reason: 'No internet at the shop' });
    expect(r.numbering.R).toBe('1 -> 100001');
    const sale = await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 100_000 }] });
    expect(sale.receiptNo).toBe('R-100001');
    s.engine.db.close();
  });
});
