import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { openEngine, restoreBackupFile, summarise, verifyBackupFile } from '../../apps/desktop/src/core';
import { CASHIER, expectCode, login, makeShop, MANAGER, OWNER, stockOf, tempDir, TEST_DB_KEY, uuid } from '../helpers';

const cash = (amount: number) => [{ method: 'cash', amount }];

describe('TEST 03 - sale and stock deduction', () => {
  it('selling 3 of 20 leaves 17 with exactly one -3 movement', async () => {
    const s = await makeShop();
    const id = uuid();
    const res = await s.run(s.cashier, 'sale.complete', { id, lines: [{ productId: s.products.rice, quantity: 3 }], tenders: cash(30_000) });
    expect(res).toMatchObject({ total: 24_000, change: 6_000 });
    expect(stockOf(s.engine, s.products.rice)).toBe(17);
    const moves = s.engine.db.prepare(`SELECT quantity_delta FROM inventory_movements WHERE product_id = ? AND type = 'SALE'`).all(s.products.rice);
    expect(moves).toEqual([{ quantity_delta: -3 }]);

    // Submitting the same basket again (double click, retry) must not create a second sale.
    const again = await s.run(s.cashier, 'sale.complete', { id, lines: [{ productId: s.products.rice, quantity: 3 }], tenders: cash(30_000) });
    expect(again.duplicate).toBe(true);
    expect(stockOf(s.engine, s.products.rice)).toBe(17);
    expect(s.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 1 });
  });

  it('snapshots price and cost at sale time', async () => {
    const s = await makeShop();
    const id = uuid();
    await s.run(s.cashier, 'sale.complete', { id, lines: [{ productId: s.products.milk, quantity: 2 }], tenders: cash(2500) });
    await s.run(s.owner, 'product.save', { id: s.products.milk, name: 'Milk tin', sellingPrice: 1500, costPrice: 1100 });
    await s.run(s.owner, 'purchase.receive', { items: [{ productId: s.products.milk, quantity: 48, unitCost: 1100 }] });
    const sale = await s.run(s.owner, 'sale.get', { id });
    expect(sale.items[0]).toMatchObject({ unit_price: 1250, cost_snapshot: 900, line_total: 2500 });
    expect(sale.sale.cost_total).toBe(1800);
    // 48 on hand at 900 + 48 received at 1100 -> moving average 1000
    expect(s.engine.db.prepare('SELECT quantity, average_cost FROM stock_balances WHERE product_id = ?').get(s.products.milk)).toEqual({ quantity: 96, average_cost: 1000 });
  });

  it('blocks negative stock by default and prices from the catalogue, not the screen', async () => {
    const s = await makeShop();
    await expectCode(s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 21 }], tenders: cash(999_999) }), 'INSUFFICIENT_STOCK');
    expect(stockOf(s.engine, s.products.rice)).toBe(20);
    await expectCode(s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 1 }], tenders: cash(100) }), 'UNDERPAID');
    expect(s.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 0 });
  });

  it('completed sales and stock movements cannot be edited or deleted, even with direct SQL', async () => {
    const s = await makeShop();
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 1 }], tenders: cash(500) });
    for (const sql of ['UPDATE sales SET total = 1', 'DELETE FROM sales', 'UPDATE inventory_movements SET quantity_delta = 99', 'DELETE FROM payments', 'DELETE FROM audit_logs']) {
      expect(() => s.engine.db.exec(sql)).toThrow(/immutable|cannot be deleted/);
    }
  });
});

