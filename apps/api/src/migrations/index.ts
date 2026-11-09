/**
 * Cloud PostgreSQL schema. Append-only: never edit a released migration.
 *
 * Two planes, enforced by PostgreSQL itself:
 *   - platform tables (clients, plans, devices, admin audit) are reachable only
 *     by the `mansora_platform` role;
 *   - business tables (sales, stock, customers, ...) are reachable only by the
 *     `mansora_tenant` role and only for the tenant set in `app.tenant_id`
 *     (row-level security, FORCED so even the table owner is filtered).
 * Mansora admin code runs as `mansora_platform` and therefore cannot read any
 * business table unless it deliberately enters a tenant context, which the API
 * only does after checking an owner-issued support grant.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mansora_platform') THEN CREATE ROLE mansora_platform NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mansora_tenant') THEN CREATE ROLE mansora_tenant NOLOGIN; END IF;
END $$;
GRANT mansora_platform, mansora_tenant TO CURRENT_USER;

-- ---------- platform plane ----------
CREATE TABLE admins (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_sessions (
  token_hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admins(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE service_plans (
  id uuid PRIMARY KEY, name text NOT NULL UNIQUE, price bigint NOT NULL CHECK (price >= 0),
  billing_period text NOT NULL CHECK (billing_period IN ('monthly','quarterly','yearly')),
  included_support text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenants (
  id uuid PRIMARY KEY, name text NOT NULL, owner_name text NOT NULL, phone text, email text, address text, business_type text NOT NULL DEFAULT 'retail',
  status text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','suspended','closed')),
  support_contact text, store_name text NOT NULL DEFAULT 'Main store', onboarded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE client_subscriptions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id), plan_id uuid NOT NULL REFERENCES service_plans(id),
  status text NOT NULL CHECK (status IN ('trial','active','past_due','cancelled')), renewal_date date, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onboarding_steps (
  tenant_id uuid NOT NULL REFERENCES tenants(id), step text NOT NULL, completed_at timestamptz, completed_by uuid REFERENCES admins(id), notes text,
  PRIMARY KEY (tenant_id, step)
);
CREATE TABLE activation_codes (
  code_hash text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), expires_at timestamptz NOT NULL, used_at timestamptz,
  created_by uuid NOT NULL REFERENCES admins(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE devices (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')), app_version text, last_seen_at timestamptz, last_sync_at timestamptz,
  pending_count integer, last_backup_at timestamptz, activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX devices_one_active_per_tenant ON devices(tenant_id) WHERE status = 'active';
CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY, admin_id uuid REFERENCES admins(id), action text NOT NULL, tenant_id uuid REFERENCES tenants(id),
  detail text NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_time ON admin_audit_logs(occurred_at DESC);
CREATE TABLE backup_records (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), device_id uuid NOT NULL REFERENCES devices(id), size_bytes bigint NOT NULL,
  sha256 text NOT NULL, storage_key text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON admins, admin_sessions, service_plans, tenants, client_subscriptions, onboarding_steps, activation_codes, devices, backup_records TO mansora_platform;
GRANT SELECT, INSERT ON admin_audit_logs TO mansora_platform;

-- ---------- tenant plane (mirrors the laptop's synced tables) ----------
CREATE TABLE users (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  username text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  permissions text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE categories (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  name text NOT NULL,
  active bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE products (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  sku text,
  barcode text,
  name text NOT NULL,
  category_id uuid,
  unit text NOT NULL,
  cost_price bigint NOT NULL,
  selling_price bigint NOT NULL,
  reorder_level bigint NOT NULL,
  active bigint NOT NULL,
  version bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE stock_balances (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  quantity bigint NOT NULL,
  average_cost bigint NOT NULL,
  version bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, product_id)
);
CREATE TABLE inventory_movements (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  product_id uuid NOT NULL,
  type text NOT NULL,
  quantity_delta bigint NOT NULL,
  unit_cost bigint NOT NULL,
  reference_type text,
  reference_id uuid,
  actor_id uuid NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE suppliers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  name text NOT NULL,
  phone text,
  notes text,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE purchases (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  supplier_id uuid,
  reference text,
  status text NOT NULL,
  total_cost bigint NOT NULL,
  received_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE purchase_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity bigint NOT NULL,
  unit_cost bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE sales (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  receipt_no text NOT NULL,
  shift_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  customer_id uuid,
  subtotal bigint NOT NULL,
  discount_total bigint NOT NULL,
  total bigint NOT NULL,
  cash_tendered bigint NOT NULL,
  change_given bigint NOT NULL,
  cost_total bigint NOT NULL,
  status text NOT NULL,
  discount_approved_by uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE sale_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  sku text,
  quantity bigint NOT NULL,
  unit_price bigint NOT NULL,
  cost_snapshot bigint NOT NULL,
  discount bigint NOT NULL,
  line_total bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE payments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  sale_id uuid NOT NULL,
  method text NOT NULL,
  amount bigint NOT NULL,
  reference text,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE refunds (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  sale_id uuid NOT NULL,
  refund_no text NOT NULL,
  amount bigint NOT NULL,
  cost_total bigint NOT NULL,
  payout_method text,
  payout_amount bigint NOT NULL,
  credit_reduction bigint NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  authorised_by uuid NOT NULL,
  shift_id uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE refund_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  refund_id uuid NOT NULL,
  sale_item_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity bigint NOT NULL,
  amount bigint NOT NULL,
  restocked bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE customers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  active bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE credit_accounts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  customer_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  original_balance bigint NOT NULL,
  outstanding_balance bigint NOT NULL,
  due_date text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE credit_repayments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  credit_account_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  amount bigint NOT NULL,
  method text NOT NULL,
  reference text,
  shift_id uuid,
  received_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE expenses (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount bigint NOT NULL,
  expense_date text NOT NULL,
  payment_method text NOT NULL,
  receipt_reference text,
  shift_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE shifts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  status text NOT NULL,
  opening_float bigint NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  expected_cash bigint,
  counted_cash bigint,
  variance bigint,
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE shift_cash_movements (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  shift_id uuid NOT NULL,
  direction text NOT NULL,
  amount bigint NOT NULL,
  reason text NOT NULL,
  authorised_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE audit_logs (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE support_access_grants (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  scope text NOT NULL,
  purpose text NOT NULL,
  granted_by uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Every event a device has delivered. The primary key is what makes re-delivery harmless.
CREATE TABLE sync_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id), event_id uuid NOT NULL, device_id uuid NOT NULL, seq bigint NOT NULL, type text NOT NULL,
  payload text NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
-- Every time a Mansora employee looks at this business's data. Visible to the owner.
CREATE TABLE support_access_log (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, admin_id uuid NOT NULL, admin_name text NOT NULL, grant_id uuid,
  action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id)
);
CREATE INDEX sales_time ON sales(tenant_id, created_at);
CREATE INDEX movements_product ON inventory_movements(tenant_id, product_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON users TO mansora_tenant;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON categories TO mansora_tenant;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON products TO mansora_tenant;
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_balances USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON stock_balances TO mansora_tenant;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_movements USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON inventory_movements TO mansora_tenant;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON suppliers TO mansora_tenant;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchases USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON purchases TO mansora_tenant;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_items USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON purchase_items TO mansora_tenant;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON sales TO mansora_tenant;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_items USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON sale_items TO mansora_tenant;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON payments TO mansora_tenant;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refunds USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON refunds TO mansora_tenant;
ALTER TABLE refund_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refund_items USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON refund_items TO mansora_tenant;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON customers TO mansora_tenant;
ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_accounts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON credit_accounts TO mansora_tenant;
ALTER TABLE credit_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_repayments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_repayments USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON credit_repayments TO mansora_tenant;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expenses USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON expenses TO mansora_tenant;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shifts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON shifts TO mansora_tenant;
ALTER TABLE shift_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shift_cash_movements USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON shift_cash_movements TO mansora_tenant;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON audit_logs TO mansora_tenant;
ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_access_grants USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON support_access_grants TO mansora_tenant;
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_events USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON sync_events TO mansora_tenant;
ALTER TABLE support_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_access_log USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON support_access_log TO mansora_tenant;
`,
  },
  {
    id: 2,
    name: 'owner_recovery_codes',
    sql: `
-- One-time codes that let a business owner set a new password on their own laptop.
CREATE TABLE owner_recovery_codes (
  code_hash text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), expires_at timestamptz NOT NULL, used_at timestamptz,
  created_by uuid NOT NULL REFERENCES admins(id), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON owner_recovery_codes TO mansora_platform;
`,
  },
];
