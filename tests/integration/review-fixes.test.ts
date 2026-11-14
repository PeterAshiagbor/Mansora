import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { movingAverageCost } from '../../packages/domain/src';
import { parseCsv } from '../../apps/desktop/src/core/importer';
import { CASHIER, expectCode, login, makeShop } from '../helpers';

// Regression tests for the 2026-11-13 end-to-end review of the till's engine.
describe('engine review fixes', () => {
  it('keeps exact cost averages for very large stock values', () => {
    // 9,000,000 units at GHS 15,000,000 average: the products exceed 2^53 and used to lose pesewas.
    expect(movingAverageCost(9_000_000, 1_500_000_000, 1, 1_500_000_000)).toBe(1_500_000_000);
    expect(movingAverageCost(3, 100, 1, 101)).toBe(100); // 401/4 = 100.25 rounds down
    expect(movingAverageCost(1, 100, 1, 101)).toBe(101); // 100.5 rounds half up
  });

  it('reads a quote inside an unquoted CSV cell literally', () => {
    expect(parseCsv('Name,Price\nTV 32" LED,1200\nKettle,150\n')).toEqual([['Name', 'Price'], ['TV 32" LED', '1200'], ['Kettle', '150']]);
    expect(parseCsv('"Rice, 5kg",80\n')).toEqual([['Rice, 5kg', '80']]);
  });

  it('refuses impossible dates and reversed ranges instead of storing or hiding them', async () => {
    const s = await makeShop();
    await expectCode(s.run(s.owner, 'expense.create', { id: randomUUID(), category: 'Rent', description: 'Shop', amount: 100, expenseDate: '2026-13-45', paymentMethod: 'cash' }), 'INVALID_INPUT');
    await expectCode(s.run(s.owner, 'expense.list', { from: '2026-11-30', to: '2026-11-01' }), 'INVALID_INPUT');
    const customer = (await s.run(s.owner, 'customer.save', { name: 'Due Date Test' })).id;
    await expectCode(s.run(s.owner, 'sale.complete', { id: randomUUID(), lines: [{ productId: s.products.soap, quantity: 1 }], tenders: [{ method: 'credit', amount: 500 }], customerId: customer, dueDate: '2026-02-31' }), 'INVALID_INPUT');
  });

  it('keeps purchase costs with people allowed to see costs, and refuses duplicate stock-count lines', async () => {
    const s = await makeShop();
    await s.run(s.owner, 'purchase.receive', { items: [{ productId: s.products.milk, quantity: 2, unitCost: 1000 }] });
    const staff = (await s.run(s.owner, 'staff.list', {})).find((u: any) => u.username === CASHIER.username);
    await s.run(s.owner, 'staff.save', { id: staff.id, name: staff.name, username: staff.username, role: 'cashier', status: 'active', permissions: ['sale.create', 'product.view', 'shift.own', 'purchase.manage'] });
    const cashier = await login(s.engine, CASHIER);
    const list = await s.run(cashier, 'purchase.list', {});
    expect(list[0].total_cost).toBeUndefined();
    const detail = await s.run(cashier, 'purchase.get', { id: list[0].id });
    expect(detail.items[0].unit_cost).toBeUndefined();
    await expectCode(s.run(cashier, 'purchase.receive', { items: [{ productId: s.products.milk, quantity: 1, unitCost: 1 }] }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.owner, 'stock.count', { lines: [{ productId: s.products.rice, counted: 10 }, { productId: s.products.rice, counted: 12 }] }), 'INVALID_INPUT');
  });

  it('searches for % and _ literally, keeps the first revocation time, and signs out other sessions on a password change', async () => {
    const s = await makeShop();
    await s.run(s.owner, 'customer.save', { name: 'Plain Name' });
    expect(await s.run(s.owner, 'customer.list', { search: '%' })).toEqual([]);
    const grant = await s.run(s.owner, 'support.grant', { scope: 'reports', purpose: 'Test', hours: 1 });
    await s.run(s.owner, 'support.revoke', { id: grant.id });
    const first = s.engine.db.prepare('SELECT revoked_at FROM support_access_grants WHERE id = ?').get(grant.id) as any;
    expect(await s.run(s.owner, 'support.revoke', { id: grant.id })).toMatchObject({ alreadyEnded: true });
    expect(s.engine.db.prepare('SELECT revoked_at FROM support_access_grants WHERE id = ?').get(grant.id)).toEqual(first);

    const other = await login(s.engine, CASHIER);
    await s.run(s.cashier, 'auth.changePassword', { current: CASHIER.password, next: 'a-new-cashier-pass-1' });
    await s.run(s.cashier, 'app.state', {}); // this session continues
    await expectCode(s.run(other, 'sale.list', { from: '2026-01-01', to: '2026-01-01' }), 'NOT_SIGNED_IN');
  });
});

describe('R70-06 stock count of a product that does not exist', () => {
  it('refuses the whole count, changing nothing, instead of reporting success', async () => {
    const shop = await makeShop();
    const before = (shop.engine.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get() as any).n;
    await expect(shop.run(shop.owner, 'stock.count', { lines: [{ productId: shop.products.milk, counted: 1 }, { productId: randomUUID(), counted: 0 }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((shop.engine.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get() as any).n).toBe(before);
  });
});

