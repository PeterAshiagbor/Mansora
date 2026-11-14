import { fail } from './errors';
import { assertAmount, assertNonNegative, mulDivRound, type Pesewas } from './money';

/**
 * Moving weighted-average cost (proposed policy - see decision D-03 in docs/decisions/decision-log.md).
 * Receiving stock re-averages the unit cost; selling does not change it.
 */
export function movingAverageCost(onHand: number, currentAverage: Pesewas, receivedQty: number, receivedUnitCost: Pesewas): Pesewas {
  if (!Number.isSafeInteger(onHand) || !Number.isSafeInteger(receivedQty) || receivedQty <= 0) fail('INVALID_QUANTITY', 'Quantities must be whole numbers and received quantity must be greater than zero');
  assertNonNegative(currentAverage, 'Current cost');
  assertNonNegative(receivedUnitCost, 'Received cost');
  if (onHand <= 0) return receivedUnitCost;
  const numerator = BigInt(onHand) * BigInt(currentAverage) + BigInt(receivedQty) * BigInt(receivedUnitCost);
  const denominator = BigInt(onHand) + BigInt(receivedQty);
  const result = Number((numerator * 2n + denominator) / (denominator * 2n));
  assertAmount(result);
  return result;
}

export const MOVEMENT_TYPES = [
  'OPENING_STOCK',
  'PURCHASE_RECEIVED',
  'SALE',
  'SALE_REFUND',
  'DAMAGE',
  'STOCK_COUNT_ADJUSTMENT',
  'MANUAL_CORRECTION',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Gross margin in basis points (1% = 100). Null when there is no revenue. */
export function grossMarginBps(revenue: Pesewas, cogs: Pesewas): number | null {
  if (revenue <= 0) return null;
  const profit = revenue - cogs;
  return profit >= 0 ? mulDivRound(profit, 10_000, revenue) : -mulDivRound(-profit, 10_000, revenue);
}

/** Catalogue unit cost, rounded half up to the nearest pesewa. This does not allocate an invoice total. */
export function unitCostFromCarton(cartonCost: Pesewas, unitsPerCarton: number): Pesewas {
  assertNonNegative(cartonCost, 'Carton cost');
  if (!Number.isSafeInteger(unitsPerCarton) || unitsPerCarton <= 0) fail('INVALID_QUANTITY', 'Units per carton must be a positive whole number');
  return mulDivRound(cartonCost, 1, unitsPerCarton);
}
