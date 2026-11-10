# Payment collection, subscriptions and revenue — architecture and implementation plan

**Status:** System A (Mansora collecting from its own clients) is built and tested against a **sandbox** provider and a local fake Paystack server. **No real money has moved. No live provider account exists.** System B (each client collecting from its own customers) is designed only; nothing of it is built.

## 1. What is built

| Area | Where | Notes |
| --- | --- | --- |
| Service plans (price, period, trial, setup fee, renewal/cancellation policy) | `service_plans` (extended by migration 4), admin **Service plans** | Existing plans keep working |
| Subscriptions with an audited lifecycle | `client_subscriptions`, `apps/api/src/billing/subscriptions.ts` | draft → awaiting approval → trial/active → payment due/failed → overdue → paused/cancelled/expired |
| Invoices, credit notes, write-offs, disputes | `invoices*.ts`, tables `invoices`, `invoice_line_items`, `credit_notes`, `disputes` | One invoice per subscription period (idempotency key `sub:<id>:<period start>`) |
| Payments, refunds, allocations, settlements | `payments.ts`, `billing_payments`, `payment_allocations`, `billing_refunds`, `settlements` | Table names avoid clashing with the POS `payments` table |
| Provider adapters | `providers/{sandbox,paystack,hubtel}.ts`, `registry.ts` | One interface; the rest of billing never names a provider |
| Reminders, retries, reconciliation | `jobs.ts` (run every 15 minutes, idempotent) | Reminders go to a queue; no email provider is connected |
| Webhooks | `POST /v1/webhooks/:provider` | Signature, dedupe, then provider verification |
| Pay-by-link | `/pay/:token` (signed, per invoice) | Works without signing in |
| Admin dashboard | `apps/admin-web/src/billing.tsx` | Collections, Subscriptions, Invoices, Payments, Revenue reports, Payment settings |
| Client "Billing & payments" | `apps/desktop/src/renderer/pages/Billing.tsx`, `core/commands/billing.ts` | Owner only by default; last-known state offline |
| Audit | `billing_audit_logs` | No UPDATE/DELETE privilege and a trigger that refuses both |

## 2. Money rules

- Integer pesewas everywhere (`bigint` in PostgreSQL; sums cast `::bigint`). No floating point.
- `outstanding = total − credited − written off − (paid − refunded)`.
- Cash received, invoiced, outstanding and settled are separate measures. Sandbox payments are flagged and **excluded from every revenue figure**.
- Revenue is never shown as profit; no costs are counted.

## 3. How a payment becomes "paid"

1. An attempt row is committed **before** the provider is called (so a crash can never lose track of money in flight). Only one in-flight attempt per invoice is allowed (partial unique index).
2. The customer approves on the **provider's own page**. Mansora never sees a card number, PIN or password.
3. A payment is recorded only after `provider.verify()` confirms it with the provider, with the exact amount and currency. A webhook body, a redirect, or an accepted API call is **never** proof of payment.
4. A webhook is: signature check → dedupe on `(provider, event_id)` → settle the attempt through `verify()`. A webhook that arrives while the provider still says "pending" is *deferred* and retried.
5. The reconciliation job re-checks attempts stuck as pending and opens an exception (`billing_exceptions`) for anything that does not add up (amount mismatch, unknown reference, settlement difference).

## 4. Recurring payments

- **Card:** Paystack reusable authorisation, charged with `charge_authorization`, only after the customer has approved and consented. The token is stored AES-256-GCM encrypted (`BILLING_ENCRYPTION_KEY`, authenticated with the mandate id).
- **Mobile Money:** recurring debit is **not assumed**. Paystack's support documentation is reported to say that recurring Mobile Money is not currently possible in Ghana (re-confirm in writing; see the provider checklist), so the Paystack adapter reports `recurringMomo: false`. The Hubtel adapter is a **blocked stub** until Hubtel confirms its recurring API in writing. When automatic debit is unavailable the system sends the invoice with a pay-by-link and reminders (this is the default path).
- Every charge needs an active mandate **and** an issued invoice for that exact amount. A charge never exceeds the invoice outstanding. Retries: up to 3 attempts, 3 days apart (settings). A failed attempt never suspends the service.

## 5. Collections schedule (defaults, configurable)

Invoice created 7 days before renewal; due 14 days after issue. Reminders: upcoming (3 days before due), due day, overdue +3, overdue +7, escalate to Mansora admin +14, flag for service review +30. If the system was down, only the latest reached step is sent; earlier steps are recorded as skipped. **There is no automatic suspension.**

## 6. Security

No secret in the front end or source. `PAY_LINK_SECRET` signs payment links; `BILLING_ENCRYPTION_KEY` protects saved tokens. In production both are **required** (the server refuses to start without them). Client endpoints are scoped to the tenant of the device token. Admin endpoints require an administrator session. Refunds, write-offs, cancellations, manual payments and settings changes are audited with actor, time and detail. CSV exports neutralise formula injection.

## 7. System B (clients collecting from their customers) — designed, not built

`merchant_payment_accounts` already has `owner_type` (`mansora` or `tenant`) so each business's settlement account can be recorded separately and **never combined with Mansora's or another business's**. Tenant-owned invoices, customer payment links and POS integration need a separate design review (see decision D-30) and tenant-plane tables with the normal row-level security.

## 8. Plan for the remaining work

1. Connect an email provider (adapter interface exists) so reminders and receipts are delivered.
2. Open Mansora's Paystack business account, use **test keys first**, point the webhook at `/v1/webhooks/paystack`, run the acceptance script in the provider checklist.
3. Get written confirmation from Hubtel on recurring Mobile Money, then implement its adapter against its sandbox.
4. Decide the open policies in the decision log (D-24 to D-35).
5. Only then, a supervised live pilot with one consenting client.

See [provider onboarding and integration blockers](provider-onboarding.md) and the [operations runbook](runbook.md).

## 9. Test coverage

`tests/billing/*` (plus `tests/e2e/billing.test.ts`) run on embedded PostgreSQL with the sandbox provider and a local fake Paystack server. Tests are labelled with the acceptance item they cover: items **1–18 and 21** are covered by name (plans, subscribing, authorisation, verified-only payment, renewal, webhooks, partial payments and refunds, reminders, revenue reconciliation, tenant isolation, provider outages). Items **19, 20 and 22** of the brief are **not individually mapped** to a test; review them against the brief before sign-off. Also covered: the desktop Billing screen (permissions, offline, pay flow, cancellation request) and the admin screens in a real browser. **None of this has touched a real provider.**
