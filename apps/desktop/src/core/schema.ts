/**
 * Local SQLite schema. Migrations are append-only: never edit a released
 * migration, add a new one. Synced tables share column names with
 * SYNC_TABLES in @mansora/domain.
 */
const IMMUTABLE = ['inventory_movements', 'purchases', 'purchase_items', 'sales', 'sale_items', 'payments', 'refunds', 'refund_items', 'credit_repayments', 'expenses', 'shift_cash_movements', 'audit_logs'];

const immutableTriggers = IMMUTABLE.map(
  (t) => `
CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} records are immutable'); END;
CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} records cannot be deleted'); END;`,
).join('\n');

export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  permissions TEXT NOT NULL DEFAULT '[]',
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT COLLATE NOCASE,
  barcode TEXT,
  name TEXT NOT NULL COLLATE NOCASE,
  category_id TEXT REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'each',
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price INTEGER NOT NULL CHECK (selling_price >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX products_sku ON products(sku) WHERE sku IS NOT NULL;
CREATE INDEX products_name ON products(name);

CREATE TABLE stock_balances (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  average_cost INTEGER NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('OPENING_STOCK','PURCHASE_RECEIVED','SALE','SALE_REFUND','DAMAGE','STOCK_COUNT_ADJUSTMENT','MANUAL_CORRECTION')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  unit_cost INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX movements_product ON inventory_movements(product_id, occurred_at);
CREATE INDEX movements_ref ON inventory_movements(reference_id);

CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, notes TEXT, updated_at TEXT NOT NULL);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  total_cost INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('open','closed','reviewed')),
  opening_float INTEGER NOT NULL CHECK (opening_float >= 0),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  expected_cash INTEGER,
  counted_cash INTEGER,
  variance INTEGER,
  notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_notes TEXT
);
CREATE UNIQUE INDEX shifts_one_open ON shifts(cashier_id) WHERE status = 'open';

CREATE TABLE shift_cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  authorised_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT REFERENCES customers(id),
  subtotal INTEGER NOT NULL,
  discount_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL CHECK (total >= 0),
  cash_tendered INTEGER NOT NULL DEFAULT 0,
  change_given INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  discount_approved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX sales_created ON sales(created_at);
CREATE INDEX sales_shift ON sales(shift_id);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL,
  cost_snapshot INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);
CREATE INDEX sale_items_sale ON sale_items(sale_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','momo','credit')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT
);
CREATE INDEX payments_sale ON payments(sale_id);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  refund_no TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  cost_total INTEGER NOT NULL DEFAULT 0,
  payout_method TEXT CHECK (payout_method IN ('cash','card','momo')),
  payout_amount INTEGER NOT NULL DEFAULT 0,
  credit_reduction INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  authorised_by TEXT NOT NULL REFERENCES users(id),
  shift_id TEXT REFERENCES shifts(id),
  created_at TEXT NOT NULL
);
CREATE INDEX refunds_sale ON refunds(sale_id);
CREATE TABLE refund_items (
  id TEXT PRIMARY KEY,
  refund_id TEXT NOT NULL REFERENCES refunds(id),
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  restocked INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX refund_items_item ON refund_items(sale_item_id);

CREATE TABLE credit_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
  original_balance INTEGER NOT NULL CHECK (original_balance > 0),
  outstanding_balance INTEGER NOT NULL CHECK (outstanding_balance >= 0 AND outstanding_balance <= original_balance),
  due_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','settled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX credit_customer ON credit_accounts(customer_id);

CREATE TABLE credit_repayments (
  id TEXT PRIMARY KEY,
  credit_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card','momo')),
  reference TEXT,
  shift_id TEXT REFERENCES shifts(id),
  received_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  expense_date TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','momo')),
  receipt_reference TEXT,
  shift_id TEXT REFERENCES shifts(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);
CREATE INDEX audit_time ON audit_logs(occurred_at);

CREATE TABLE support_access_grants (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  purpose TEXT NOT NULL,
  granted_by TEXT NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE support_access_log (
  id TEXT PRIMARY KEY, admin_name TEXT NOT NULL, action TEXT NOT NULL, grant_id TEXT, occurred_at TEXT NOT NULL
);

-- Durable sync outbox. Rows are written in the same transaction as the change they describe.
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor_id TEXT,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','rejected')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TEXT
);
CREATE INDEX outbox_status ON outbox(status, seq);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  created_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  opening_stock_applied INTEGER NOT NULL,
  imported_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE backup_records (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  last_outbox_seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  uploaded_at TEXT,
  created_at TEXT NOT NULL
);
${immutableTriggers}
`,
  },
  {
    id: 2,
    name: 'staff_email_invitations',
    sql: `
-- Optional contact address for emailing a one-time sign-in code. Local only: not synced to the cloud.
ALTER TABLE users ADD COLUMN email TEXT;
-- One pending invitation per staff member. Only a hash of the code is stored.
CREATE TABLE staff_invites (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  used_at TEXT
);
`,
  },
];