describe('TEST 06 - refunds', () => {
  it('partial refund references the sale, restocks eligible items and shows in reports', async () => {
    const s = await makeShop();
    const saleId = uuid();
    await s.run(s.cashier, 'sale.complete', { id: saleId, lines: [{ productId: s.products.milk, quantity: 4 }, { productId: s.products.soap, quantity: 2 }], tenders: cash(6000) });
    const sale = await s.run(s.cashier, 'sale.get', { id: saleId });
    const milk = sale.items.find((i: any) => i.product_id === s.products.milk);
    const soap = sale.items.find((i: any) => i.product_id === s.products.soap);
    const lines = [{ saleItemId: milk.id, quantity: 1, restock: true }, { saleItemId: soap.id, quantity: 1, restock: false }];

    // A cashier cannot refund alone...
    await expectCode(s.run(s.cashier, 'refund.create', { id: uuid(), saleId, reason: 'Wrong item', lines }), 'APPROVAL_REQUIRED');
    await expectCode(s.run(s.cashier, 'refund.create', { id: uuid(), saleId, reason: 'Wrong item', lines, approver: { username: CASHIER.username, password: CASHIER.password } }), 'PERMISSION_DENIED');
    // ...but can with a manager's approval.
    const refundId = uuid();
    const r = await s.run(s.cashier, 'refund.create', { id: refundId, saleId, reason: 'Wrong item', lines, approver: { username: MANAGER.username, password: MANAGER.password } });
    expect(r).toMatchObject({ amount: 1250 + 500, payout: 1750, creditReduction: 0 });

    const row: any = s.engine.db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
    expect(row.sale_id).toBe(saleId);
    expect(row.authorised_by).not.toBe(row.requested_by);
    expect(stockOf(s.engine, s.products.milk)).toBe(50 - 4 + 1); // restocked
    expect(stockOf(s.engine, s.products.soap)).toBe(30 - 2); // damaged return: not restocked

    const today = new Date().toISOString().slice(0, 10);
    const report = await s.run(s.owner, 'report.sales', { from: today, to: today });
    expect(report.totals).toMatchObject({ gross: 6000, refunds: 1750, net: 4250 });
    const profit = await s.run(s.owner, 'report.profit', { from: today, to: today });
    expect(profit.revenue).toBe(4250);
    expect(profit.cogs).toBe(4 * 900 + 2 * 333 - 900);

    // Cannot refund more than what remains eligible.
    await expectCode(s.run(s.manager, 'refund.create', { id: uuid(), saleId, reason: 'x', payoutMethod: 'momo', lines: [{ saleItemId: milk.id, quantity: 4 }] }), 'REFUND_EXCEEDS_SALE');
    await s.run(s.manager, 'refund.create', { id: uuid(), saleId, reason: 'rest', payoutMethod: 'momo', lines: [{ saleItemId: milk.id, quantity: 3 }, { saleItemId: soap.id, quantity: 1 }] });
    const total = s.engine.db.prepare('SELECT SUM(amount) AS v FROM refunds WHERE sale_id = ?').get(saleId) as any;
    expect(total.v).toBe(6000);
    await expectCode(s.run(s.manager, 'refund.create', { id: uuid(), saleId, reason: 'x', payoutMethod: 'momo', lines: [{ saleItemId: soap.id, quantity: 1 }] }), 'REFUND_EXCEEDS_SALE');
  });
});

