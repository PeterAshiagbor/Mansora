# End-to-end engineering, security and QA review — 14 November 2026

Tracking: [issue #70](https://github.com/PeterAshiagbor/Mansora/issues/70).
Reviewable changes: [draft PR #71](https://github.com/PeterAshiagbor/Mansora/pull/71).
Review branch: `codex/review-70-deployment-readiness`.
Starting branch: `claude/relaxed-lovelace-0179ut`.
Starting commit: `f67b5153f5120aaeb44e694a26b297ccd3a1ada2`.
Refreshed onto `38e33de5fe5b2b08d02ca0e54621dc1a9af02823` after concurrent PR #67 merged at 12:21 UTC. Both handoffs and both sets of financial fixes are preserved. Expanded cedi prefixes and overnight-shift helpers from #67 remain. Verification is repeated on the combined source; earlier counts below are labelled historical.

**Production release is blocked.** This review fixes evidenced shared-domain money defects and adds a verification gate that refuses silent browser skips. Passing software tests does not close the remaining protected-engine finding, independent recovery/alert acceptance, provider onboarding, legal decisions or Windows/hardware acceptance below. No merge, deployment, production migration, live business record, actual charge or outbound email was initiated.

## Scope, baseline and coordination

The supplied engineering/security/QA brief was read in full. The clean checkout was isolated on the review branch. No tracked `AGENTS.md` existed. README, package scripts, Vitest runner, architecture/API/report definitions, historical phase/security reports, current readiness reports, billing architecture/provider checklist, decision log, recovery instructions, production/container guidance and current collaboration board/handoffs were inspected. Historical test counts and “not built” statements were not treated as current facts.

The current board and issue #39 assign core/sync/device/billing and C38/C48/C49/C51/C55 to Claude. C17 merged in #69 before this baseline; draft #68 is an unfinished recovery handoff. PR #67 subsequently merged during this review. The final tree now includes its engine/billing/gateway fixes, camera UI, sample-shop imports, supplier/reorder features, shift rules and legal drafts; queued follow-up work is not inferred as complete. No active task was taken over. R70-05 was independently corrected by the existing owner in #67; the unresolved R70-06 remains a handoff. Protected-source findings below are handed back with concrete required changes. The board's default-branch claim would trigger automatic live deployment; the claim was therefore recorded in issue #70 and committed only on this review branch, preserving the brief's no-deploy boundary.

## Actual system and trust boundaries

| Surface | Entry / path | Rules, storage and isolation |
| --- | --- | --- |
| Shop UI | `apps/desktop/src/renderer/App.tsx`, renderer pages | React client; built browser tests use the development host and the actual engine. The browser-hosted version depends on the server and is not an offline browser app. |
| Native desktop | `apps/desktop/electron/main.ts`, `preload.ts` | Restricted bridge; trusted sender/frame check; sandbox/context isolation, Node disabled, navigation/popups denied; SQLCipher key through OS safeStorage. Source/build review only here, not a native Windows acceptance. |
| Command engine | `apps/desktop/src/core/engine.ts`, `commands/{auth,catalog,sales,people,reports,system,billing}.ts` | Session/role/input checks before commands; mutating commands atomically commit facts, audit and outbox. Owner, manager and cashier with explicit permission grants. |
| Cloud API | `apps/api/src/{server,app}.ts`, `modules/{device,admin,contact,leads}.ts` | Device activation/recovery/invitations/sync/snapshot/backups; administrator auth/MFA/client/plan/onboarding/support/audit; public contact/demo intake. PostgreSQL application roles separate platform and tenant data. |
| Billing | `apps/api/src/billing/{routes,subscriptions,invoices,payments,jobs,reports}.ts`, provider adapters | Administrator/device authorization, signed payment links, verified/deduplicated webhooks, invoices/credits/refunds/collections, encrypted mandate tokens. Sandbox and fake-Paystack evidence only. Hubtel is a refusing stub; client-owned payment collection (“System B”) is not implemented. |
| Hosted shop gateway | `scripts/staging/{gateway,gateway-policy,server,workspace-onboarding,owner-recovery}.ts`, `scripts/railway/server.ts` | Same engine behind workspace-bound HttpOnly cookies, same-origin writes, bounds/throttles, encrypted per-shop SQLite, dynamic owner setup and recovery. Process-local budgets; explicit single-instance capacity. |
| Sync and reports | `core/sync.ts`, `modules/device.ts`, `packages/domain/src/sync.ts`, report commands | Durable local outbox, tenant from authenticated device, atomic event deduplication/upsert guards; local reports and consent-limited cloud summaries. Software retry/restart results do not establish disaster recovery. |
| Deployment/recovery | `infrastructure/**`, `.github/workflows/**`, backup/storage/restore modules | Separate migration/runtime roles, container hardening, immutable encrypted shop backup storage, browser/installer CI. Real off-site database + shop volume + key recovery and delivered alerts remain acceptance gates. |

The refreshed tree also includes camera scanning UI/fallback, sample-shop Excel import and guide sheet, supplier details/reorder lists, generated role guidance, overnight-shift indicators, new supplier fields and migration 9. The combined 405-test run includes the new import, supplier, shift/roles and prototype archive/schema/restore scenarios. These are covered where represented by that suite; actual camera/USB scanner operation is not verified here. The C38 snapshot/archive prototype is now in the merged tree but remains unintegrated, so no runtime off-site protection is inferred.

The documented one-device-per-business model and whole-unit quantities remain the baseline. No new tax, pricing, retention, quantity or financial policy was chosen. POS cash/card/mobile-money records do not prove provider settlement. Completed sales are corrected with refunds; no separate new void workflow was invented.

## Confirmed findings

| ID | Severity | Workflow / evidence | Root cause and affected source | Fix / verification |
| --- | --- | --- | --- | --- |
| R70-01 | P1 | Amount input: `parseGHS('1,2.50')` returned 1250 pesewas, silently accepting malformed grouping. Other examples: `,125`, `125,`, `1,,250`. | `packages/domain/src/money.ts:21`: commas removed before validation. | Validate plain digits or complete three-digit groups first, then parse through integer arithmetic. Valid currency prefixes/grouped/plain values retained. New regression failed before fix and passes afterward. |
| R70-02 | P1 | Pricing/stock/cash: `priceCart` and `settlePayments` returned 9007199254740992 from MAX_SAFE_INTEGER + 2, losing one pesewa. Aggregates and reconciliation could similarly overflow. | `money.ts:78`, `sale.ts:104`, `shift.ts:18`: unchecked Number additions; individual operands being integers did not make the total safe. | Exact BigInt accumulation with safe-input/output checks; validate allocation weights; reject unsafe tender/cart/reconciliation results before persisting through engine transactions. New boundary regressions failed before fix and pass afterward. No historical data rewrite. |
| R70-03 | P1 | Receiving: 5,000,000 units at 100,000,000,000 pesewas and 5,000,001 units at 99,999,999,999 yielded unit cost 100,000,000,000; exact half-up result is 99,999,999,999. Inputs are within existing engine bounds. | `packages/domain/src/costing.ts:8`: Number multiplication/addition rounded before BigInt division. | Calculate weighted numerator and denominator as BigInts from validated whole inputs, retaining existing half-up policy. #67 independently merged the BigInt cost fix; this branch retains it and adds input checks and an exact quantity sum. Exact fixture, ordinary half-up and negative-stock cases verified. |
| R70-04 | P2 | Verification: existing browser suites explicitly use `describe.skipIf(!pw || !built)`, so ordinary `npm test` may be green without exercising UI. | Test-runner prerequisite and result completeness were not enforced by the test command. | `scripts/verify-tests.mjs`, `infrastructure/verification.test.mjs`, package scripts and main CI now require built UIs, a launchable default Chromium, pdftotext, nonempty browser assertions, all tests passed, zero skips/todos/failures. A missing-browser run actually failed closed. Core-only `npm test` remains available with its existing behavior. |
| R70-05 | P1 | Expenses: authenticated `expense.create` accepted `{amount:100, expenseDate:'2026-99-99', ...}`; SQLite retained the record while `expense.list` over 2026 returned no rows and total 0. | `apps/desktop/src/core/commands/people.ts:129`: shape-only date regex. `expense.list` uses lexical date comparisons. | **Fixed by existing owner in merged #67.** The refreshed tree uses `zCalendarDate` for expense/credit dates and validates reversed expense ranges. `tests/integration/review-fixes.test.ts` supplies regression coverage; included in combined verification. No historical financial data was rewritten. |
| R70-06 | P2 | Stock count: a random nonexistent product UUID with `counted:0` returned a successful count ID and `adjusted:0`. | `apps/desktop/src/core/commands/catalog.ts:178`: missing balance treated as zero and skipped before product existence is checked. | **Open, protected-owner handoff.** Validate every product exists before delta/no-op handling; preserve #67's duplicate-product rejection; assert whole transaction/audit/outbox rollback on invalid mixed counts. |
| R70-07 | P1 | Release control: GitHub reports the auto-deploy default branch as `protected:false`; repository ruleset inventory is empty. | No enforced review/check protection on the release source; historical CI success cannot prevent an unchecked push. | **Open, repository-admin action.** Require review and the current mandatory checks before updates/merges, constrain bypass/direct pushes and verify allowed release/rollback permissions. The connected account has push but no admin/maintain permission; no repository settings were changed. |

The extreme-amount fixtures show concrete correctness defects, not observed client losses. No P0 exposure was confirmed in the reviewed/executed boundaries; this is not an exhaustive penetration-test claim. Open findings remain open even when current regression tests pass.

## Workflow coverage and representative evidence

| Workflow | Executed evidence / checked boundary | Limit |
| --- | --- | --- |
| Activation, sessions, permissions | `tests/integration/engine.test.ts`, `tests/security/{hardening,admin-totp,admin-invitations}.test.ts`, browser UI/admin-MFA/staff-invite flows: session lock, failed credentials, one-time codes, MFA/recovery replay and unauthorized commands. | MFA remains opt-in per D-22; organization-wide policy and recovery custody require operator acceptance. |
| Onboarding and client isolation | `tests/security/isolation.test.ts`, `tests/staging/{workspace-onboarding,gateway,gateway-client-mode,owner-recovery}.test.ts`, browser team staging: third shop, separate sessions, cross-tenant reads/writes, exports/report paths, consent/revocation/audit. | Live third-client and deployed proxy/recovery acceptance not performed. |
| Products, imports, purchasing and stock | Engine/retail-pricing tests and browser desktop/client-readiness/progressive-interface journeys: actual Excel, malformed/duplicate imports, import retry, count, purchase averaging, damage. | R70-06 remains; decimal quantities/pack-size features on other task lanes are not inferred. |
| Sales, supported methods, discounts, receipt and credit | Browser cashier/desktop workflows, engine/domain tests: catalogue prices, split tender/change, supervisor/owner approval, stock deduction, receipt escaping, repayments and authorization. | Tender entry is not provider-confirmed wallet/card settlement. |
| Refunds and financial reports | Engine/domain/wallet/reporting tests and browser cashier workflow: restock vs unsellable, partial/credit refunds, limits, original cost snapshots, period accounting; billing cross-period refund tests. | Separate void/return features absent from current command surface are not new requirements. R70-05 is fixed in the refreshed #67 source; combined verification includes its date/range regression. |
| Shifts, expenses and cash reconciliation | Browser desktop workflows verify approved cash in/out, till expense, exact expected cash, short count and other-person sign-off; engine cash invariants. | Invalid date path R70-05 is additional negative coverage beyond the existing suite. |
| Offline, restart, reconnection and sync | `tests/sync/{sync,crash,recovery,activity}.test.ts`: 100 offline sales, restart, lost acknowledgements, reordered/concurrent raw replay, interrupted transaction, rebuild/relink and re-send after rollback. Six sync tests also passed on PostgreSQL 16.16. | Browser demo is not native Electron/offline hardware evidence. No multi-device/multi-replica scale guarantee. |
| Admin subscriptions, billing and collections | Billing lifecycle/receivables/non-payment/failed-collections/webhook/Paystack-adapter tests, browser billing/interface/communications/PDF flows: sandbox checkout, invoice allocation, refund/receipts, retries, invalid signatures, concurrent replay, tenant boundaries. | No actual provider sandbox account, live charge, merchant mandate, payout or email delivery was exercised. |
| Backup, restore, migration and startup | Engine encrypted backup/restore/passphrase tests, sync recovery, backup-storage/security tests; all migrations applied to disposable PG16; restricted runtime role verified with real API sale/sync. | Off-site full-system/key recovery and Windows restore not witnessed; local Docker image run hit disk exhaustion. |
| UI/error handling and accessibility | Chromium desktop/admin workflows, recoverable failures, draft retention, keyboard shortcuts, pagination/export/print, phone/equivalent zoom and axe tests; page errors asserted in existing journeys. | These assertions are bounded to their journeys, not evidence of zero errors on every route or native screen-reader usability. |

### Additional real PostgreSQL runtime rehearsal

A new disposable database was provisioned through `prepareRailwayDatabase` on PostgreSQL **16.16**. Migration and runtime logins were separated. Runtime flags were verified as non-superuser, no CREATEDB/CREATEROLE/BYPASSRLS/INHERIT. Attempts to assume the migration role, create a table or select business sales through the platform role were refused. Through the real local API and restricted runtime: activate a synthetic shop → sell three of twenty rice units for 24000 pesewas → sync twice → exactly one cloud sale, stock 17. A different tenant context returned no sale rows. This used no live database or credentials.

## Read-only hosting inspection

Railway's connected control plane reports project **Mansora team testing**, environment named `production`, with no staged changes. The environment name is not evidence of production readiness. The existing Mansora deployment `02a48ec5-51e4-40ff-94bb-87b8614b4027` is **SUCCESS**, built from the other session's merged default `38e33de`, in `sfo` with one replica. PostgreSQL is in `sfo`; the separate monitor is in `us-east4-eqdc4a`. The shop `/data` volume is 1024 MB, the PostgreSQL volume 5000 MB, and this project's bucket inventory is empty. This does not exclude external storage or establish backup schedules/key custody/restore acceptance. No variable values or credentials were retrieved and no hosting settings changed.

GitHub read-only release-control checks also returned an empty ruleset inventory and `protected:false` on the default branch (R70-07).

Direct unauthenticated HTTP reads of the public root, health, administrator/device auth boundaries and sensitive dotfile paths all returned **ECONNREFUSED from this execution environment**. Therefore no live HTTP/security-header/authentication acceptance is claimed; a successful control-plane deployment is separate evidence from reachable business journeys. No inference that the application itself is down is made from this network restriction.

## Commands and actual results

Local environment: Linux x86-64, Node 24.22.1, npm 11.9.0, SQLCipher native module, Playwright 1.65.0, matching default headless Chromium (151.0.7922.34 in the final run), pdftotext, Docker and disposable PostgreSQL 16.16.

| Command/check | Actual result |
| --- | --- |
| `npm ci` | Passed; lockfile preserved. Repeated before final verification to remove changes from no-save browser installation. Browser client lives outside the checkout and is linked for local verification. |
| `npm run typecheck` | Initial and final preflight passed. |
| `npm run build` | All three applications and Electron bundles build. Vite warns about future native-config `__dirname` support and the desktop JS chunk above 500 kB. These are not build failures or hardware evidence. |
| `npm audit --json` / `npm audit --audit-level=moderate` | Baseline and final preflight: zero reported vulnerabilities. This does not establish absence of unknown vulnerabilities. |
| Initial `MANSORA_REQUIRE_PDF_TEXT=1 npm test -- --maxWorkers=2 --reporter=default --reporter=json ...` | 373 passed in 67 files, zero skipped, about 298 seconds. Shared-domain edits began during this run; use per-finding before/after regressions and the final rebuilt-tree run for change verification, not an immutable-baseline claim for this first run. |
| New money regression before fixes | All four scenarios failed, establishing the malformed-grouping, unsafe aggregate, weighted-cost and reconciliation defects. |
| Focused domain/boundary/engine/retail-pricing run after fixes | 52 passed in 4 files. |
| `npx vitest run tests/integration/money-boundaries.test.ts --maxWorkers=1` | Additional engine regression passed after the full run: an unsafe sale cost commits no sale, items, payment, stock movement, audit or outbox change; a corrected retry succeeds and a duplicate retry has no second effect. |
| `node --test infrastructure/verification.test.mjs` | 2 passed; accepts complete results and rejects green-but-skipped/empty/failed/incomplete/non-browser reports. |
| `TEST_DATABASE_URL=<disposable PG16> npx vitest run tests/sync/sync.test.ts --maxWorkers=1 ...` | 6 passed, zero skips; repeated successfully against a fresh database after the #67 refresh, including migration 9. |
| Restricted-runtime API/database rehearsal (before #67 refresh) | Passed all assertions described above. Synthetic credentials were not logged. |
| `npm run verify:release` with missing matching browser | Failed before tests, as intended; no success claimed. Installed the client-matched default browser before retry. |
| Pre-refresh `npm run verify:release` | Passed: infrastructure Node tests, typecheck, all builds, zero-vulnerability audit, **377/377 tests in 68 files**, zero skips/todos, real Chromium E2E and required PDF text extraction; Vitest about 274 seconds. |
| Combined `npm run verify:release` after refresh onto #67 | **Passed: 405/405 tests in 78 files, zero skips/todos, 80 browser tests in 20 files, PDF text checks, three infrastructure tests, typecheck, all builds and zero-vulnerability audit.** Vitest about 299 seconds. |
| Railway Compose image/start/restart smoke | Blocked locally while extracting `postgres:16-alpine`: `no space left on device`. No image/runtime pass claimed. No shared/live volumes were deleted. CI image acceptance remains required. |
| GitHub ruleset/default-branch API reads | Empty ruleset inventory; default branch `protected:false`. Release-control gap R70-07 remains open. |
| `git diff --check` | Passed at review checkpoints; rerun at final handoff. |

The strict release command is a **software verification gate**, not a deployment action or approval of open release conditions. No business-policy decision is encoded in it.

The full local run includes **80 browser tests in 20 E2E files**. The additional one-test engine regression above was added afterward and passed. PR #67 then expanded the source and tests further. The combined-run result and exact-head CI/container/Windows evidence are recorded below and in PR #71 / issue #70; older commits' results do not establish final-tree acceptance.

## Reproduce the software release checks

Use an isolated checkout and synthetic data; Node >=22.12, Chromium prerequisites and Poppler must be installed. Keep the lockfile unchanged.

```sh
npm ci
# Install the browser client outside the checkout, so the locked application tree stays exact:
npm install --prefix ../mansora-browser-tools --no-package-lock playwright@1.65.0
# POSIX example; omit these links if the matching client is already available locally:
ln -s "$(cd ../mansora-browser-tools/node_modules/playwright && pwd)" node_modules/playwright
ln -s "$(cd ../mansora-browser-tools/node_modules/playwright-core && pwd)" node_modules/playwright-core
node ../mansora-browser-tools/node_modules/playwright/cli.js install chromium --only-shell
# Install poppler-utils through your OS package manager before this step.
npm run verify:release
```

`npm run test:e2e` now builds both UIs and refuses missing browser/PDF prerequisites or skipped E2E results. `npm test` is still the ordinary developer/core-only entry point and can skip browser suites. Main CI uses the strict gate. Never point `TEST_DATABASE_URL` at an existing or live database; test helpers apply migrations and create synthetic records.

## Open release gates, owners and acceptance

| Gate | Owner / required evidence |
| --- | --- |
| R70-06 protected core fix | Claude engine owner: reject nonexistent products even for zero-count no-ops, with regression coverage. R70-05 date validation is already merged in #67 and included in combined verification. |
| Release-source protection | Repository administrator: enable and read back required review/check protection on the default/release branch; current API evidence is `protected:false` and no rulesets. |
| Independent recovery | C38 owner/operator: private off-site destination, database + encrypted shop stores + keys captured consistently, separate key custody, isolated full restoration and reconciled records/authentication/sync. #68 is not completed runtime protection. Record recovery-point/recovery-time requirements approved by Mansora and measured rehearsal results. |
| Delivered alerts | Operator: correct the privately configured recipient that bounced, then witness controlled outage/recovery alerts. Historical provider acceptance is not inbox delivery. No suppression removal or test email was attempted here. |
| Hosted pilot acceptance | Operator/owner: approve client mode, exact trusted proxy peer/header behavior, third-client setup, owner recovery, account isolation and restart on the actual deployed instance. Do not infer live acceptance from these local tests. |
| Provider/commercial/legal | Mansora: provider account/test keys/webhook registration, test-payment/mandate/refund/settlement reconciliation, issuer/tax data, legal/privacy/region/retention decisions. Honor resolved D-28 and D-36; do not reopen approved policy. |
| Windows/offline tier | C48/C49 owner and team: signed installer, update recovery, physical Windows laptop offline/restart, printer/scanner/drawer and replacement-laptop backup restoration. Passing browser tests and historical unsigned CI do not satisfy these. |
| Production operations | Operator: secret custody/rotation, approved retention, monitored private backup capacity, measured capacity/load on supported hardware/real PostgreSQL/WAN, access/review/rollback procedures, exact-commit CI and change approval. Existing 10-workspace/process-local limits are not an enterprise scale claim. |

No external penetration test, multi-instance load/chaos test, real provider test, secret/configuration-value inspection or authenticated live journey was performed. Only the bounded read-only hosting inventory above was checked. Those are unverified areas, not confirmed successful behavior.

## Nontechnical acceptance script (synthetic environment only)

1. Create two clearly labelled sample businesses and open them in separate browser profiles. Confirm each profile has only its own products, customers and sales. Confirm a cashier cannot manage staff or see costs/profit.
2. In the first business create “Acceptance rice” with 20 units, unit cost GHS 60 and selling price GHS 80. Record a two-unit purchase at GHS 60; confirm 22 units. Open a GHS 100 float and sell three units for GHS 240; confirm receipt and remaining stock 19.
3. Retry completion of the same submitted basket through the test harness: exactly one receipt/payment/sale and one three-unit deduction. A new basket must have a different ID.
4. With supervisor approval refund one sellable unit for GHS 80; confirm stock 20, net sales GHS 160, COGS GHS 120, gross profit GHS 40 and expected cash GHS 260. Unsellable returns must not add stock.
5. In the native laptop test environment disconnect the cloud, complete supported sample transactions, close/reopen, reconnect and retry synchronization. Confirm local/cloud counts, money and stock agree exactly once. A browser that loses its server cannot perform this native offline test.
6. Create a sample credit sale, record a partial repayment and refund; confirm debt reduction precedes payout and repayments do not increase sales revenue. Close the shift, explain any variance and have a different authorized person review it.
7. Try unauthorized actions and a cross-business URL/record through the security harness; expect rejection. Ask Mansora to view reports before consent (refused), grant briefly (allowed and logged), then revoke (refused after sync).
8. Use only sandbox billing: issue an invoice, approve a sandbox checkout, confirm one payment/allocation/receipt after replay, and check sandbox money is excluded from real revenue. Print a long invoice; verify the last line, totals, repeated headings and A4 pages.
9. Restore a synthetic backup into a clean replacement installation and verify credentials, sales, stock, credit and unsynced records. Separately witness the operator's full cloud + keys off-site recovery and alerts. Never restore over a working business.
10. Record who witnessed each check, exact version, screenshots/results and unresolved problems. Do not put passwords or client details into the acceptance record.

## Readiness assessment

| Target | Assessment |
| --- | --- |
| Internal demo | Conditional: use synthetic data, current supported workflows and explicit known limitations. Combined strict local checks are green; exact-head CI results are linked in PR #71 / issue #70; R70-06 must be disclosed; R70-05 is corrected in #67. |
| Controlled real-client pilot | **Not accepted by this review.** Resolve the remaining protected stock-validation and release-source-protection findings, close independent backup/restore and delivered-alert gates, confirm current client-mode/proxy/recovery acceptance and applicable legal/provider terms first. |
| Production | **Blocked.** Require the above, exact combined-commit CI/container evidence, approved operational/security procedures and tier-appropriate Windows/hardware acceptance. Passing unit/browser tests alone is insufficient. |
