/**
 * R16-05: fresh financial review of the combined release. Each expectation is worked out by hand from the
 * transactions below and compared with what the journal, payables, receivables and stock reports say.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { expectCode, makeShop, MANAGER, uuid, type TestShop } from '../helpers';
import { defaultTaxConfig } from '../../packages/domain/src';
import { runEvatQueue, setEvatProvider, type EvatProvider } from '../../apps/desktop/src/core/evat';

let shop: TestShop | undefined;
afterEach(() => shop?.engine.db.close());
const MANAGER_APPROVAL = { username: MANAGER.username, password: MANAGER.password };

describe('R16-05 journal ties to the operational ledgers', () => {
  it('keeps till, payables, receivables and inventory accounts equal to the shop records', async () => {
    const clock = new Date('2026-11-10T10:00:00.000Z');
    const s = (shop = await makeShop({ now: () => clock }));
    const run = s.run;
    const supplier = (await run(s.owner, 'supplier.save', { name: 'Accra Wholesale' })).id;
    const customer = (await run(s.owner, 'customer.save', { name: 'Kofi Credit', phone: '0240000001' })).id;

    // Opening stock from makeShop: rice 20 x 60.00, milk 50 x 9.00, soap 30 x 3.33 = GHS 1,749.90.
    await run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 2 }], tenders: [{ method: 'cash', amount: 20_000 }] }); // 160.00 cash, change 40.00
    const onCredit = await run(s.owner, 'purchase.receive', { supplierId: supplier, reference: 'AW-1', onCredit: true, dueDate: '2026-12-10', items: [{ productId: s.products.milk, quantity: 10, unitCost: 1000 }] });
    await run(s.owner, 'purchase.receive', { supplierId: supplier, reference: 'AW-2', items: [{ productId: s.products.soap, quantity: 10, unitCost: 400 }] }); // paid on delivery, outside Mansora
    await run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: onCredit.id, amount: 4000, method: 'cash' }); // owner's cash, not the till
    await run(s.manager, 'expense.create', { id: uuid(), category: 'Transport', description: 'Taxi', amount: 1500, expenseDate: '2026-11-10', paymentMethod: 'cash' });
    await run(s.cashier, 'expense.create', { id: uuid(), category: 'Cleaning', description: 'Soap for floor', amount: 500, expenseDate: '2026-11-10', paymentMethod: 'cash', paidFromTill: true }).catch(async (e: any) => {
      if (e.code !== 'PERMISSION_DENIED') throw e;
      await run(s.manager, 'shift.open', { openingFloat: 0 }).catch(() => {});
      await run(s.manager, 'expense.create', { id: uuid(), category: 'Cleaning', description: 'Soap for floor', amount: 500, expenseDate: '2026-11-10', paymentMethod: 'cash', paidFromTill: true });
    });
    const credit = await run(s.cashier, 'sale.complete', { id: uuid(), customerId: customer, approver: MANAGER_APPROVAL, lines: [{ productId: s.products.milk, quantity: 4 }], tenders: [{ method: 'credit', amount: 5000 }] });
    const line = (await run(s.cashier, 'sale.get', { id: credit.id })).items[0];
    await run(s.cashier, 'refund.create', { id: uuid(), saleId: credit.id, reason: 'Dented tin', approver: MANAGER_APPROVAL, lines: [{ saleItemId: line.id, quantity: 1 }] });
    await run(s.owner, 'stock.adjust', { productId: s.products.soap, type: 'DAMAGE', delta: -2, reason: 'Crushed' });

    const j = await run(s.owner, 'accounting.journal', { from: '2026-11-10', to: '2026-11-10' });
    const net = (a: string) => j.trial.find((t: any) => t.account === a)?.net ?? 0;
    expect(j.debits).toBe(j.credits);

    // Till: +160.00 cash sale - 5.00 paid from the till. The taxi and the supplier were paid outside the till.
    expect(net('1000')).toBe(15_500);
    // Payables: only the credit purchase is owed: 100.00 - 40.00 paid = 60.00 (credit balance).
    const pay = await run(s.owner, 'payable.list');
    expect(pay.totalOutstanding).toBe(6000);
    expect(net('2000')).toBe(-6000);
    // Receivables: 50.00 on credit less the 12.50 refund taken off the debt.
    const owed = (s.engine.db.prepare('SELECT SUM(outstanding_balance) AS v FROM credit_accounts').get() as any).v;
    expect(owed).toBe(3750);
    expect(net('1100')).toBe(3750);
    // Inventory account equals the stock valuation report (quantity x moving-average cost).
    const stockValue = (s.engine.db.prepare('SELECT SUM(quantity * average_cost) AS v FROM stock_balances').get() as any).v;
    expect(net('1200')).toBe(stockValue);
  });

  it('reverses a write-off when goods come back, and pays out only money the customer actually paid', async () => {
    const s = (shop = await makeShop({ now: () => new Date('2026-11-10T10:00:00.000Z') }));
    const run = s.run;
    const customer = (await run(s.owner, 'customer.save', { name: 'Ama Bad Debt', phone: '0240000002' })).id;
    const creditSale = async (qty: number) => {
      const sale = await run(s.cashier, 'sale.complete', { id: uuid(), customerId: customer, approver: MANAGER_APPROVAL, lines: [{ productId: s.products.rice, quantity: qty }], tenders: [{ method: 'credit', amount: 8000 * qty }] });
      return { sale, detail: await run(s.cashier, 'sale.get', { id: sale.id }) };
    };
    await run(s.manager, 'shift.open', { openingFloat: 0 });
    const tillBefore = (await run(s.manager, 'shift.current', {})).totals.expectedCash;

    // A: GHS 80.00 on credit, never paid, written off in full; the bag comes back.
    const a = await creditSale(1);
    await run(s.owner, 'credit.writeOff', { id: uuid(), creditAccountId: a.detail.credit.id, amount: 8000, reason: 'Customer moved away' });
    const ra = await run(s.cashier, 'refund.create', { id: uuid(), saleId: a.sale.id, reason: 'Returned unopened', approver: MANAGER_APPROVAL, lines: [{ saleItemId: a.detail.items[0].id, quantity: 1 }] });
    expect(ra).toMatchObject({ amount: 8000, payout: 0, creditReduction: 8000 });

    // B: GHS 160.00 on credit, GHS 40.00 repaid in cash, GHS 120.00 written off; both bags come back.
    const b = await creditSale(2);
    await run(s.manager, 'credit.repay', { id: uuid(), creditAccountId: b.detail.credit.id, amount: 4000, method: 'cash' });
    await run(s.owner, 'credit.writeOff', { id: uuid(), creditAccountId: b.detail.credit.id, amount: 12_000, reason: 'Uncollectable' });
    const rb = await run(s.manager, 'refund.create', { id: uuid(), saleId: b.sale.id, reason: 'Returned', approver: MANAGER_APPROVAL, lines: [{ saleItemId: b.detail.items[0].id, quantity: 2 }] });
    expect(rb).toMatchObject({ amount: 16_000, payout: 4000, creditReduction: 12_000 }); // only the 40.00 actually paid goes back

    // Till: +40.00 repayment - 40.00 refund. Bad debts net to nil; receivables are clear.
    expect((await run(s.manager, 'shift.current', {})).totals.expectedCash).toBe(tillBefore);
    const j = await run(s.owner, 'accounting.journal', { from: '2026-11-10', to: '2026-11-10' });
    const net = (acct: string) => j.trial.find((t: any) => t.account === acct)?.net ?? 0;
    expect(j.debits).toBe(j.credits);
    expect(net('5120')).toBe(0);
    expect(net('1100')).toBe(0);
    expect((s.engine.db.prepare('SELECT SUM(outstanding_balance) AS v FROM credit_accounts').get() as any).v).toBe(0);
    const profit = await run(s.owner, 'report.profit', { from: '2026-11-10', to: '2026-11-10' });
    expect(profit.losses?.debtWrittenOff ?? profit.debtWrittenOff ?? 0).toBe(0);
  });

  it('refuses to pay a supplier more than is owed, including after a partial payment', async () => {
    const s = (shop = await makeShop({ now: () => new Date('2026-11-10T10:00:00.000Z') }));
    const supplier = (await s.run(s.owner, 'supplier.save', { name: 'Tema Foods' })).id;
    const p = await s.run(s.owner, 'purchase.receive', { supplierId: supplier, reference: 'TF-1', onCredit: true, items: [{ productId: s.products.rice, quantity: 1, unitCost: 6000 }] });
    await s.run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: p.id, amount: 5000, method: 'bank' });
    await expectCode(s.run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: p.id, amount: 1001, method: 'bank' }), 'INVALID_AMOUNT');
    expect((await s.run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: p.id, amount: 1000, method: 'bank' })).outstanding).toBe(0);
  });

  it('never submits an E-VAT document twice when a background run and a manual run overlap', async () => {
    const s = (shop = await makeShop({ now: () => new Date('2026-11-10T10:00:00.000Z') }));
    await s.run(s.owner, 'tax.configure', { ...defaultTaxConfig(), effectiveDate: '2026-01-01', registered: true, registrationDate: '2026-01-01', tin: 'C0000000001', reason: 'Registered' });
    await s.run(s.owner, 'product.save', { id: s.products.milk, name: 'Milk tin', sellingPrice: 1250, taxClass: 'standard' });
    await s.run(s.owner, 'evat.configure', { mode: 'test', reason: 'Rehearsal' });
    for (let i = 0; i < 3; i++) await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 2000 }] });
    const sent: string[] = [];
    const slow: EvatProvider = { id: 'slow-test', async submit(doc, sha) { sent.push(doc.number); await new Promise((r) => setTimeout(r, 5)); return { status: 'accepted', fiscalId: `TEST-${sha.slice(0, 8)}`, qr: 'q', signature: 's' }; } };
    setEvatProvider(s.engine, slow);
    const [a, b] = await Promise.all([runEvatQueue(s.engine), s.run(s.owner, 'evat.run', {})]);
    expect(sent).toEqual(['R-000001', 'R-000002', 'R-000003']);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ accepted: 3, pending: 0 });
  });
});