describe('TEST 07 - credit sales and repayments', () => {
  it('a partial repayment lowers the balance and never creates a sale', async () => {
    const s = await makeShop();
    const customerId = (await s.run(s.manager, 'customer.save', { name: 'Yaw Darko', phone: '0244111222' })).id;
    const lines = [{ productId: s.products.rice, quantity: 2 }];
    const tenders = [{ method: 'cash', amount: 6000 }, { method: 'credit', amount: 10_000 }];
    await expectCode(s.run(s.cashier, 'sale.complete', { id: uuid(), lines, tenders, customerId }), 'APPROVAL_REQUIRED');
    await expectCode(s.run(s.manager, 'sale.complete', { id: uuid(), lines, tenders }), 'NO_OPEN_SHIFT');
    await s.run(s.manager, 'shift.open', { openingFloat: 0 });
    await expectCode(s.run(s.manager, 'sale.complete', { id: uuid(), lines, tenders }), 'CUSTOMER_REQUIRED');
    await s.run(s.manager, 'sale.complete', { id: uuid(), lines, tenders, customerId, dueDate: '2020-01-01' });

    let credit = await s.run(s.manager, 'credit.list', {});
    expect(credit).toMatchObject({ totalOutstanding: 10_000, totalOverdue: 10_000 });
    const acc = credit.accounts[0];
    await expectCode(s.run(s.manager, 'credit.repay', { id: uuid(), creditAccountId: acc.id, amount: 10_001, method: 'cash' }), 'REPAYMENT_TOO_LARGE');
    const repayId = uuid();
    expect(await s.run(s.manager, 'credit.repay', { id: repayId, creditAccountId: acc.id, amount: 4000, method: 'cash' })).toMatchObject({ outstanding: 6000 });
    expect((await s.run(s.manager, 'credit.repay', { id: repayId, creditAccountId: acc.id, amount: 4000, method: 'cash' })).duplicate).toBe(true);

    credit = await s.run(s.manager, 'credit.list', {});
    expect(credit.totalOutstanding).toBe(6000);
    expect(s.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 1 });
    expect(s.engine.db.prepare('SELECT COUNT(*) AS n FROM credit_repayments').get()).toEqual({ n: 1 });
    // The cash repayment is part of the receiving cashier's expected cash.
    const shift = await s.run(s.manager, 'shift.current', {});
    expect(shift.totals).toMatchObject({ cashSales: 6000, cashRepayments: 4000, expectedCash: 10_000 });
    await s.run(s.manager, 'credit.repay', { id: uuid(), creditAccountId: acc.id, amount: 6000, method: 'momo', reference: 'MM123' });
    expect((await s.run(s.manager, 'credit.list', { status: 'all' })).accounts[0]).toMatchObject({ outstanding_balance: 0, status: 'settled' });
  });

  it('refunding a credit sale cancels the debt before paying anything out', async () => {
    const s = await makeShop();
    await s.run(s.manager, 'shift.open', { openingFloat: 0 });
    const customerId = (await s.run(s.manager, 'customer.save', { name: 'Abena' })).id;
    const saleId = uuid();
    await s.run(s.manager, 'sale.complete', { id: saleId, lines: [{ productId: s.products.rice, quantity: 1 }], tenders: [{ method: 'credit', amount: 8000 }], customerId });
    const sale = await s.run(s.manager, 'sale.get', { id: saleId });
    const r = await s.run(s.manager, 'refund.create', { id: uuid(), saleId, reason: 'Returned', lines: [{ saleItemId: sale.items[0].id, quantity: 1 }] });
    expect(r).toMatchObject({ amount: 8000, creditReduction: 8000, payout: 0 });
    expect((await s.run(s.manager, 'credit.list', {})).totalOutstanding).toBe(0);
  });
});

