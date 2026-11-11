import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CASHIER, makeShop, MANAGER } from '../helpers';

const today = () => new Date().toISOString().slice(0, 10);

describe('mobile money and card end-of-day check', () => {
  it('lists every non-cash receipt, repayment and refund payout, totals them and flags reused or missing references', async () => {
    const shop = await makeShop();
    const { run, products: p } = shop;
    const sell = (token: string, lines: { productId: string; quantity: number }[], tenders: any[], extra: Record<string, unknown> = {}) =>
      run(token, 'sale.complete', { id: randomUUID(), lines, tenders, ...extra });

    // Cashier: one mobile money sale, one card sale with no reference, one split cash + momo sale reusing a reference, one cash-only sale.
    const s1 = await sell(shop.cashier, [{ productId: p.milk, quantity: 2 }], [{ method: 'momo', amount: 2500, reference: 'TX-100' }]);
    await sell(shop.cashier, [{ productId: p.soap, quantity: 2 }], [{ method: 'card', amount: 1000 }]);
    await sell(shop.cashier, [{ productId: p.rice, quantity: 1 }], [{ method: 'momo', amount: 3000, reference: ' tx -100 ' }, { method: 'cash', amount: 5000 }]);
    await sell(shop.cashier, [{ productId: p.soap, quantity: 1 }], [{ method: 'cash', amount: 500 }]);

    // Manager: a credit sale later repaid by mobile money, and a mobile money refund of part of the first sale.
    await run(shop.manager, 'shift.open', { openingFloat: 0 });
    const customer = (await run(shop.owner, 'customer.save', { name: 'Yaw Darko', phone: '0201234567' })).id;
    const credit = await sell(shop.manager, [{ productId: p.milk, quantity: 1 }], [{ method: 'credit', amount: 1250 }], { customerId: customer });
    const account = (await run(shop.owner, 'sale.get', { id: credit.id })).credit;
    await run(shop.manager, 'credit.repay', { id: randomUUID(), creditAccountId: account.id, amount: 1250, method: 'momo', reference: 'TX-200' });
    const sale1 = await run(shop.owner, 'sale.get', { id: s1.id });
    await run(shop.manager, 'refund.create', { id: randomUUID(), saleId: s1.id, reason: 'Damaged tin', payoutMethod: 'momo', lines: [{ saleItemId: sale1.items[0].id, quantity: 1, restock: false }] });

    const owner = await run(shop.owner, 'report.wallet', { from: today(), to: today() });
    expect(owner.scope).toBe('business');
    expect(owner.entries.map((e: any) => [e.kind, e.method, e.amount])).toEqual([
      ['sale', 'momo', 2500], ['sale', 'card', 1000], ['sale', 'momo', 3000], ['repayment', 'momo', 1250], ['refund', 'momo', -1250],
    ]);
    const momo = owner.byMethod.find((m: any) => m.method === 'momo');
    const card = owner.byMethod.find((m: any) => m.method === 'card');
    expect(momo).toMatchObject({ count: 4, received: 6750, refunded: 1250, net: 5500, missingReference: 0 });
    expect(card).toMatchObject({ count: 1, received: 1000, refunded: 0, net: 1000, missingReference: 1 });
    expect(owner.duplicateReferences).toEqual([{ reference: 'TX-100', count: 2 }]);
    expect(owner.entries.find((e: any) => e.kind === 'repayment')).toMatchObject({ customer: 'Yaw Darko', staff: MANAGER.name, reference: 'TX-200' });

    // A cashier sees only what they recorded; the manager's repayment and refund are excluded.
    const own = await run(shop.cashier, 'report.wallet', { from: today(), to: today() });
    expect(own.scope).toBe('own');
    expect(own.entries).toHaveLength(3);
    expect(own.entries.every((e: any) => e.staff === CASHIER.name)).toBe(true);

    // Someone who may view reports but not sell can still open the check; someone with neither cannot.
    const viewer = { name: 'Abena Report', username: 'abena', password: 'viewer-pass-1' };
    await run(shop.owner, 'staff.save', { ...viewer, role: 'cashier', permissions: ['report.sales'] });
    const viewerToken = (await run(null, 'auth.login', viewer)).token;
    expect((await run(viewerToken, 'report.wallet', { from: today(), to: today() })).scope).toBe('business');
    const nobody = { name: 'Kwame Stock', username: 'kwame', password: 'nobody-pass-1' };
    await run(shop.owner, 'staff.save', { ...nobody, role: 'cashier', permissions: ['product.view'] });
    await expect(run((await run(null, 'auth.login', nobody)).token, 'report.wallet', { from: today(), to: today() })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Impossible or reversed dates are refused instead of crashing or returning an empty report (C30 F02).
    for (const range of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-99-01', to: '2026-99-02' }, { from: '2026-03-02', to: '2026-03-01' }]) {
      await expect(run(shop.owner, 'report.wallet', range)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(run(shop.owner, 'report.sales', range)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }

    // Another day is empty.
    const empty = await run(shop.owner, 'report.wallet', { from: '2020-01-01', to: '2020-01-01' });
    expect(empty.entries).toEqual([]);
    expect(empty.byMethod.every((m: any) => m.net === 0)).toBe(true);
  });
});
