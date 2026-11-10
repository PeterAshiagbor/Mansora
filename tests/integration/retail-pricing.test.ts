import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grossMarginBps, unitCostFromCarton } from '@mansora/domain';
import { buildPreview, suggestMapping, toXlsx } from '../../apps/desktop/src/core/importer';
import { CASHIER, expectCode, makeShop, MANAGER, OWNER, stockOf } from '../helpers';

const existing = () => ({ barcodes: new Set<string>(), skus: new Set<string>(), names: new Set<string>() });
describe('carton costing and margins', () => {
  it('uses integer rounding and rejects invalid carton quantities', () => {
    expect(unitCostFromCarton(10_000, 24)).toBe(417);
    expect(unitCostFromCarton(1, 2)).toBe(1);
    expect(unitCostFromCarton(10_000, 1)).toBe(10_000);
    expect(unitCostFromCarton(0, 24)).toBe(0);
    expect(unitCostFromCarton(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
    for (const qty of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => unitCostFromCarton(100, qty)).toThrow();
    expect(() => unitCostFromCarton(-1, 24)).toThrow();
    expect(grossMarginBps(600, 417)).toBe(3050);
    expect(grossMarginBps(300, 417)).toBe(-3900);
    expect(grossMarginBps(0, 417)).toBeNull();
  });
  it('validates carton pairs, conflicting unit costs and unsafe quantities before import', () => {
    const table = [
      ['Name', 'Carton cost', 'Units per carton', 'Cost price', 'Selling price'],
      ['Rounded', '100', '24', '', '6'],
      ['Whole carton', '100', '1', '100', '120'],
      ['Conflict', '100', '24', '4.16', '6'],
      ['Missing count', '100', '', '', '6'],
      ['Missing cost', '', '24', '', '6'],
      ['Fraction', '100', '2.4', '', '6'],
      ['Huge', '100', '9007199254740992', '', '6'],
      ['Legacy unit cost', '', '', '4.17', '6'],
    ];
    const rows = buildPreview(table, suggestMapping(table[0]), existing());
    expect(rows[0].data.costPrice).toBe(417);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].data.costPrice).toBe(10_000);
    for (const row of rows.slice(2, 7)) expect(row.errors.length).toBeGreaterThan(0);
    expect(rows[7].errors).toEqual([]);
    expect(rows[7].data.costPrice).toBe(417);
  });
  it('imports an actual Excel workbook through preview/commit without duplicating opening stock', async () => {
    const s = await makeShop();
    try {
      const bytes = await toXlsx([{ name: 'Products', rows: [['Name', 'SKU', 'Carton cost', 'Units per carton', 'Selling price', 'Opening stock'], ['Carton product', 'CARTON-TEST', '100.00', 24, '6.00', 48]] }]);
      const file = { fileName: 'cartons.xlsx', contentBase64: bytes.toString('base64') };
      await expectCode(s.run(s.cashier, 'import.preview', file), 'PERMISSION_DENIED');
      const preview = await s.run(s.owner, 'import.preview', file);
      expect(preview.rows[0].errors).toEqual([]);
      expect(preview.rows[0].data).toMatchObject({ costPrice: 417, sellingPrice: 600, openingStock: 48 });
      await expectCode(s.run(s.owner, 'import.commit', { ...file, mapping: preview.mapping, confirmOpeningStock: false }), 'CONFIRM_OPENING_STOCK');
      expect(await s.run(s.owner, 'import.commit', { ...file, mapping: preview.mapping, confirmOpeningStock: true })).toMatchObject({ created: 1, openingStockApplied: true });
      const product = await s.run(s.owner, 'product.lookup', { code: 'CARTON-TEST' });
      expect(product).toMatchObject({ cost_price: 417, selling_price: 600, quantity: 48, average_cost: 417 });
      expect(await s.run(s.cashier, 'product.lookup', { code: 'CARTON-TEST' })).not.toHaveProperty('cost_price');
      await expectCode(s.run(s.owner, 'import.commit', { ...file, mapping: preview.mapping, confirmOpeningStock: true }), 'ALREADY_IMPORTED');
      expect(stockOf(s.engine, product.id)).toBe(48);
    } finally { s.engine.db.close(); rmSync(s.dir, { recursive: true, force: true }); }
  });
});

describe('discount authorisation at the engine boundary', () => {
  it('keeps approval lockouts across rejected sales, then permits an authorised audited retry', async () => {
    let now = new Date('2026-01-10T12:00:00Z');
    const s = await makeShop({ now: () => now });
    try {
      const input = { id: randomUUID(), lines: [{ productId: s.products.soap, quantity: 1, discount: 100 }], tenders: [{ method: 'cash', amount: 500 }] };
      const counts = () => ['sales', 'audit_logs', 'outbox'].map((t) => (s.engine.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);
      const before = counts();
      await expectCode(s.run(s.cashier, 'sale.complete', input), 'APPROVAL_REQUIRED');
      await expectCode(s.run(s.cashier, 'sale.complete', { ...input, approver: CASHIER }), 'PERMISSION_DENIED');
      for (let n = 0; n < 5; n++) await expectCode(s.run(s.cashier, 'sale.complete', { ...input, approver: { username: MANAGER.username, password: randomUUID() } }), 'INVALID_CREDENTIALS');
      await expectCode(s.run(s.cashier, 'sale.complete', { ...input, approver: MANAGER }), 'ACCOUNT_LOCKED');
      expect(stockOf(s.engine, s.products.soap)).toBe(30);
      expect(counts()).toEqual(before);
      now = new Date(now.getTime() + 61_000);
      const done = await s.run(s.cashier, 'sale.complete', { ...input, approver: MANAGER });
      expect(done.total).toBe(400);
      expect((s.engine.db.prepare('SELECT discount_approved_by FROM sales WHERE id = ?').get(input.id) as any).discount_approved_by).toBe(s.engine.verifyCredentials(MANAGER.username, MANAGER.password).id);
      expect(stockOf(s.engine, s.products.soap)).toBe(29);
    } finally { s.engine.db.close(); rmSync(s.dir, { recursive: true, force: true }); }
  });
  it('requires owner approval even just above a configured percentage, and locks failed owner approvals', async () => {
    const s = await makeShop();
    try {
      await s.run(s.owner, 'business.update', { name: 'Test shop', phone: '', address: '', receiptFooter: '', lockMinutes: 10, allowNegativeStock: false, maxDiscountPercent: 10 });
      const product = await s.run(s.owner, 'product.save', { name: 'Ceiling boundary', sellingPrice: 100_001, costPrice: 50_000, openingStock: 10 });
      const input = { id: randomUUID(), lines: [{ productId: product.id, quantity: 1 }], cartDiscount: 10_001, tenders: [{ method: 'cash', amount: 100_001 }] };
      await expectCode(s.run(s.cashier, 'sale.complete', { ...input, approver: MANAGER }), 'OWNER_APPROVAL_REQUIRED');
      for (let n = 0; n < 5; n++) await expectCode(s.run(s.cashier, 'sale.complete', { ...input, approver: { username: OWNER.username, password: randomUUID() } }), 'INVALID_CREDENTIALS');
      await expectCode(s.run(s.cashier, 'sale.complete', { ...input, approver: OWNER }), 'ACCOUNT_LOCKED');
      expect(stockOf(s.engine, product.id)).toBe(10);
    } finally { s.engine.db.close(); rmSync(s.dir, { recursive: true, force: true }); }
  });
});
