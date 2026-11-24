import { fail, movingAverageCost, type MovementType } from '@mansora/domain';
import type { Ctx } from './engine';
import { collectionTaxConfig, registeredOn } from './tax';

export function stockVatPolicy(ctx: Ctx) {
  return { classificationRequired: registeredOn(collectionTaxConfig(ctx), ctx.now().slice(0, 10)) };
}

export interface MoveInput {
  productId: string;
  type: MovementType;
  delta: number;
  /** Cost of incoming units. When given on a positive movement the average cost is re-calculated. */
  unitCost?: number | null;
  refType: string;
  refId: string;
  reason?: string | null;
}

/**
 * The only way stock ever changes: append an immutable movement and update
 * the balance in the same transaction. Returns the unit cost recorded.
 */
export function moveStock(ctx: Ctx, m: MoveInput): { unitCost: number; quantity: number } {
  if (!Number.isSafeInteger(m.delta) || m.delta === 0) fail('INVALID_QUANTITY', 'Stock movement quantity must be a non-zero whole number');
  const product = ctx.get('SELECT id, name, cost_price, tax_class FROM products WHERE id = ?', m.productId);
  if (!product) fail('NOT_FOUND', 'Product not found');
  if (m.delta > 0 && m.type !== 'SALE_REFUND' && !product.tax_class && stockVatPolicy(ctx).classificationRequired) {
    fail('TAX_CLASS_REQUIRED', `Choose a VAT classification for ${product.name} in Products before adding stock.`, { productId: m.productId });
  }
  const now = ctx.now();
  let bal = ctx.get('SELECT * FROM stock_balances WHERE product_id = ?', m.productId);
  if (!bal) {
    bal = { product_id: m.productId, quantity: 0, average_cost: product.cost_price, version: 0 };
    ctx.run('INSERT INTO stock_balances (product_id, quantity, average_cost, version, updated_at) VALUES (?, 0, ?, 0, ?)', m.productId, product.cost_price, now);
  }
  const quantity = bal.quantity + m.delta;
  if (quantity < 0 && ctx.setting('allow_negative_stock') !== '1') {
    fail('INSUFFICIENT_STOCK', `Not enough stock of ${product.name} (${bal.quantity} available)`, { productId: m.productId, available: bal.quantity });
  }
  let averageCost: number = bal.average_cost;
  let unitCost: number = bal.average_cost;
  if (m.delta > 0 && m.unitCost != null) {
    unitCost = m.unitCost;
    averageCost = movingAverageCost(bal.quantity, bal.average_cost, m.delta, m.unitCost);
  }
  ctx.insert('inventory_movements', {
    id: ctx.id(), product_id: m.productId, type: m.type, quantity_delta: m.delta, unit_cost: unitCost,
    reference_type: m.refType, reference_id: m.refId, actor_id: ctx.user.id, reason: m.reason ?? null, occurred_at: now,
  });
  ctx.update('stock_balances', m.productId, { quantity, average_cost: averageCost, version: bal.version + 1, updated_at: now });
  return { unitCost, quantity };
}

/** Case- and space-insensitive form of a Mobile Money or card transaction reference. */
export const normaliseReference = (ref: string) => ref.replace(/\s+/g, '').toUpperCase();

/**
 * Audit F11: a transaction reference already used on another sale or repayment is the usual sign of a reused or
 * fake payment message. It is refused unless a supervisor approves it on the spot. Returns the approver, if any.
 */
export function checkReferences(ctx: Ctx, refs: (string | null | undefined)[], approver?: { username: string; password: string } | null): string | null {
  const keys = refs.filter((r): r is string => !!r && !!r.trim()).map(normaliseReference);
  if (new Set(keys).size !== keys.length) fail('DUPLICATE_REFERENCE', 'The same transaction reference is entered twice on this payment');
  const norm = (col: string) => `upper(replace(replace(replace(${col}, ' ', ''), char(9), ''), char(10), ''))`;
  const used = keys.filter((k) => ctx.get(`SELECT 1 FROM payments WHERE reference IS NOT NULL AND ${norm('reference')} = ? UNION ALL SELECT 1 FROM credit_repayments WHERE reference IS NOT NULL AND ${norm('reference')} = ? LIMIT 1`, k, k));
  if (!used.length) return null;
  if (!approver && !ctx.can('shift.review')) fail('REFERENCE_ALREADY_USED', `Transaction reference ${used.join(', ')} was already used on another payment. Check the customer's payment message; a manager must approve to accept it.`, { references: used });
  return ctx.authorise('shift.review', approver);
}

/** The signed-in user's open shift, if any. */
export function openShift(ctx: Ctx): any | undefined {
  return ctx.get(`SELECT * FROM shifts WHERE cashier_id = ? AND status = 'open'`, ctx.user.id);
}

export function requireOpenShift(ctx: Ctx, why: string): any {
  const s = openShift(ctx);
  if (!s) fail('NO_OPEN_SHIFT', `Open a shift before ${why}`);
  return s;
}

/** Next human-readable document number, e.g. R-000042. Stored transactionally with the document. */
export function nextNumber(ctx: Ctx, prefix: string): string {
  // Audit F04: a laptop restored from a backup must catch up with the cloud before issuing numbers, or it could
  // reuse receipt numbers already given to customers after the backup was made.
  if (ctx.setting('restore_pending_reconcile')) fail('RECONCILE_REQUIRED', 'This laptop was restored from a backup. Connect to the internet and choose Sync now so it can catch up with sales made after the backup. If there is no connection, the owner can continue offline from the Sync page.');
  const key = `seq_${prefix}`;
  const next = Number(ctx.setting(key) ?? 0) + 1;
  ctx.engine.setMeta(key, String(next));
  return `${prefix}-${String(next).padStart(6, '0')}`;
}
