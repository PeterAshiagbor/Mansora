import { z } from 'zod';

/**
 * Sync protocol v1.
 *
 * The laptop is the system of record for its store. Every committed local
 * change writes one outbox event in the same SQLite transaction. An event
 * carries the affected rows; the server applies them idempotently:
 *   - `insert` tables are immutable facts (insert, ignore if already present)
 *   - `upsert` tables are current-state rows (last event wins, in device order)
 * Re-delivering an event can therefore never duplicate a sale, payment or
 * stock movement.
 */
export const SYNC_PROTOCOL_VERSION = 1;

type ColType = 'id' | 'id?' | 'text' | 'text?' | 'int' | 'int?' | 'ts' | 'ts?' | 'json';
export interface SyncTableSpec {
  mode: 'insert' | 'upsert';
  key: string;
  cols: Record<string, ColType>;
}

const t = (mode: SyncTableSpec['mode'], cols: Record<string, ColType>, key = 'id'): SyncTableSpec => ({ mode, key, cols });

export const SYNC_TABLES = {
  users: t('upsert', { id: 'id', username: 'text', name: 'text', role: 'text', status: 'text', permissions: 'json', created_at: 'ts', updated_at: 'ts' }),
  categories: t('upsert', { id: 'id', name: 'text', active: 'int', updated_at: 'ts' }),
  products: t('upsert', {
    id: 'id', sku: 'text?', barcode: 'text?', name: 'text', category_id: 'id?', unit: 'text', cost_price: 'int', selling_price: 'int',
    reorder_level: 'int', active: 'int', version: 'int', created_at: 'ts', updated_at: 'ts',
  }),
  stock_balances: t('upsert', { product_id: 'id', quantity: 'int', average_cost: 'int', version: 'int', updated_at: 'ts' }, 'product_id'),
  inventory_movements: t('insert', {
    id: 'id', product_id: 'id', type: 'text', quantity_delta: 'int', unit_cost: 'int', reference_type: 'text?', reference_id: 'id?',
    actor_id: 'id', reason: 'text?', occurred_at: 'ts',
  }),
  suppliers: t('upsert', { id: 'id', name: 'text', phone: 'text?', notes: 'text?', updated_at: 'ts' }),
  purchases: t('insert', { id: 'id', supplier_id: 'id?', reference: 'text?', status: 'text', total_cost: 'int', received_at: 'ts', created_by: 'id' }),
  purchase_items: t('insert', { id: 'id', purchase_id: 'id', product_id: 'id', quantity: 'int', unit_cost: 'int' }),
  sales: t('insert', {
    id: 'id', receipt_no: 'text', shift_id: 'id', cashier_id: 'id', customer_id: 'id?', subtotal: 'int', discount_total: 'int', total: 'int',
    cash_tendered: 'int', change_given: 'int', cost_total: 'int', status: 'text', discount_approved_by: 'id?', created_at: 'ts',
  }),
  sale_items: t('insert', {
    id: 'id', sale_id: 'id', product_id: 'id', product_name: 'text', sku: 'text?', quantity: 'int', unit_price: 'int', cost_snapshot: 'int',
    discount: 'int', line_total: 'int',
  }),
  payments: t('insert', { id: 'id', sale_id: 'id', method: 'text', amount: 'int', reference: 'text?' }),
  refunds: t('insert', {
    id: 'id', sale_id: 'id', refund_no: 'text', amount: 'int', cost_total: 'int', payout_method: 'text?', payout_amount: 'int', credit_reduction: 'int',
    reason: 'text', requested_by: 'id', authorised_by: 'id', shift_id: 'id?', created_at: 'ts',
  }),
  refund_items: t('insert', { id: 'id', refund_id: 'id', sale_item_id: 'id', product_id: 'id', quantity: 'int', amount: 'int', restocked: 'int' }),
  customers: t('upsert', { id: 'id', name: 'text', phone: 'text?', email: 'text?', notes: 'text?', active: 'int', created_at: 'ts', updated_at: 'ts' }),
  credit_accounts: t('upsert', {
    id: 'id', customer_id: 'id', sale_id: 'id', original_balance: 'int', outstanding_balance: 'int', due_date: 'text?', status: 'text',
    created_at: 'ts', updated_at: 'ts',
  }),
  credit_repayments: t('insert', {
    id: 'id', credit_account_id: 'id', customer_id: 'id', amount: 'int', method: 'text', reference: 'text?', shift_id: 'id?', received_by: 'id', created_at: 'ts',
  }),
  expenses: t('insert', {
    id: 'id', category: 'text', description: 'text', amount: 'int', expense_date: 'text', payment_method: 'text', receipt_reference: 'text?',
    shift_id: 'id?', created_by: 'id', created_at: 'ts',
  }),
  shifts: t('upsert', {
    id: 'id', cashier_id: 'id', status: 'text', opening_float: 'int', opened_at: 'ts', closed_at: 'ts?', expected_cash: 'int?', counted_cash: 'int?',
    variance: 'int?', notes: 'text?', reviewed_by: 'id?', reviewed_at: 'ts?', review_notes: 'text?',
  }),
  shift_cash_movements: t('insert', { id: 'id', shift_id: 'id', direction: 'text', amount: 'int', reason: 'text', authorised_by: 'id', created_at: 'ts' }),
  audit_logs: t('insert', { id: 'id', actor_id: 'id?', action: 'text', entity_type: 'text?', entity_id: 'text?', detail: 'json', occurred_at: 'ts' }),
  support_access_grants: t('upsert', {
    id: 'id', scope: 'text', purpose: 'text', granted_by: 'id', starts_at: 'ts', expires_at: 'ts', revoked_at: 'ts?', created_at: 'ts',
  }),
} satisfies Record<string, SyncTableSpec>;

