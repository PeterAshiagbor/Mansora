import { describe, expect, it } from 'vitest';
import { allocate, expectedCash, cashVariance, movingAverageCost, parseGHS, priceCart, settlePayments, sum } from '@mansora/domain';

describe('financial input and precision boundaries', () => {
  it('rejects misplaced grouping instead of silently changing the entered amount', () => {
    for (const amount of ['1,2.50', ',125', '125,', '1,,250', '12,34,567.89', '1,2345', '1.2,3']) {
      expect(() => parseGHS(amount), amount).toThrow(/valid cedi amount/);
    }
    expect(parseGHS('GH₵ 1,234,567.89')).toBe(123456789);
    expect(parseGHS('GHS -1,234.50')).toBe(-123450);
    expect(parseGHS('1234567.89')).toBe(123456789);
  });

  it('keeps integer sums exact and rejects unrepresentable financial results', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(sum([max, 1, -1])).toBe(max);
    for (const values of [[max, 2], [-max, -2], [1.5], [NaN]]) expect(() => sum(values)).toThrow();
    expect(() => priceCart([{ productId: 'a', quantity: 1, unitPrice: max }, { productId: 'b', quantity: 1, unitPrice: 2 }])).toThrow();
    expect(() => settlePayments(1, [{ method: 'cash', amount: max }, { method: 'cash', amount: 2 }])).toThrow();
    expect(() => allocate(10, [max, 2])).toThrow();
    expect(() => allocate(10, [2, -1])).toThrow();
  });

  it('rounds moving-average cost from exact products before converting back to pesewas', () => {
    // Each input is within the existing engine bounds; their products exceed JS's safe range.
    expect(movingAverageCost(5_000_000, 100_000_000_000, 5_000_001, 99_999_999_999)).toBe(99_999_999_999);
    expect(movingAverageCost(1, 100, 1, 101)).toBe(101);
    expect(movingAverageCost(-3, 100, 1, 101)).toBe(101);
    expect(() => movingAverageCost(1, 100, 1.5, 101)).toThrow();
    expect(() => movingAverageCost(1, NaN, 1, 101)).toThrow();
  });

  it('preserves offsetting cash movements and rejects overflowing reconciliation figures', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const parts = { openingFloat: max, cashSales: 1, cashRepayments: 0, cashIn: 0, cashRefunds: 1, cashExpenses: 0, cashOut: 0 };
    expect(expectedCash(parts)).toBe(max);
    expect(() => expectedCash({ ...parts, cashRefunds: 0 })).toThrow();
    expect(() => cashVariance(-max, max)).toThrow();
  });
});
