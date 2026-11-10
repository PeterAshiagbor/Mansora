# Decision log

## A. Defaults awaiting Mansora's approval

The specification (section 26) lists decisions Mansora must approve. Where the
software needed an answer to function, a conservative default was implemented.
**None of these is agreed policy.** Each is isolated so it can be changed.

| # | Topic (spec ref) | Default implemented | Where to change | Status |
| --- | --- | --- | --- | --- |
| D-01 | Brand identity (A) | Provisional deep-teal palette, product name "Mansora Sales & Stock", no logo | `@theme` blocks in the two `styles.css`; `packages/ui` | Awaiting assets |
| D-02 | Supported hardware (B) | None declared. Windows print queue + HID scanner input are implemented but untested on devices | `tests/hardware/README.md` | Awaiting hardware |
| D-03 | Costing method (D) | Moving weighted-average cost, re-averaged on purchases and restocked returns; cost snapshotted per sale line | `packages/domain/src/costing.ts`, `apps/desktop/src/core/stock.ts` | Awaiting approval |
| D-04 | Negative stock (E) | Blocked. An owner-only setting can allow it; changes are audited | `business.update`, `moveStock()` | Awaiting approval |
| D-05 | Discounts (F) | Staff with the "Apply discounts" permission may discount; others need a supervisor's credentials at the till. **Optional ceiling** (Settings → Discount limit, percent of the basket, owner only, **off by default**): above it only the owner can approve, at the till or by being the seller. The ceiling value itself is Mansora's policy decision | `sale.complete` | Awaiting limits policy |
| D-06 | Refunds (G) | Any seller can start a refund; it must be approved by someone with "Approve refunds" (own permission or credentials at the till). Each returned item is marked sellable (restocked) or not. Cash refunds require the processor's open shift | `refund.create` | Awaiting approval |
| D-07 | Refund of a credit sale | Refund first cancels what is still owed on that sale; only the remainder is paid out | `splitRefund()` | Awaiting approval |
| D-08 | Credit (H) | Optional due date per credit sale; no customer credit limit. Credit sales need the "Sell on credit" permission or supervisor approval | `sale.complete`, `credit.repay` | Awaiting approval |
| D-09 | Time zone | All timestamps UTC = Ghana time. Businesses outside GMT are not supported | `dayBounds()` | Awaiting confirmation |
| D-10 | Subscription expiry offline (I) | **No enforcement.** Suspending an account is recorded and shown to the shop as a notice; selling and syncing continue | `GET /v1/sync/pull`, dashboard alert | Policy must be defined before any enforcement is built |
| D-11 | Customer data (J) | Name required; phone, email and notes optional. Customer records sync to the cloud; Mansora support access never includes them | `customer.save`, report endpoint | Awaiting privacy review |
| D-12 | Hosting and privacy (K) | Nothing chosen. Act 843 review, hosting region, retention and processing agreements are not done | — | Blocks production |
| D-13 | Ownership (L) | Not a software matter. Repository is under the client's GitHub account | — | Awaiting written agreement |
| D-14 | Quantities | Whole units only. Goods sold by weight must be stocked in a small unit (e.g. grams) | `assertQuantity()` | Awaiting approval |
| D-15 | Prices at checkout | Always the catalogue price; no price override at the till, only discounts | `sale.complete` | Awaiting approval |
| D-16 | Support access scope | One scope, "reports": sales totals, payment methods, top products, stock counts. 1 hour to 3 days, owner-granted, revocable | `support.grant`, report endpoint | Awaiting approval |
| D-17 | Sync when suspended or deactivated | A suspended account still syncs (data is never refused). A deactivated laptop cannot sync but keeps working locally | `device()` in the API | Awaiting approval |
| D-18 | Cash in/out of till | Needs a supervisor (shift review permission or credentials) | `shift.cashMovement` | Awaiting approval |
| D-19 | Shift sign-off | A manager cannot sign off their own shift; the owner can | `shift.review` | Awaiting approval |
| D-20 | Owner password recovery | Mansora issues a one-time code (1 hour) with a recorded reason; it only works on that client's activated laptop; the owner chooses the password. Identity verification of the caller is a Mansora procedure, not enforced by software | `auth.recoverOwner`, recovery-code endpoint | Awaiting approval of the verification procedure |
| D-21 | Rebuilding a laptop from cloud data | Allowed only on a laptop that has never been activated, after the old one is deactivated. Whoever activates takes over the owner account; other staff need new passwords | `activation.activate` with `restoreFromCloud` | Awaiting approval |
| D-22 | Administrator MFA | Optional self-enrolment with password reauthentication; RFC 6238 SHA-1, six digits/30 seconds, ±1 step; five-minute one-use login challenge, ten-minute setup, five failures per five minutes per admin; ten one-use 80-bit recovery codes. Enabling revokes other sessions; disabling requires password plus fresh authenticator or unused recovery code and revokes all sessions. No password-only reset/override or automatic encryption-key rotation | `admin.ts`, `security.ts`; `docs/operations/admin-guide.md` | Default for C1; organization-wide enforcement and recovery policy await approval |

## B. Architecture decisions

| # | Decision | Reason |
| --- | --- | --- |
| A-01 | npm-workspaces monorepo; packages export TypeScript source | One contract shared by laptop and cloud; no build step between packages |
| A-02 | Fastify rather than NestJS | Smaller surface for a modular monolith; the spec allowed either |
| A-03 | One command engine as the only write path on the laptop | Permissions, validation, atomicity, audit and sync cannot be skipped by any screen |
| A-04 | Sync by replicating rows per committed command, not by replaying business operations on the server | The laptop is authoritative in v1; row replication is idempotent by construction and needs no duplicated business logic in the cloud |
| A-05 | Immutable tables enforced by SQLite triggers | Protection holds even against code that bypasses the engine |
| A-06 | Two PostgreSQL roles plus forced row-level security | Admin code physically cannot read business data; isolation does not depend on every query being written correctly |
| A-07 | `better-sqlite3-multiple-ciphers` for SQLCipher encryption | Maintained, synchronous (simple transactions), prebuilt binaries |
| A-08 | Backups are SQLCipher files re-keyed to an owner passphrase | Restorable on a new laptop; unreadable by Mansora or the cloud host |
| A-09 | PGlite (embedded PostgreSQL) for tests and the demo; real PostgreSQL in CI and production | Tests need no services; the same SQL and RLS are exercised. CI also runs the sync suite on PostgreSQL 16 |
| A-10 | Fewer packages than the spec's suggested layout (`domain` holds types, validation, permissions and the sync protocol) | They change together; splitting would add ceremony with no isolation benefit yet |
| A-11 | Development browser host for the desktop UI | Lets the real engine and UI be driven by automated browser tests without Electron |
| A-12 | Activation codes and device tokens stored only as SHA-256 hashes | A database leak does not yield usable credentials |
| A-13 | Pluggable immutable backup storage: filesystem fallback for existing installations; explicit all-or-nothing S3 configuration, path-style SigV4, SSE-S3 on by default, conditional single-part writes and verified identical retries | Preserve local behavior while making private object storage available without an AWS SDK. No automatic migration/failover or deletion policy; retention and real-provider rehearsals remain deployment decisions. HTTP is limited to loopback test/development endpoints |
| A-14 | Local API Compose stack bootstraps pre-created database roles, uses a separate schema-owning migration login without global CREATEROLE, and runs the API with a non-root/read-only container and restricted runtime login | Enables reproducible local/CI deployment without committing credentials or giving the running API migration privileges. Generated secrets and local bootstrap are development fixtures; production hosting, rotation and retention remain explicit deployment decisions |