describe('TEST 08 - cashier restrictions are enforced below the user interface', () => {
  it('denies restricted commands and data', async () => {
    const s = await makeShop();
    await expectCode(s.run(s.cashier, 'product.save', { id: s.products.rice, name: 'Rice 5kg', sellingPrice: 8000, costPrice: 1 }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'report.profit', { from: '2020-01-01', to: '2030-01-01' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'report.sales', { from: '2020-01-01', to: '2030-01-01' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'staff.list', {}), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'staff.save', { ...CASHIER, role: 'manager' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'stock.adjust', { productId: s.products.rice, type: 'MANUAL_CORRECTION', delta: 5, reason: 'x' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'export.business', { format: 'json' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'audit.list', { from: '2020-01-01', to: '2030-01-01' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.cashier, 'sale.delete', {}), 'UNKNOWN_COMMAND'); // there is no way to delete a sale at all
    await expectCode(s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 1, discount: 100 }], tenders: cash(500) }), 'APPROVAL_REQUIRED');
    await expectCode(s.run(null, 'product.list', {}), 'NOT_SIGNED_IN');

    // Cost prices are stripped from what a cashier receives.
    const products = await s.run(s.cashier, 'product.list', {});
    expect(products.length).toBe(3);
    expect(products.every((p: any) => !('cost_price' in p) && !('average_cost' in p))).toBe(true);

    // A cashier cannot open someone else's sale.
    await s.run(s.manager, 'shift.open', { openingFloat: 0 });
    const managerSale = uuid();
    await s.run(s.manager, 'sale.complete', { id: managerSale, lines: [{ productId: s.products.soap, quantity: 1 }], tenders: cash(500) });
    await expectCode(s.run(s.cashier, 'sale.get', { id: managerSale }), 'PERMISSION_DENIED');

    // Denied attempts are themselves audited.
    const denied = s.engine.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'permission.denied'`).get() as any;
    expect(denied.n).toBeGreaterThanOrEqual(6);
  });

  it('managers cannot manage staff, and nobody can create a second owner or disable the owner', async () => {
    const s = await makeShop();
    await expectCode(s.run(s.manager, 'staff.save', { name: 'X', username: 'xuser', role: 'cashier', password: 'password-1' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.owner, 'staff.save', { name: 'X', username: 'xuser', role: 'owner', password: 'password-1' }), 'OWNER_PROTECTED');
    const staff = await s.run(s.owner, 'staff.list', {});
    const cashier = staff.find((u: any) => u.username === CASHIER.username);
    // Disabling a user takes effect immediately, including for their live session.
    await s.run(s.owner, 'staff.save', { id: cashier.id, name: cashier.name, username: cashier.username, role: 'cashier', status: 'disabled' });
    await expectCode(s.run(s.cashier, 'product.list', {}), 'NOT_SIGNED_IN');
    await expectCode(login(s.engine, CASHIER), 'ACCOUNT_DISABLED');
  });

  it('locks the session after inactivity and throttles password guessing', async () => {
    let now = new Date('2026-11-09T09:00:00Z');
    const s = await makeShop({ now: () => now });
    now = new Date('2026-11-09T09:09:00Z');
    await s.run(s.cashier, 'product.list', {});
    now = new Date('2026-11-09T09:20:00Z');
    await expectCode(s.run(s.cashier, 'product.list', {}), 'SESSION_LOCKED');
    for (let i = 0; i < 5; i++) await expectCode(login(s.engine, { username: OWNER.username, password: 'wrong' }), 'INVALID_CREDENTIALS');
    await expectCode(login(s.engine, OWNER), 'ACCOUNT_LOCKED');
    now = new Date('2026-11-09T09:22:00Z');
    expect(await login(s.engine, OWNER)).toBeTruthy();
  });
});

describe('TEST 10 - cash shift reconciliation', () => {
  it('expected cash and variance are exact', async () => {
    const s = await makeShop(); // cashier shift open with a GHS 100.00 float
    const sale1 = uuid();
    await s.run(s.cashier, 'sale.complete', { id: sale1, lines: [{ productId: s.products.rice, quantity: 2 }], tenders: cash(20_000) }); // 16,000 cash
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 4 }], tenders: [{ method: 'momo', amount: 3000 }, { method: 'cash', amount: 2000 }] }); // 2,000 cash
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 2 }], tenders: [{ method: 'card', amount: 1000 }] });
    const sale = await s.run(s.cashier, 'sale.get', { id: sale1 });
    const approver = { username: MANAGER.username, password: MANAGER.password };
    await s.run(s.cashier, 'refund.create', { id: uuid(), saleId: sale1, reason: 'Damaged bag', lines: [{ saleItemId: sale.items[0].id, quantity: 1 }], approver }); // -8,000 cash
    await s.run(s.cashier, 'shift.cashMovement', { direction: 'out', amount: 5000, reason: 'Banked', approver });
    await expectCode(s.run(s.cashier, 'shift.cashMovement', { direction: 'out', amount: 5000, reason: 'No approval' }), 'APPROVAL_REQUIRED');
    await s.run(s.manager, 'expense.create', { id: uuid(), category: 'Transport', description: 'Delivery', amount: 700, expenseDate: '2026-11-09', paymentMethod: 'momo' }); // not from till

    const expected = 10_000 + 16_000 + 2000 - 8000 - 5000;
    const current = await s.run(s.cashier, 'shift.current', {});
    expect(current.totals).toMatchObject({ cashSales: 18_000, cashRefunds: 8000, cashOut: 5000, nonCashSales: 4000, expectedCash: expected, salesCount: 3 });
    const closed = await s.run(s.cashier, 'shift.close', { countedCash: expected - 250, notes: 'Short' });
    expect(closed).toMatchObject({ expectedCash: expected, variance: -250 });
    await expectCode(s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 1 }], tenders: cash(500) }), 'NO_OPEN_SHIFT');
    await expectCode(s.run(s.cashier, 'shift.review', { id: closed.id }), 'PERMISSION_DENIED');
    await s.run(s.manager, 'shift.review', { id: closed.id, reviewNotes: 'Discussed with cashier' });
    const row: any = s.engine.db.prepare('SELECT * FROM shifts WHERE id = ?').get(closed.id);
    expect(row).toMatchObject({ status: 'reviewed', variance: -250, expected_cash: expected, counted_cash: expected - 250 });
  });
});

describe('TEST 15 - atomicity', () => {
  it('a failure just before commit leaves no trace of the sale', async () => {
    let failNext = false;
    const s = await makeShop({ beforeCommit: (c) => { if (failNext && c === 'sale.complete') throw new Error('simulated crash'); } });
    const before = summarise(s.engine.db);
    failNext = true;
    await expect(s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 3 }, { productId: s.products.milk, quantity: 1 }], tenders: cash(50_000) })).rejects.toThrow('simulated crash');
    failNext = false;
    const after = summarise(s.engine.db);
    expect({ ...after, createdAt: '' }).toEqual({ ...before, createdAt: '' });
    for (const t of ['sales', 'sale_items', 'payments']) expect(s.engine.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    expect(stockOf(s.engine, s.products.rice)).toBe(20);
    // The receipt counter rolled back too: the next real sale gets the first number.
    const ok = await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 1 }], tenders: cash(8000) });
    expect(ok.receiptNo).toBe('R-000001');
  });

  it('every sale has matching payments, movements and exactly one sync event', async () => {
    const s = await makeShop();
    for (let i = 0; i < 25; i++) await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 1 }, { productId: s.products.soap, quantity: 1 }], tenders: cash(2000) });
    const db = s.engine.db;
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales s WHERE s.total <> (SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id)').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales s WHERE s.total <> (SELECT SUM(line_total) FROM sale_items i WHERE i.sale_id = s.id)').get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE type = 'sale.complete'`).get()).toEqual({ n: 25 });
    // Balance always equals the sum of the movement ledger.
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_balances b WHERE b.quantity <> (SELECT COALESCE(SUM(quantity_delta), 0) FROM inventory_movements m WHERE m.product_id = b.product_id)').get()).toEqual({ n: 0 });
  });
});

