# DRAFT — not legal advice — for review by a Ghanaian lawyer and accountant

# Proposed retention schedule

This proposes a period for each group of records, so the lawyer and accountant can confirm or change it. The
per-table questions and engineering consequences are in [retention-deletion.md](retention-deletion.md); the
inventory test checks every table has an entry there.

**Assumption to confirm:** Ghanaian tax law requires business records to be kept for **six years** (Revenue
Administration Act, 2016, Act 915). The financial periods below use six years from the end of the year the record relates to.

## Shop records (the shop is the controller; Mansora keeps them on the shop's instructions)

| Group | Tables | Proposed period | At the end |
|---|---|---|---|
| Sales, refunds, payments, shifts and cash movements | `sales`, `sale_items`, `payments`, `refunds`, `refund_items`, `shifts`, `shift_cash_movements` | 6 years after the year end | Remove the link to the customer and staff names; keep totals for reports |
| Stock and purchases | `inventory_movements`, `purchases`, `purchase_items`, `stock_balances`, `import_batches` | 6 years after the year end | Same as above |
| Expenses | `expenses` | 6 years after the year end | Delete |
| Customer credit | `credit_accounts`, `credit_repayments` | 6 years after the debt is settled or written off | Remove the customer's name and contacts |
| Customer profiles (name, phone, email, notes) | `customers` | While the customer is active, plus 2 years with no purchases and no balance | Remove contact details and notes; keep a reference for old sales |
| Suppliers | `suppliers` | While used, plus 6 years after the last purchase | Remove contact details |
| Staff accounts | `users`, `staff_invites` | While employed. After leaving, keep the name for 6 years on the records they made. Sign-in codes: delete 30 days after use or expiry | Remove email |
| Audit log | `audit_logs` | 6 years | Delete |
| Sync and device records | `outbox`, `sync_events`, `devices` | Sync payloads: 90 days after the server confirms them. Device records: while active plus 2 years | Delete payloads |
| Laptop backup files | (files) | The shop decides. App default: keep the last [30] automatic backups | Shop deletes |

## Mansora's own records (Mansora is the controller)

| Group | Tables | Proposed period | At the end |
|---|---|---|---|
| Invoices, payments, refunds, credit notes, settlements | `invoices`, `billing_payments`, `billing_refunds`, `payment_allocations`, `settlements` | 6 years after the year end | Delete |
| Payment authorisations | `payment_mandates`, `payment_attempts` | Provider token: deleted when the authorisation ends. Record of consent: 6 years | Delete |
| Client account and contacts | `tenants`, `billing_accounts`, `client_subscriptions` | While a client, plus 6 years for the contract record | Remove contact details after 2 years; keep business name with invoices |
| Notifications and reminders | `notifications`, `collection_reminders` | 2 years. Daily summary bodies are already removed after sending | Delete |
| Administrator accounts and security | `admins`, `admin_sessions`, `admin_totp*`, `admin_invitations`, `admin_audit_logs`, `billing_audit_logs`, `billing_events`, `billing_exceptions` | Sessions and codes: 30 days after expiry. Audit log: 6 years. Accounts: while active plus 2 years | Delete |
| Support access | `support_access_grants`, `support_access_log` | 6 years | Delete |
| Shop activity counts | columns on `devices` | While the shop is a client | Delete |
| Problem reports | `bug_reports`, `bug_report_digests` | 12 months after the email that included them; remove the reporter's name once the problem is fixed | Delete |

## After a client leaves

Cloud copies of shop records: kept 90 days so the owner can export them, then deleted from the live database,
and from backups as they expire (within 35 more days). Mansora keeps only its own records in the table above.

## Before any automatic deletion is switched on

1. The lawyer and accountant approve the periods.
2. An engineering task builds the clean-up job, with a dry run that lists what would be removed.
3. A rule stops a restored old backup bringing deleted records back.
4. Each run is recorded in the audit log.
