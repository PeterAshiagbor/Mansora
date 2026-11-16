import { movingAverageCost, SYNC_TABLES, validateEventRows, type SyncTable } from '@mansora/domain';
import type { Ctx } from './engine';

/** Parents before children, so foreign keys hold while loading. */
const ORDER: SyncTable[] = [
  'users', 'categories', 'products', 'stock_balances', 'suppliers', 'purchases', 'purchase_items', 'customers', 'shifts', 'shift_cash_movements',
  'sales', 'sale_items', 'payments', 'refunds', 'refund_items', 'credit_accounts', 'credit_repayments', 'expenses', 'inventory_movements',
  'audit_logs', 'support_access_grants', 'tax_configs', 'tax_records', 'ledger_records', 'evat_submissions',
];

/** A stored value that can never match any password: restored staff must be given new passwords by the owner. */
export const NO_PASSWORD = 'reset-required';

/**
 * Load a cloud snapshot into an EMPTY local database (replacement laptop with
 * no backup file). Rows are validated against the sync contract and written
 * directly: they are already in the cloud, so nothing is queued for sync.
 * Returns the id of an existing owner record, if the snapshot has one.
 */
export function importSnapshot(ctx: Ctx, raw: Record<string, unknown>): { ownerId: string | null; rows: number } {
  const tables = validateEventRows(raw as any);
  let rows = 0;
  for (const table of ORDER) {
    const list = tables[table] ?? [];
    if (!list.length) continue;
    const cols = Object.keys(SYNC_TABLES[table].cols);
    const extra = table === 'users' ? ', password_hash' : '';
    const stmt = ctx.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}${extra}) VALUES (${cols.map(() => '?').join(', ')}${extra ? ', ?' : ''})`);
    for (const row of list) {
      stmt.run(...cols.map((c) => row[c] ?? null), ...(extra ? [NO_PASSWORD] : []));
      rows++;
    }
  }
  // Continue document numbering after the highest number already issued.
  for (const [prefix, table, col] of [['R', 'sales', 'receipt_no'], ['RF', 'refunds', 'refund_no']] as const) {
    const max = ctx.all<{ n: string }>(`SELECT ${col} AS n FROM ${table}`).reduce((m, r) => Math.max(m, Number(r.n.split('-').pop()) || 0), 0);
    if (max) ctx.engine.setMeta(`seq_${prefix}`, String(max));
  }
  const owner = ctx.get<{ id: string }>(`SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`);
  return { ownerId: owner?.id ?? null, rows };
}

/**
 * Audit F04: bring a laptop restored from an older backup file up to date with the cloud copy.
 *
 * - Immutable facts the cloud holds but the backup does not (sales made after the backup and already synced) are
 *   inserted; nothing local is overwritten.
 * - Current-state rows are taken from whichever side is newer (version, then updated_at, then shift progress).
 * - Stock balances and credit balances are then rebuilt from the merged facts, given a version above both sides,
 *   and queued for sync, so the cloud copy stops ignoring this laptop's updates.
 * - Document numbering continues after the highest receipt and refund number issued on either side.
 */
export function reconcileSnapshot(ctx: Ctx, raw: Record<string, unknown>): { inserted: number; updated: number; rebuiltStock: number; rebuiltCredit: number } {
  const tables = validateEventRows(raw as any);
  let inserted = 0, updated = 0;
  const SHIFT_RANK: Record<string, number> = { open: 0, closed: 1, reviewed: 2 };
  for (const table of ORDER) {
    const spec = SYNC_TABLES[table];
    const cols = Object.keys(spec.cols);
    const list = tables[table] ?? [];
    const extra = table === 'users' ? ', password_hash' : '';
    const ins = ctx.db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}${extra}) VALUES (${cols.map(() => '?').join(', ')}${extra ? ', ?' : ''})`);
    const get = ctx.db.prepare(`SELECT * FROM ${table} WHERE ${spec.key} = ?`);
    for (const row of list) {
      const local = get.get(row[spec.key]) as any;
      if (!local) { inserted += ins.run(...cols.map((c) => row[c] ?? null), ...(extra ? [NO_PASSWORD] : [])).changes; continue; }
      if (spec.mode !== 'upsert' || table === 'stock_balances' || table === 'credit_accounts') continue; // rebuilt below
      const newer = 'version' in spec.cols ? Number(row.version) > Number(local.version)
        : 'updated_at' in spec.cols ? String(row.updated_at) > String(local.updated_at)
        : table === 'shifts' ? (SHIFT_RANK[String(row.status)] ?? 0) > (SHIFT_RANK[local.status] ?? 0)
        : false;
      if (!newer) continue;
      const set = cols.filter((c) => c !== spec.key);
      ctx.db.prepare(`UPDATE ${table} SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE ${spec.key} = ?`).run(...set.map((c) => row[c] ?? null), row[spec.key]);
      updated++;
    }
  }
  // Rebuild balances from the merged immutable facts.
  const cloudVersion = new Map((tables.stock_balances ?? []).map((r) => [String(r.product_id), Number(r.version)]));
  const state = new Map<string, { quantity: number; averageCost: number }>();
  for (const m of ctx.db.prepare('SELECT product_id, quantity_delta, unit_cost FROM inventory_movements ORDER BY occurred_at, rowid').iterate() as Iterable<any>) {
    const s = state.get(m.product_id) ?? { quantity: 0, averageCost: 0 };
    if (m.quantity_delta > 0) s.averageCost = movingAverageCost(s.quantity, s.averageCost, m.quantity_delta, m.unit_cost);
    s.quantity += m.quantity_delta;
    state.set(m.product_id, s);
  }
  let rebuiltStock = 0;
  for (const [productId, s] of state) {
    const local = ctx.get('SELECT * FROM stock_balances WHERE product_id = ?', productId);
    const version = Math.max(Number(local?.version ?? 0), cloudVersion.get(productId) ?? 0) + 1;
    if (local && local.quantity === s.quantity && local.average_cost === s.averageCost && version - 1 === Number(local.version)) continue;
    if (local) ctx.update('stock_balances', productId, { quantity: s.quantity, average_cost: s.averageCost, version, updated_at: ctx.now() });
    else ctx.insert('stock_balances', { product_id: productId, quantity: s.quantity, average_cost: s.averageCost, version, updated_at: ctx.now() });
    rebuiltStock++;
  }
  let rebuiltCredit = 0;
  const writeOffs = new Map<string, number>();
  for (const r of ctx.all<{ payload: string }>(`SELECT payload FROM ledger_records WHERE kind = 'credit_writeoff'`)) {
    const p = JSON.parse(r.payload); writeOffs.set(p.creditAccountId, (writeOffs.get(p.creditAccountId) ?? 0) + Number(p.amount));
  }
  for (const a of ctx.all('SELECT * FROM credit_accounts')) {
    const repaid = ctx.get<{ v: number }>('SELECT COALESCE(SUM(amount), 0) AS v FROM credit_repayments WHERE credit_account_id = ?', a.id)!.v;
    const reduced = ctx.get<{ v: number }>('SELECT COALESCE(SUM(credit_reduction), 0) AS v FROM refunds WHERE sale_id = ?', a.sale_id)!.v;
    const outstanding = Math.max(0, a.original_balance - repaid - reduced - (writeOffs.get(a.id) ?? 0));
    if (outstanding === a.outstanding_balance) continue;
    ctx.update('credit_accounts', a.id, { outstanding_balance: outstanding, status: outstanding === 0 ? 'settled' : 'open', updated_at: ctx.now() });
    rebuiltCredit++;
  }
  continueNumbering(ctx);
  return { inserted, updated, rebuiltStock, rebuiltCredit };
}

/** Set document counters after the highest number present, never lowering them. */
export function continueNumbering(ctx: Ctx): void {
  for (const [prefix, table, col] of [['R', 'sales', 'receipt_no'], ['RF', 'refunds', 'refund_no']] as const) {
    const max = ctx.all<{ n: string }>(`SELECT ${col} AS n FROM ${table}`).reduce((m, r) => Math.max(m, Number(r.n.split('-').pop()) || 0), 0);
    const current = Number(ctx.setting(`seq_${prefix}`) ?? 0);
    if (max > current) ctx.engine.setMeta(`seq_${prefix}`, String(max));
  }
}
