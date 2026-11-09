import { describe, expect, it } from 'vitest';
import {
  allocate, can, cashVariance, expectedCash, formatGHS, grossMarginBps, movingAverageCost, mulDivRound, parseGHS, priceCart, refundLineAmount,
  ROLE_DEFAULTS, sanitisePermissions, settlePayments, splitRefund,
} from '@mansora/domain';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return e.code;
  }
  return 'NO_ERROR';
};

describe('money', () => {
  it('parses cedi strings to integer pesewas without floats', () => {
    expect(parseGHS('12')).toBe(1200);
    expect(parseGHS('12.5')).toBe(1250);
    expect(parseGHS('0.07')).toBe(7);
    expect(parseGHS('1,234.50')).toBe(123450);
    expect(parseGHS('GHS 19.99')).toBe(1999);
    expect(code(() => parseGHS('12.345'))).toBe('INVALID_AMOUNT');
    expect(code(() => parseGHS('abc'))).toBe('INVALID_AMOUNT');
  });
  it('formats', () => {
    expect(formatGHS(123450)).toBe('GHS 1,234.50');
    expect(formatGHS(5)).toBe('GHS 0.05');
    expect(formatGHS(-250, false)).toBe('-2.50');
  });
  it('0.1 + 0.2 style sums are exact', () => {
    expect(parseGHS('0.10') + parseGHS('0.20')).toBe(parseGHS('0.30'));
  });
  it('rounds half up with exact integer arithmetic', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(1005, 1, 10)).toBe(101);
    expect(mulDivRound(9_007_199_254_740, 1000, 1000)).toBe(9_007_199_254_740);
  });
  it('allocate always sums exactly to the total', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1, [5, 5])).toEqual([1, 0]);
    for (const total of [0, 1, 7, 999, 12345]) {
      const parts = allocate(total, [3, 0, 17, 5, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts[1]).toBe(0);
    }
  });
});

describe('basket pricing and discounts', () => {
  it('totals lines', () => {
    const c = priceCart([{ productId: 'a', quantity: 3, unitPrice: 1250 }, { productId: 'b', quantity: 1, unitPrice: 8000 }]);
    expect(c).toMatchObject({ subtotal: 11750, discountTotal: 0, total: 11750 });
  });
  it('applies line and basket discounts, spreading the basket discount exactly', () => {
    const c = priceCart([{ productId: 'a', quantity: 3, unitPrice: 333, discount: 99 }, { productId: 'b', quantity: 1, unitPrice: 500 }, { productId: 'c', quantity: 2, unitPrice: 101 }], 100);
    expect(c.subtotal).toBe(999 + 500 + 202);
    expect(c.discountTotal).toBe(199);
    expect(c.total).toBe(c.subtotal - 199);
    expect(c.lines.reduce((a, l) => a + l.lineTotal, 0)).toBe(c.total);
  });
  it('rejects discounts larger than the amount and bad quantities', () => {
    expect(code(() => priceCart([{ productId: 'a', quantity: 1, unitPrice: 100, discount: 101 }]))).toBe('DISCOUNT_TOO_LARGE');
    expect(code(() => priceCart([{ productId: 'a', quantity: 1, unitPrice: 100 }], 101))).toBe('DISCOUNT_TOO_LARGE');
    expect(code(() => priceCart([{ productId: 'a', quantity: 0, unitPrice: 100 }]))).toBe('INVALID_QUANTITY');
    expect(code(() => priceCart([{ productId: 'a', quantity: 1.5, unitPrice: 100 }]))).toBe('INVALID_QUANTITY');
    expect(code(() => priceCart([]))).toBe('EMPTY_BASKET');
  });
});

