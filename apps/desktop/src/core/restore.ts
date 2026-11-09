import { SYNC_TABLES, validateEventRows, type SyncTable } from '@mansora/domain';
import type { Ctx } from './engine';

/** Parents before children, so foreign keys hold while loading. */
const ORDER: SyncTable[] = [
  'users', 'categories', 'products', 'stock_balances', 'suppliers', 'purchases', 'purchase_items', 'customers', 'shifts', 'shift_cash_movements',
  'sales', 'sale_items', 'payments', 'refunds', 'refund_items', 'credit_accounts', 'credit_repayments', 'expenses', 'inventory_movements',
  'audit_logs', 'support_access_grants',
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
