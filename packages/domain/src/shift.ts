import { assertAmount, sum, type Pesewas } from './money';

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
  return sum([p.openingFloat, p.cashSales, p.cashRepayments, p.cashIn, -p.cashRefunds, -p.cashExpenses, -p.cashOut]);
}

/** Positive = cash over, negative = cash short. */
export function cashVariance(expected: Pesewas, counted: Pesewas): Pesewas {
  assertAmount(expected);
  assertAmount(counted);
  return sum([counted, -expected]);
}

/**
 * A shift opened on an earlier day than today is overnight: it should have been closed with a count.
 * Days are compared in Ghana time, which is UTC all year.
 */
export function isOvernightShift(openedAt: string, now: string): boolean {
  return openedAt.slice(0, 10) < now.slice(0, 10);
}