describe('inventory operations', () => {
  it('damages, corrections and stock counts all go through the movement ledger', async () => {
    const s = await makeShop();
    await s.run(s.manager, 'stock.adjust', { productId: s.products.soap, type: 'DAMAGE', delta: -2, reason: 'Water damage' });
    await expectCode(s.run(s.manager, 'stock.adjust', { productId: s.products.soap, type: 'DAMAGE', delta: 2, reason: 'x' }), 'INVALID_QUANTITY');
    await expectCode(s.run(s.manager, 'stock.adjust', { productId: s.products.soap, type: 'MANUAL_CORRECTION', delta: -500, reason: 'x' }), 'INSUFFICIENT_STOCK');
    const count = await s.run(s.manager, 'stock.count', { lines: [{ productId: s.products.soap, counted: 25 }, { productId: s.products.rice, counted: 20 }] });
    expect(count.adjusted).toBe(1);
    expect(stockOf(s.engine, s.products.soap)).toBe(25);
    const moves = await s.run(s.manager, 'stock.movements', { productId: s.products.soap });
    expect(moves.map((m: any) => [m.type, m.quantity_delta])).toEqual([['STOCK_COUNT_ADJUSTMENT', -3], ['DAMAGE', -2], ['OPENING_STOCK', 30]]);
    const overview = await s.run(s.owner, 'stock.overview', {});
    expect(overview.summary.valuation).toBe(20 * 6000 + 50 * 900 + 25 * 333);
  });

  it('barcodes are unique and scanner lookup is exact', async () => {
    const s = await makeShop();
    await expectCode(s.run(s.owner, 'product.save', { name: 'Other', barcode: '6001000000011', sellingPrice: 100 }), 'CONFLICT');
    expect(await s.run(s.cashier, 'product.lookup', { code: '6001000000028' })).toMatchObject({ name: 'Milk tin', selling_price: 1250 });
    expect(await s.run(s.cashier, 'product.lookup', { code: '600100000002' })).toBeNull();
  });
});

