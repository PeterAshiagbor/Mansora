import { expect, it } from 'vitest';
import { makeShop, stockOf, uuid } from '../helpers';

it('rejects an unsafe sale cost without persisting financial, stock, audit or outbox changes, then accepts a valid retry', async () => {
  const shop = await makeShop();
  try {
    const { id: productId } = await shop.run(shop.owner, 'product.save', {
      name: 'Synthetic precision boundary', sellingPrice: 1, costPrice: 100_000_000_000, openingStock: 10_000_000,
    });
    const tables = ['sales', 'sale_items', 'payments', 'inventory_movements', 'audit_logs', 'outbox'];
    const counts = () => tables.map(table => (shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    const before = counts();
    const id = uuid();
    await expect(shop.run(shop.cashier, 'sale.complete', { id,
      lines: [{ productId, quantity: 10_000_000 }], tenders: [{ method: 'cash', amount: 10_000_000 }],
    })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(counts()).toEqual(before);
    expect(stockOf(shop.engine, productId)).toBe(10_000_000);
    const retry = { id, lines: [{ productId, quantity: 1 }], tenders: [{ method: 'cash' as const, amount: 1 }] };
    expect(await shop.run(shop.cashier, 'sale.complete', retry)).toMatchObject({ id, total: 1 });
    const committed = counts();
    expect(stockOf(shop.engine, productId)).toBe(9_999_999);
    expect(shop.engine.db.prepare('SELECT cost_total FROM sales WHERE id = ?').get(id)).toEqual({ cost_total: 100_000_000_000 });
    expect(await shop.run(shop.cashier, 'sale.complete', retry)).toMatchObject({ id, duplicate: true });
    expect(counts()).toEqual(committed);
    expect(stockOf(shop.engine, productId)).toBe(9_999_999);
  } finally { shop.engine.db.close(); }
});
