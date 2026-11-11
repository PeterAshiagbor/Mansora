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
  {
    id: 3,
    name: 'admin_totp',
    sql: `
CREATE TABLE admin_totp (
  admin_id uuid PRIMARY KEY REFERENCES admins(id),
  secret_encrypted text,
  enabled_at timestamptz,
  last_used_step bigint NOT NULL DEFAULT -1,
  pending_secret_encrypted text,
  pending_expires_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  attempts_reset_at timestamptz,
  CHECK ((secret_encrypted IS NULL) = (enabled_at IS NULL))
);
CREATE TABLE admin_totp_recovery_codes (
  admin_id uuid NOT NULL REFERENCES admins(id),
  code_hash text NOT NULL,
  PRIMARY KEY (admin_id, code_hash)
);
CREATE TABLE admin_totp_challenges (
  token_hash text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES admins(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_totp_challenges_expiry ON admin_totp_challenges(expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_totp, admin_totp_recovery_codes, admin_totp_challenges TO mansora_platform;
`,
  },
  {
    id: 4,
    name: 'billing',
    sql: `
-- Billing, System A: Mansora collects from its own clients. Platform plane only: no tenant-plane (business data) tables are touched,
-- and the mansora_tenant role gets no access to any of these.
ALTER TABLE service_plans
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN category text NOT NULL DEFAULT 'subscription',
  ADD COLUMN annual_price bigint CHECK (annual_price IS NULL OR annual_price >= 0),
  ADD COLUMN currency text NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  ADD COLUMN trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  ADD COLUMN setup_fee bigint NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  ADD COLUMN effective_from date,
  ADD COLUMN renewal_policy text NOT NULL DEFAULT '',
  ADD COLUMN cancellation_policy text NOT NULL DEFAULT '',
  ADD COLUMN addons text NOT NULL DEFAULT '[]';

ALTER TABLE client_subscriptions DROP CONSTRAINT IF EXISTS client_subscriptions_status_check;
ALTER TABLE client_subscriptions
  ADD COLUMN agreed_amount bigint CHECK (agreed_amount IS NULL OR agreed_amount >= 0),
  ADD COLUMN billing_frequency text NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN ('monthly','quarterly','yearly')),
  ADD COLUMN start_date date,
  ADD COLUMN billing_anchor date,
  ADD COLUMN payment_method text CHECK (payment_method IN ('momo','card','bank','manual')),
  ADD COLUMN mandate_id uuid,
  ADD COLUMN activation_policy text NOT NULL DEFAULT 'first_payment' CHECK (activation_policy IN ('first_payment','mandate')),
  ADD COLUMN discount_bps integer NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
  ADD COLUMN discount_note text,
  ADD COLUMN proration_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN cancel_reason text,
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN last_payment_at timestamptz;
ALTER TABLE client_subscriptions ADD CONSTRAINT client_subscriptions_status_check
  CHECK (status IN ('draft','awaiting_approval','trial','active','payment_due','payment_failed','overdue','past_due','paused','cancelled','expired'));

CREATE TABLE billing_accounts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
  billing_name text NOT NULL, billing_email text, billing_phone text, address text, tax_id text,
  vat_registered boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Who the money settles to. Credentials never live here: they are server environment variables. System B (a business collecting
-- from its own customers) uses owner_type 'tenant' and must never share a row, mandate or settlement with Mansora's own.
CREATE TABLE merchant_payment_accounts (
  id uuid PRIMARY KEY, owner_type text NOT NULL CHECK (owner_type IN ('mansora','tenant')),
  tenant_id uuid REFERENCES tenants(id), provider text NOT NULL, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','active','disabled')),
  settlement_note text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'mansora' AND tenant_id IS NULL) OR (owner_type = 'tenant' AND tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX merchant_accounts_mansora_provider ON merchant_payment_accounts(provider) WHERE owner_type = 'mansora';
CREATE UNIQUE INDEX merchant_accounts_tenant_provider ON merchant_payment_accounts(tenant_id, provider) WHERE owner_type = 'tenant';

CREATE TABLE payment_mandates (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid REFERENCES client_subscriptions(id),
  provider text NOT NULL, method text NOT NULL CHECK (method IN ('momo','card','bank')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','cancelled','failed','expired')),
  provider_ref text, token_encrypted text, masked text, max_amount bigint NOT NULL CHECK (max_amount >= 0), frequency text NOT NULL,
  consent_text text NOT NULL, consent_at timestamptz NOT NULL, approved_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  sandbox boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mandates_one_active ON payment_mandates(tenant_id) WHERE status = 'active';
ALTER TABLE client_subscriptions ADD CONSTRAINT client_subscriptions_mandate_fk FOREIGN KEY (mandate_id) REFERENCES payment_mandates(id);

CREATE TABLE document_sequences (kind text NOT NULL, year integer NOT NULL, last integer NOT NULL, PRIMARY KEY (kind, year));

CREATE TABLE invoices (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid REFERENCES client_subscriptions(id),
  number text UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_paid','paid','disputed','cancelled','written_off')),
  status_before_dispute text, is_initial boolean NOT NULL DEFAULT false,
  issue_date date, due_date date, period_start date, period_end date,
  currency text NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  subtotal bigint NOT NULL DEFAULT 0, discount_total bigint NOT NULL DEFAULT 0,
  tax_bps integer NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000), tax_total bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid bigint NOT NULL DEFAULT 0 CHECK (amount_paid >= 0), amount_refunded bigint NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  amount_credited bigint NOT NULL DEFAULT 0 CHECK (amount_credited >= 0), amount_written_off bigint NOT NULL DEFAULT 0 CHECK (amount_written_off >= 0),
  notes text, idempotency_key text UNIQUE, merchant_account_id uuid REFERENCES merchant_payment_accounts(id),
  created_by uuid REFERENCES admins(id), created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz, viewed_at timestamptz, paid_at timestamptz, cancelled_at timestamptz,
  CHECK (amount_refunded <= amount_paid)
);
CREATE INDEX invoices_tenant ON invoices(tenant_id, status);
CREATE INDEX invoices_due ON invoices(due_date) WHERE status IN ('sent','partially_paid','disputed');

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), position integer NOT NULL, description text NOT NULL,
  service_code text NOT NULL DEFAULT 'other', quantity integer NOT NULL CHECK (quantity > 0), unit_price bigint NOT NULL CHECK (unit_price >= 0),
  discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0), line_total bigint NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL REFERENCES invoices(id),
  mandate_id uuid REFERENCES payment_mandates(id), provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('checkout','mandate_setup','mandate_charge')),
  amount bigint NOT NULL CHECK (amount > 0), currency text NOT NULL DEFAULT 'GHS',
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','awaiting_customer','pending','successful','failed','cancelled')),
  reference text NOT NULL UNIQUE, idempotency_key text NOT NULL UNIQUE, attempt_no integer NOT NULL DEFAULT 1,
  checkout_url text, provider_txn_id text, failure_reason text, sandbox boolean NOT NULL DEFAULT false,
  requested_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
-- The database itself refuses a second in-flight payment request for the same invoice, so concurrent scheduler runs cannot double-charge.
CREATE UNIQUE INDEX payment_attempts_one_in_flight ON payment_attempts(invoice_id) WHERE status IN ('initiated','awaiting_customer','pending');

CREATE TABLE settlements (
  id uuid PRIMARY KEY, provider text NOT NULL, merchant_account_id uuid REFERENCES merchant_payment_accounts(id), reference text NOT NULL,
  settled_on date NOT NULL, gross bigint NOT NULL, fees bigint NOT NULL DEFAULT 0, net bigint NOT NULL,
  created_by uuid REFERENCES admins(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference), CHECK (net = gross - fees)
);

CREATE TABLE billing_payments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  method text NOT NULL CHECK (method IN ('momo','card','bank','cash','other')), provider text,
  attempt_id uuid UNIQUE REFERENCES payment_attempts(id), provider_txn_id text, reference text,
  amount bigint NOT NULL CHECK (amount > 0), fee bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  amount_refunded bigint NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0), currency text NOT NULL DEFAULT 'GHS',
  status text NOT NULL DEFAULT 'successful' CHECK (status IN ('successful','partially_refunded','refunded','disputed')),
  sandbox boolean NOT NULL DEFAULT false, received_at timestamptz NOT NULL, receipt_number text NOT NULL UNIQUE,
  recorded_by uuid REFERENCES admins(id), notes text, settlement_id uuid REFERENCES settlements(id),
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (amount_refunded <= amount)
);
CREATE UNIQUE INDEX billing_payments_provider_txn ON billing_payments(provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX billing_payments_tenant_time ON billing_payments(tenant_id, received_at);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES billing_payments(id), invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount bigint NOT NULL CHECK (amount > 0), refunded bigint NOT NULL DEFAULT 0 CHECK (refunded >= 0 AND refunded <= amount), UNIQUE (payment_id, invoice_id)
);
CREATE TABLE billing_refunds (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES billing_payments(id), amount bigint NOT NULL CHECK (amount > 0), reason text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending_provider','completed','failed')), provider_ref text,
  created_by uuid REFERENCES admins(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_notes (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), number text NOT NULL UNIQUE, amount bigint NOT NULL CHECK (amount > 0),
  reason text NOT NULL, created_by uuid REFERENCES admins(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE disputes (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL REFERENCES invoices(id),
  payment_id uuid REFERENCES billing_payments(id), reason text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text, opened_by text NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX disputes_one_open ON disputes(invoice_id) WHERE status = 'open';

CREATE TABLE notifications (
  id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), channel text NOT NULL DEFAULT 'email', to_address text,
  subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  error text, invoice_id uuid REFERENCES invoices(id), kind text NOT NULL DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE TABLE collection_reminders (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), step text NOT NULL, due_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','skipped','failed')), notification_id uuid REFERENCES notifications(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (invoice_id, step)
);

-- Every provider event ever received. The unique key is what makes a repeated delivery harmless.
CREATE TABLE billing_events (
  id uuid PRIMARY KEY, provider text NOT NULL, event_id text NOT NULL, type text NOT NULL, payload text NOT NULL,
  outcome text NOT NULL DEFAULT 'received', detail text, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE (provider, event_id)
);
CREATE TABLE billing_audit_logs (
  id uuid PRIMARY KEY, actor_type text NOT NULL, actor_id text, action text NOT NULL, entity_type text NOT NULL, entity_id text,
  tenant_id uuid, detail text NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_audit_entity ON billing_audit_logs(entity_type, entity_id);
CREATE FUNCTION billing_audit_immutable() RETURNS trigger AS $fn$ BEGIN RAISE EXCEPTION 'billing audit records cannot be changed or deleted'; END $fn$ LANGUAGE plpgsql;
CREATE TRIGGER billing_audit_no_change BEFORE UPDATE OR DELETE ON billing_audit_logs FOR EACH ROW EXECUTE FUNCTION billing_audit_immutable();

CREATE TABLE billing_exceptions (
  id uuid PRIMARY KEY, dedupe_key text NOT NULL UNIQUE, kind text NOT NULL, tenant_id uuid, invoice_id uuid, payment_id uuid, attempt_id uuid,
  detail text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')), resolution text,
  resolved_by uuid REFERENCES admins(id), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

GRANT SELECT, INSERT, UPDATE ON billing_accounts, merchant_payment_accounts, payment_mandates, document_sequences, invoices, payment_attempts,
  settlements, billing_payments, billing_refunds, disputes, notifications, collection_reminders, billing_events, billing_exceptions, billing_settings TO mansora_platform;
GRANT SELECT, INSERT, DELETE ON invoice_line_items TO mansora_platform;
GRANT SELECT, INSERT, UPDATE ON payment_allocations TO mansora_platform;
GRANT SELECT, INSERT ON credit_notes, billing_audit_logs TO mansora_platform;
`,
  },
  {
    id: 5,
    name: 'notification_delivery',
    sql: `
ALTER TABLE notifications ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT '-infinity';
ALTER TABLE notifications ADD COLUMN delivery_started_at timestamptz;
ALTER TABLE notifications ADD COLUMN provider_message_id text;
CREATE INDEX notifications_due ON notifications(next_attempt_at, created_at) WHERE status = 'queued';
`,
  },
];