describe('import idempotency', () => {
  const csv = ['Name,SKU,Barcode,Category,Cost price,Selling price,Opening stock,Reorder level', 'Sugar 1kg,SUG1,6009000000017,Groceries,12.50,15.00,40,10', '"Oil, 1L",OIL1,6009000000024,Groceries,30,36.5,12,4', 'Rice 5kg,,,Groceries,60,80,99,5', 'Bad row,,,,x,,1,'].join('\n');
  const file = (text: string) => ({ fileName: 'products.csv', contentBase64: Buffer.from(text).toString('base64') });

  it('previews, validates, detects duplicates and never doubles opening stock on retry', async () => {
    const s = await makeShop();
    const p = await s.run(s.owner, 'import.preview', file(csv));
    expect(p.mapping).toMatchObject({ name: 'Name', selling_price: 'Selling price', opening_stock: 'Opening stock' });
    expect(p.rows.map((r: any) => [r.errors.length > 0, !!r.duplicate])).toEqual([[false, false], [false, false], [false, true], [true, false]]);
    await expectCode(s.run(s.owner, 'import.commit', { ...file(csv), mapping: p.mapping, confirmOpeningStock: true }), 'IMPORT_HAS_ERRORS');

    const clean = csv.split('\n').slice(0, 4).join('\n');
    const p2 = await s.run(s.owner, 'import.preview', file(clean));
    await expectCode(s.run(s.owner, 'import.commit', { ...file(clean), mapping: p2.mapping, confirmOpeningStock: false }), 'CONFIRM_OPENING_STOCK');
    const done = await s.run(s.owner, 'import.commit', { ...file(clean), mapping: p2.mapping, confirmOpeningStock: true });
    expect(done).toMatchObject({ created: 2, skipped: 1, openingStockApplied: true });
    const sugar = await s.run(s.owner, 'product.lookup', { code: '6009000000017' });
    expect(sugar).toMatchObject({ quantity: 40, cost_price: 1250, selling_price: 1500, category_name: 'Groceries' });
    expect(stockOf(s.engine, s.products.rice)).toBe(20); // existing product untouched

    await expectCode(s.run(s.owner, 'import.commit', { ...file(clean), mapping: p2.mapping, confirmOpeningStock: true }), 'ALREADY_IMPORTED');
    // Same rows in a re-saved file: every row is now a duplicate, so nothing is added.
    const again = await s.run(s.owner, 'import.commit', { ...file(clean + '\n'), mapping: p2.mapping, confirmOpeningStock: true });
    expect(again).toMatchObject({ created: 0, skipped: 3 });
    expect((await s.run(s.owner, 'product.lookup', { code: '6009000000017' })).quantity).toBe(40);
    expect((await s.run(s.owner, 'import.history', {})).length).toBe(2);
  });

  it('round-trips the Excel template', async () => {
    const s = await makeShop();
    const t = await s.run(s.owner, 'import.template', { format: 'xlsx' });
    const p = await s.run(s.owner, 'import.preview', { fileName: t.fileName, contentBase64: t.contentBase64 });
    expect(p.needsMapping).toBe(false);
    expect(p.rows[0].data).toMatchObject({ costPrice: 3850, sellingPrice: 4500, openingStock: 24, barcode: '6001068000012' });
  });
});

