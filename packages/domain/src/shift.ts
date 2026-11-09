import { assertAmount, type Pesewas } from './money';

export interface ShiftCashParts {
  openingFloat: Pesewas;
  cashSales: Pesewas;
  cashRepayments: Pesewas;
  cashRefunds: Pesewas;
  cashExpenses: Pesewas;
  cashIn: Pesewas;
  cashOut: Pesewas;
}

/**
 * Expected closing cash =
 *   opening float + cash received (sales + credit repayments) + authorised inflows
 *   - cash refunds - authorised outflows (expenses + payouts)
 */
export function expectedCash(p: ShiftCashParts): Pesewas {
  Object.values(p).forEach((v) => assertAmount(v));
  return p.openingFloat + p.cashSales + p.cashRepayments + p.cashIn - p.cashRefunds - p.cashExpenses - p.cashOut;
}

/** Positive = cash over, negative = cash short. */
export function cashVariance(expected: Pesewas, counted: Pesewas): Pesewas {
  assertAmount(expected);
  assertAmount(counted);
  return counted - expected;
}
