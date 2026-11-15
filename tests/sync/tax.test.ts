import { expect, it } from 'vitest';
import { defaultTaxConfig, SYNC_TABLES } from '../../packages/domain/src';
import { Ctx, createEngine, openDatabase, syncNow } from '../../apps/desktop/src/core';
import { importSnapshot } from '../../apps/desktop/src/core/restore';
import { startCloud } from '../cloud';
import { makeShop, tempDir, uuid } from '../helpers';

it('syncs VAT evidence and snapshots idempotently, isolates tenants and restores the complete VAT return', async () => {
  const cloud = await startCloud();
  const client = await cloud.createClient('VAT sync shop');
  const other = await cloud.createClient('Other shop');
  const shop = await makeShop({ apiUrl: cloud.url, code: client.code, fetch, now: () => new Date('2026-11-15T12:00:00Z') });
  const restored = createEngine({ db: openDatabase(':memory:'), dataDir: tempDir(), now: () => new Date('2026-11-15T12:00:00Z') });
  try {
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'C-TIN', vatNumber: 'V-VAT', reason: 'Verified registration' });
    await shop.run(shop.owner, 'product.save', { id: shop.products.milk, name: 'Milk', sellingPrice: 1200, taxClass: 'standard' });
    await shop.run(shop.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: shop.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 1200 }] });
    await shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'input', date: '2026-11-01', invoiceDate: '2026-11-01', reference: 'VAT-INV', supplierTin: 'SUP', base: 10000, vat: 1500, nhil: 250, getfund: 250, reason: 'Eligible stock invoice', evidenceConfirmed: true });
    expect(await syncNow(shop.engine)).toMatchObject({ ok: true, pending: 0, rejected: 0 });
    expect(await syncNow(shop.engine)).toMatchObject({ ok: true, pushed: 0 });
    expect(await cloud.db.tenant(other.id, q => q('SELECT * FROM tax_records'))).toEqual([]);
    await expect(cloud.db.platform(q => q('SELECT * FROM tax_records'))).rejects.toThrow();
    const snapshot = await cloud.db.tenant(client.id, async q => {
      const result: Record<string, unknown> = {};
      for (const [table, spec] of Object.entries(SYNC_TABLES)) result[table] = await q(`SELECT ${Object.keys(spec.cols).join(', ')} FROM ${table}`);
      return result;
    });
    importSnapshot(new Ctx(restored, 'restore', null), snapshot);
    const actor = restored.loadUser((shop.engine.db.prepare("SELECT id FROM users WHERE role = 'owner'").get() as any).id)!;
    const ctx = new Ctx(restored, 'tax.report', actor);
    const { vatReport } = await import('../../apps/desktop/src/core/tax');
    const before = await shop.run(shop.owner, 'tax.report', { month: '2026-11' });
    const after = vatReport(ctx, '2026-11');
    expect(after.buckets).toEqual(before.buckets);
    expect(after.config).toEqual(before.config);
    expect(after.output).toEqual(before.output);
  } finally {
    restored.db.close(); shop.engine.db.close(); await cloud.close();
  }
});