describe('TEST 12 + 13 - backup, restore and export', () => {
  it('restores an encrypted backup into a clean environment with reconciled totals', async () => {
    const s = await makeShop();
    for (let i = 0; i < 10; i++) await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 2 }], tenders: cash(2500) });
    const passphrase = 'correct horse battery';
    await expectCode(s.run(s.owner, 'backup.create', { passphrase: 'short' }), 'WEAK_PASSPHRASE');
    await expectCode(s.run(s.manager, 'backup.create', { passphrase }), 'PERMISSION_DENIED');
    const b = await s.run(s.owner, 'backup.create', { passphrase });
    expect(existsSync(b.path)).toBe(true);
    expect(b.uploaded).toBe(false); // offline in this test - the local file is still valid
    const live = summarise(s.engine.db);
    expect({ ...b.summary, createdAt: '' }).toEqual({ ...live, createdAt: '', lastOutboxSeq: b.summary.lastOutboxSeq, pendingSync: b.summary.pendingSync });

    // The backup is not readable without the passphrase (nor with the laptop's own key).
    expect(() => verifyBackupFile(b.path, 'wrong passphrase!')).toThrow(/could not be opened/);
    expect(() => new Database(b.path).prepare('SELECT * FROM sales').all()).toThrow();
    expect(() => verifyBackupFile(b.path, TEST_DB_KEY)).toThrow(/could not be opened/);

    // Restore on a "replacement laptop": new directory, new device key.
    const newDir = tempDir('mansora-restore-');
    const restored = restoreBackupFile(b.path, passphrase, join(newDir, 'mansora.db'), 'replacement-laptop-key');
    expect(restored).toMatchObject({ products: 3, users: 3, sales: 10, salesTotal: 25_000, stockUnits: live.stockUnits });
    const e2 = openEngine({ dataDir: newDir, dbKey: 'replacement-laptop-key' });
    const cashier = await login(e2, CASHIER); // staff logins and permissions came back
    await expectCode(e2.execute(cashier, 'report.profit', { from: '2020-01-01', to: '2030-01-01' }), 'PERMISSION_DENIED');
    expect((e2.db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(s.products.milk) as any).quantity).toBe(30);
    expect(summarise(e2.db).pendingSync).toBe(live.pendingSync); // the unsynced queue is part of the backup
    expect(() => restoreBackupFile(b.path, passphrase, join(newDir, 'mansora.db'), 'k')).toThrow(/overwrite/);
  });

  it('exports the business data in usable formats without secrets', async () => {
    const s = await makeShop();
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 2 }], tenders: cash(2500) });
    const json = await s.run(s.owner, 'export.business', { format: 'json' });
    const text = Buffer.from(json.contentBase64, 'base64').toString();
    const data = JSON.parse(text);
    expect(data.data.sales.length).toBe(1);
    expect(data.data.products.length).toBe(3);
    expect(text).not.toMatch(/password_hash|scrypt\$|fake-token/);
    const xlsx = await s.run(s.owner, 'export.business', { format: 'xlsx' });
    expect(Buffer.from(xlsx.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK');
    const csv = await s.run(s.cashier, 'export.table', { title: 'My sales', format: 'csv', columns: ['Receipt', 'Total'], rows: [['R-000001', '25.00'], ['=HYPERLINK("x")', '1']] });
    expect(Buffer.from(csv.contentBase64, 'base64').toString()).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('receipts', () => {
  it('contains the required details and escapes text', async () => {
    const s = await makeShop();
    await s.run(s.owner, 'business.update', { name: 'Ama & Sons <Mart>', phone: '0240000000', address: 'Osu, Accra', receiptFooter: 'Goods sold are not returnable', lockMinutes: 10, allowNegativeStock: false });
    const id = uuid();
    const sale = await s.run(s.cashier, 'sale.complete', { id, lines: [{ productId: s.products.milk, quantity: 2 }], tenders: [{ method: 'momo', amount: 1000, reference: 'MP240101' }, { method: 'cash', amount: 2000 }] });
    const { html } = await s.run(s.cashier, 'sale.receipt', { id, reprint: true });
    for (const part of ['Ama &amp; Sons &lt;Mart&gt;', sale.receiptNo, 'Esi Boateng', 'Milk tin', '2 x 12.50', '25.00', 'Mobile money', 'MP240101', 'Cash received', '20.00', 'Change', '5.00', 'Reprinted copy', 'Osu, Accra']) expect(html).toContain(part);
    expect(html).not.toContain('<script');
  });
});