export type SyncTable = keyof typeof SYNC_TABLES;
export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES) as SyncTable[];

const uuid = z.string().uuid();
const colSchema: Record<ColType, z.ZodType> = {
  id: uuid,
  'id?': uuid.nullable(),
  text: z.string().max(2000),
  'text?': z.string().max(2000).nullable(),
  int: z.number().int().safe(),
  'int?': z.number().int().safe().nullable(),
  ts: z.string().datetime(),
  'ts?': z.string().datetime().nullable(),
  json: z.string().max(20_000),
};

const rowSchemas = Object.fromEntries(
  Object.entries(SYNC_TABLES).map(([name, spec]) => [
    name,
    z.array(z.strictObject(Object.fromEntries(Object.entries(spec.cols).map(([c, type]) => [c, colSchema[type]])))).max(5000),
  ]),
) as unknown as Record<SyncTable, z.ZodType<Record<string, unknown>[]>>;

export const syncEventSchema = z.strictObject({
  id: uuid,
  seq: z.number().int().positive(),
  type: z.string().min(1).max(80),
  occurredAt: z.string().datetime(),
  actorId: uuid.nullable(),
  payload: z.strictObject({ rows: z.partialRecord(z.enum(SYNC_TABLE_NAMES as [SyncTable, ...SyncTable[]]), z.array(z.record(z.string(), z.unknown()))) }),
});
export type SyncEvent = z.infer<typeof syncEventSchema>;

/** Validate the rows of one event strictly against the table specs. Throws ZodError. */
export function validateEventRows(rows: SyncEvent['payload']['rows']): Partial<Record<SyncTable, Record<string, unknown>[]>> {
  const out: Partial<Record<SyncTable, Record<string, unknown>[]>> = {};
  for (const [table, list] of Object.entries(rows)) out[table as SyncTable] = rowSchemas[table as SyncTable].parse(list);
  return out;
}

export const syncPushSchema = z.strictObject({
  protocol: z.literal(SYNC_PROTOCOL_VERSION),
  device: z.strictObject({
    appVersion: z.string().max(40),
    pendingCount: z.number().int().nonnegative(),
    lastBackupAt: z.string().datetime().nullable(),
  }),
  events: z.array(z.unknown()).max(200),
});

export interface SyncPushResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

export interface SyncPullResult {
  tenant: { id: string; name: string; status: string };
  subscription: { status: string; renewalDate: string | null; planName: string | null } | null;
  supportAccessLog: { id: string; adminName: string; action: string; occurredAt: string; grantId: string | null }[];
  serverTime: string;
}

export const ONBOARDING_STEPS = [
  ['create_account', 'Create client account'],
  ['business_profile', 'Configure business profile'],
  ['activate_laptop', 'Activate licensed laptop'],
  ['import_products', 'Import products'],
  ['import_opening_stock', 'Import opening stock'],
  ['owner_login', 'Create owner login'],
  ['configure_staff', 'Configure staff'],
  ['test_scanner', 'Test scanner'],
  ['test_printer', 'Test printer'],
  ['test_transaction', 'Complete test transaction'],
  ['training', 'Deliver training'],
  ['go_live', 'Confirm go-live'],
] as const;
