import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateEventRows } from '@mansora/domain';
import { makeShop } from '../helpers';

describe('C60 suppliers, purchase history and reordering', () => {
  it('keeps fuller supplier details, their purchase history, and lists what needs reordering by supplier', async () => {
    const s = await makeShop();
    const { id } = await s.run(s.owner, 'supplier.save', { name: 'Kofi Wholesale', phone: '0244000000', momoNumber: '0244000001', location: 'Makola Market', supplies: 'Rice, oil' });
    s.engine.db.prepare('UPDATE products SET reorder_level = 1000 WHERE id = ?').run(s.products.milk); // make milk due for reordering
    await s.run(s.owner, 'purchase.receive', { id: randomUUID(), supplierId: id, reference: 'INV-1', items: [{ productId: s.products.milk, quantity: 2, unitCost: 900 }] });

    const [row] = await s.run(s.owner, 'supplier.list');
    expect(row).toMatchObject({ name: 'Kofi Wholesale', momo_number: '0244000001', location: 'Makola Market', supplies: 'Rice, oil', purchases: 1, total_bought: 1800 });
    expect((await s.run(s.manager, 'supplier.list'))[0].total_bought).toBe(1800); // managers may see costs by default
    const history = await s.run(s.owner, 'supplier.get', { id });
    expect(history.purchases).toHaveLength(1);
    expect(history.products.map((p: any) => p.id)).toContain(s.products.milk);

    const reorder = await s.run(s.owner, 'stock.reorderList');
    for (const r of reorder) expect(r.quantity).toBeLessThanOrEqual(r.reorder_level);
    const milk = reorder.find((r: any) => r.id === s.products.milk);
    expect(milk).toMatchObject({ supplier: { name: 'Kofi Wholesale' }, reorder_level: 1000 });
    expect(milk.suggested).toBe(2000 - milk.quantity);
    await expect(s.run(s.cashier, 'supplier.list')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('accepts supplier rows from a laptop that predates the new columns', () => {
    const old = { id: randomUUID(), name: 'Old laptop supplier', phone: null, notes: null, updated_at: new Date().toISOString() };
    expect(validateEventRows({ suppliers: [old] } as any).suppliers).toHaveLength(1);
    expect(() => validateEventRows({ suppliers: [{ ...old, unknown: 'x' }] } as any)).toThrow();
  });
});
