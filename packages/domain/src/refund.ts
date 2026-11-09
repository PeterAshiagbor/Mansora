import { fail } from './errors';
import { mulDivFloor, type Pesewas } from './money';
import { assertQuantity } from './sale';

export interface RefundableLine {
  quantity: number;
  lineTotal: Pesewas;
  refundedQuantity: number;
  refundedAmount: Pesewas;
}

/**
 * Value refunded when returning `quantity` units of a sold line.
 * The final unit(s) take whatever value remains, so the refunds on a line
 * can never add up to more (or less) than what the customer paid for it.
 */
export function refundLineAmount(line: RefundableLine, quantity: number): Pesewas {
  assertQuantity(quantity);
  const remainingQty = line.quantity - line.refundedQuantity;
  if (quantity > remainingQty) fail('REFUND_EXCEEDS_SALE', 'Cannot refund more than the quantity still eligible on this sale', { remainingQty });
  const remainingAmount = line.lineTotal - line.refundedAmount;
  if (quantity === remainingQty) return remainingAmount;
  return Math.min(remainingAmount, mulDivFloor(line.lineTotal, quantity, line.quantity));
}

/**
 * A refund first cancels any credit still owed on the sale; only the rest is paid out.
 */
export function splitRefund(amount: Pesewas, outstandingCredit: Pesewas): { creditReduction: Pesewas; payout: Pesewas } {
  const creditReduction = Math.min(amount, Math.max(0, outstandingCredit));
  return { creditReduction, payout: amount - creditReduction };
}
