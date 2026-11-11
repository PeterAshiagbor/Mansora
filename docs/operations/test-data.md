# Team-test data pack

The actual Railway platform can add the `retail-v1` pack to every registered test business. Enable it with private service variable `STAGING_SAMPLE_DATA_VERSION=retail-v1`; explicit `MANSORA_STAGING_MODE=team-test` remains required. This is an additive operation, not a reset or a read-only demonstration. Existing business records, accounts, passwords and permissions are preserved.

Each business receives eight clearly labelled SAMPLE products across three categories, three fictional customers, two fictional suppliers, two received purchases, three expenses and ten completed sales. Cash, mobile money, card and credit are represented. The credit sale includes a partial repayment and a remaining balance. Low-stock and out-of-stock products exercise stock alerts. Each existing owner, manager and cashier has sales in their own shift; open shifts remain available for further testing. The existing illustrative platform subscriptions stay in sandbox mode. No real payment, supplier order or customer email is sent.

## Using the data

Sign in at your assigned `/client/shop-a/` or `/client/shop-b/` workspace. Products and customers remain editable. Add your own sample products, receive stock, open or continue a shift and complete sales as your role allows. Both businesses have separate records; staff within one business share its stock and customers.

Owners can analyse sales, profit, payment methods, stock, expenses and credit through the existing Reports screens. Use the normal CSV/Excel actions or Import & export for a full business export. Cashiers retain their existing limited views and can export their own displayed sales; full business exports, cost/profit reports and management commands stay restricted. New sample imports still use the existing preview, validation and permission checks. The pack does not unlock features by changing roles.

Amounts are stored in pesewas and rendered in GHS by the real application. Sales use their actual creation date; choose Today or a range containing the pack's creation date to see them. No historical transaction timestamps are fabricated. Expenses use the pack's recorded start date so retries do not change their period.

## Restart and safety

The pack uses the existing authenticated engine commands, so normal permission checks, schema validation, stock/payment rules, audit entries and sync outbox apply. No raw SQL mutation or special browser command is added. Gateway origin checks, scoped HttpOnly cookies, session expiry, rate/body/import limits, CSP, role restrictions, tenant isolation, database encryption and live-provider restrictions remain in place.

A private mode-0600 `sample-data-<workspace>.json` journal lives beside the existing private account manifest. It binds the pack to the actual tenant and tracks generated catalogue IDs. Stable operation IDs make purchases, expenses, sales and the credit repayment safe to retry after a crash. Completed packs are never reapplied: tester edits, additions and deletions survive restart. Do not delete the journal, change its tenant ID, reset stores or change credentials to force reseeding.

The startup adapter attempts each workspace independently. If credentials changed or a pack needs review, it preserves access and logs only aggregate prepared/preserved/pending counts. It does not print credentials, customer data or raw errors. Resolve the private journal/account mismatch through the existing authorized operator process; do not bypass authentication. Existing sync and backup jobs continue normally.

## Verification

Tests use the real engine in two independent businesses. They cover all three roles, real sales and stock changes, a committed-but-unacknowledged sale followed by safe retry, CSV/Excel/JSON exports and profit analysis, preservation of tester changes, restricted cashier cost/export/profit access, test-mode enforcement and copied-tenant journal refusal. The exact Railway container acceptance enables this pack explicitly and recreates containers without deleting volumes. A live prepared/preserved count is recorded only after deployment actually runs the pack.