describe('payments', () => {
  it('calculates change for cash', () => {
    const s = settlePayments(3750, [{ method: 'cash', amount: 5000 }]);
    expect(s).toMatchObject({ change: 1250, cashTendered: 5000, creditAmount: 0 });
    expect(s.payments).toEqual([{ method: 'cash', amount: 3750, reference: null }]);
  });
  it('handles split payments and keeps the breakdown', () => {
    const s = settlePayments(10000, [{ method: 'momo', amount: 4000, reference: 'TX1' }, { method: 'card', amount: 2500 }, { method: 'cash', amount: 4000 }]);
    expect(s.change).toBe(500);
    expect(s.payments).toEqual([{ method: 'cash', amount: 3500, reference: null }, { method: 'momo', amount: 4000, reference: 'TX1' }, { method: 'card', amount: 2500, reference: null }]);
    expect(s.payments.reduce((a, p) => a + p.amount, 0)).toBe(10000);
  });
  it('records part-credit sales', () => {
    const s = settlePayments(10000, [{ method: 'cash', amount: 3000 }, { method: 'credit', amount: 7000 }]);
    expect(s).toMatchObject({ creditAmount: 7000, change: 0 });
  });
  it('rejects underpayment and non-cash overpayment', () => {
    expect(code(() => settlePayments(1000, [{ method: 'cash', amount: 999 }]))).toBe('UNDERPAID');
    expect(code(() => settlePayments(1000, [{ method: 'momo', amount: 1001 }]))).toBe('OVERPAYMENT');
    expect(code(() => settlePayments(1000, []))).toBe('UNDERPAID');
  });
});

describe('refund limits', () => {
  const line = { quantity: 3, lineTotal: 1000, refundedQuantity: 0, refundedAmount: 0 };
  it('refunds proportionally and never more than was paid', () => {
    const first = refundLineAmount(line, 1);
    expect(first).toBe(333);
    const second = refundLineAmount({ ...line, refundedQuantity: 1, refundedAmount: first }, 2);
    expect(first + second).toBe(1000);
  });
  it('blocks refunding more than the eligible quantity', () => {
    expect(code(() => refundLineAmount(line, 4))).toBe('REFUND_EXCEEDS_SALE');
    expect(code(() => refundLineAmount({ ...line, refundedQuantity: 3, refundedAmount: 1000 }, 1))).toBe('REFUND_EXCEEDS_SALE');
  });
  it('cancels outstanding credit before paying out', () => {
    expect(splitRefund(500, 300)).toEqual({ creditReduction: 300, payout: 200 });
    expect(splitRefund(500, 0)).toEqual({ creditReduction: 0, payout: 500 });
    expect(splitRefund(200, 900)).toEqual({ creditReduction: 200, payout: 0 });
  });
});

describe('costing', () => {
  it('moving weighted average', () => {
    expect(movingAverageCost(10, 1000, 10, 2000)).toBe(1500);
    expect(movingAverageCost(0, 1000, 5, 700)).toBe(700);
    expect(movingAverageCost(3, 100, 1, 101)).toBe(100); // 401/4 = 100.25
    expect(movingAverageCost(1, 100, 1, 101)).toBe(101); // 100.5 rounds half up
  });
  it('gross margin', () => {
    expect(grossMarginBps(10000, 7500)).toBe(2500);
    expect(grossMarginBps(0, 0)).toBeNull();
    expect(grossMarginBps(1000, 1500)).toBe(-5000);
  });
});

describe('cash reconciliation', () => {
  it('expected cash follows the documented formula', () => {
    const expected = expectedCash({ openingFloat: 10000, cashSales: 45000, cashRepayments: 5000, cashRefunds: 2500, cashExpenses: 1000, cashIn: 2000, cashOut: 20000 });
    expect(expected).toBe(10000 + 45000 + 5000 + 2000 - 2500 - 1000 - 20000);
    expect(cashVariance(expected, expected - 150)).toBe(-150);
    expect(cashVariance(expected, expected + 20)).toBe(20);
  });
});

describe('permissions', () => {
  const cashier = { id: '1', role: 'cashier' as const, permissions: ROLE_DEFAULTS.cashier, status: 'active' };
  it('cashier defaults are restrictive', () => {
    expect(can(cashier, 'sale.create')).toBe(true);
    for (const p of ['product.cost', 'product.manage', 'refund.approve', 'report.profit', 'staff.manage', 'sale.discount'] as const) expect(can(cashier, p)).toBe(false);
  });
  it('owner-only permissions cannot be delegated', () => {
    expect(sanitisePermissions('manager', ['staff.manage', 'support.grant', 'report.sales', 'made.up'])).toEqual(['report.sales']);
    expect(can({ ...cashier, role: 'manager', permissions: ['staff.manage'] }, 'staff.manage')).toBe(false);
  });
  it('disabled users can do nothing', () => {
    expect(can({ ...cashier, status: 'disabled' }, 'sale.create')).toBe(false);
    expect(can({ id: '2', role: 'owner', permissions: [], status: 'disabled' }, 'sale.create')).toBe(false);
  });
});
