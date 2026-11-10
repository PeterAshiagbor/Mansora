import { fail } from './errors';
import { assertNonNegative, mulDivRound, type Pesewas } from './money';

/**
 * Moving weighted-average cost (proposed policy - see decision D-03 in docs/decisions/decision-log.md).
 * Receiving stock re-averages the unit cost; selling does not change it.
 */
export function movingAverageCost(onHand: number, currentAverage: Pesewas, receivedQty: number, receivedUnitCost: Pesewas): Pesewas {
  if (receivedQty <= 0) fail('INVALID_QUANTITY', 'Received quantity must be greater than zero');
  if (receivedUnitCost < 0) fail('INVALID_AMOUNT', 'Cost cannot be negative');
  if (onHand <= 0) return receivedUnitCost;
  return mulDivRound(onHand * currentAverage + receivedQty * receivedUnitCost, 1, onHand + receivedQty);
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
