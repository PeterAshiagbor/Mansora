import { expect, it } from 'vitest';
import { makeShop, stockOf, uuid } from '../helpers';

it('rejects unknown products even at zero and rolls back a mixed count before a valid retry', async () => {
  const shop = await makeShop();
  try {
    const snapshot = () => ({
      stock: stockOf(shop.engine, shop.products.rice),
      movements: shop.engine.db.prepare('SELECT * FROM inventory_movements ORDER BY rowid').all(),
      balances: shop.engine.db.prepare('SELECT * FROM stock_balances ORDER BY product_id').all(),
      audit: shop.engine.db.prepare('SELECT * FROM audit_logs ORDER BY rowid').all(),
      outbox: shop.engine.db.prepare('SELECT * FROM outbox ORDER BY seq').all(),
    });
    const before = snapshot();
    const unknown = { productId: uuid(), counted: 0 };
    await expect(shop.run(shop.owner, 'stock.count', { lines: [unknown] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(snapshot()).toEqual(before);
    const valid = { productId: shop.products.rice, counted: before.stock - 3 };
    await expect(shop.run(shop.owner, 'stock.count', { lines: [valid, unknown] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(snapshot()).toEqual(before);
    await expect(shop.run(shop.owner, 'stock.count', { lines: [valid, valid] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(snapshot()).toEqual(before);
    expect(await shop.run(shop.owner, 'stock.count', { lines: [valid] })).toMatchObject({ adjusted: 1 });
    expect(stockOf(shop.engine, valid.productId)).toBe(valid.counted);
    expect(await shop.run(shop.owner, 'stock.count', { lines: [valid] })).toMatchObject({ adjusted: 0 });
    expect(shop.engine.db.prepare("SELECT quantity_delta FROM inventory_movements WHERE type='STOCK_COUNT_ADJUSTMENT' AND product_id=?").all(valid.productId)).toEqual([{ quantity_delta: -3 }]);
    expect(await shop.run(shop.owner, 'stock.count', { lines: [{ productId: shop.products.milk, counted: 0 }] })).toMatchObject({ adjusted: 1 });
    expect(stockOf(shop.engine, shop.products.milk)).toBe(0);
  } finally { shop.engine.db.close(); }
});
