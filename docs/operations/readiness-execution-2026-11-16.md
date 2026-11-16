# Codex readiness execution — 16 November 2026

This is execution evidence for R16-01/02/06/07/09/10/12, not production-readiness sign-off. Claude's core/financial/provider tasks are tracked on the shared board. Claude independently opened PR #99; Codex reviewed its six-line arrears fix, reran 11 threshold/tax tests successfully, and merged it after CI passed. Codex did not launch or impersonate that Claude session.

## Verified now

- **R16-06:** fresh local security/gateway/owner-recovery run: 90 tests in 13 suites passed. Includes role/tenant isolation, invitations/TOTP, provider webhooks, private backup data, same-origin requests, per-shop budgets, recovery expiry/replay and recorded-owner proof.
- **Live public checks:** production health 200; anonymous admin clients 401; private test-account file 404; foreign-Origin application command 403. Anonymous VAT reporting returns HTTP 200 with application error `NOT_SIGNED_IN`, `ok:false` and no financial fields. A successful HTTP transport alone is not successful authentication.
- **R16-03 support:** reran the disposable laptop-loss drill on real application code. 71 sales before loss, 66 after recovery, exactly the five unsynced/unbacked-up sales lost; restored financial figures and numbering matched the cloud. Measured restore/catch-up 1.96 seconds excludes installation, backup retrieval and hosting. This is not a Railway or physical-laptop rehearsal.
- **R16-07:** main is `protected:false`; no repository rulesets; production environment has no required-reviewer rules. The connected GitHub identity has push but not admin/maintain rights. These settings need the repository administrator. No controls were bypassed or represented as enabled.

## R16-02: authenticated live TSB rehearsal

An off-by-default harness (`scripts/staging/tsb-acceptance.ts`) uses only the assigned owner credentials already on the service's private volume. It never prints, resets or emails credentials. With `MANSORA_TSB_ACCEPTANCE=r16-02-v1`, team-test mode and a registered shop-b, it authenticates through the public HTTPS gateway and:

1. Verifies an existing legal VAT obligation and enabled Mansora collection feature; it does not alter either to make a test pass.
2. Adds one labelled synthetic standard-rated product, quotes GHS 120 = GHS 100 base + GHS 15 VAT + GHS 2.50 NHIL + GHS 2.50 GETFund.
3. Completes one cash sale, reads the persisted tax snapshot and renders its receipt.
4. Fully refunds/restocks it, renders a credit note and reconciles the VAT reversal, stock and expected till cash.
5. Downloads/parses the real VAT workbook, retains only its digest/length in the evidence journal and syncs the facts to the cloud.
6. Closes only a shift created by this harness. Keeps financial records/audit history. Stable IDs prevent duplicate sales/refunds on replay. A failed assertion after sale commit attempts a compensating refund and explicitly flags any unresolved cleanup.

The journal is private (`/data/staging/tsb-acceptance-r16-02-v1.json`, mode 0600); a sanitised result is logged. Three local tests passed: complete HTTP flow plus idempotent replay/TSA isolation, interrupted-sale compensation/resumption, and rejection outside assigned team-test mode. This is authenticated gateway/API acceptance, not a witnessed browser click-through or physical receipt test. Live execution remains pending deployment and an observed result. The independent browser threshold test also passed: POS sales at exactly GHS 750,000 do not trigger; one pesewa more records the next-month obligation; a browser sale after the month boundary records GHS 15 VAT on a GHS 120 inclusive sale. No external turnover or manual registration is used. Controlled time and browser login/logout are local test fixtures; this is not a live historical clock change. The recovery stage explicitly remains **NOT RUN** until a verified independent backup exists; it must restore into an isolated replacement, never over production.

## R16-09: VAT reporting performance — new high-priority finding

Command: `npx tsx tests/performance/vat-benchmark.ts`. Disposable encrypted SQLite only, no production connections. Full-period stress shape: three lines per sale, 10% of sales retain collection-disabled snapshots. Five warmed measurements; the listed p95 is the slowest of five, not a statistically strong production SLO. All independently calculated recorded-output, historical-exposure and payable assertions for VAT, NHIL and GETFund, plus classification assertions, passed. The earlier exploratory run (retained as `vat-readiness-initial-2026-11-16.json`) measured 6,949 ms median and 1,282 MiB RSS at 50,000 sales; the repeated measurement below demonstrates timing/memory variability, not a claimed optimisation. Raw environment/results: `tests/performance/results/vat-readiness-2026-11-16.json`.

| Sales | Sale lines | Local median | Slowest / sample p95 | Process RSS after run |
| --- | --- | --- | --- | --- |
| 1,000 | 3,000 | 61 ms | 85 ms | 166 MiB |
| 10,000 | 30,000 | 750 ms | 956 ms | 496 MiB |
| 50,000 | 150,000 | 4,157 ms | 4,391 ms | 1,230 MiB |

**High priority:** the 50,000-sale run's process RSS exceeds production's configured 1,000,000,000-byte memory allocation. This is not a measured production crash or a per-request peak measurement, but it identifies a credible memory-exhaustion risk before large-shop rollout. Other service workloads also share that memory. Do not extrapolate these local timings to Railway's 0.5 CPU allocation.

**Claude implementation handoff:** profile `vatReport`/`taxStatus` in `core/tax.ts`. Bound retained historical rows and repeated JSON parsing; preserve original-period exposure, refunds, carry-forward, classification, immutable snapshots and filed-period controls. Consider streamed aggregation/persisted monthly summaries with a defined correction/invalidation mechanism. Codex owns benchmark/regression validation; no core query changes were made in this pass. Fixture setup initially attempted to update immutable sales and was correctly rejected; the published benchmark instead inserts complete immutable facts from the outset, without dropping or weakening triggers.

## External dependencies and physical acceptance

- **R16-01:** owner confirmed Google Cloud Storage is not set up yet and will be configured later. Preserve the Google destination decision; no alternative bucket, subscription upgrade or billing change was made. Backups and the production-like restore remain blocked; no verified off-site copy is claimed.
- **R16-07:** repository/provider account owners must set branch protections/reviewers and supply evidence of MFA, access review and credential rotation. Current connector cannot apply administrator-only settings.
- **R16-10:** physical acceptance worksheet: record operator/witness, Windows build/signature, device/printer/scanner/drawer models, starting stock/cash, each sale/refund/receipt ID, internet/power-cut times, reconnect/outbox convergence, duplicate checks, and restore/installation elapsed time. Use synthetic data on a test till. Verify printed VAT/credit-note legibility, scanner/camera input, drawer pulses, update failure/rollback and replacement-laptop recovery. Hardware/witness/signing access is not available here; none of these items is marked passed.
- Observed inbox delivery of outage/recovery alerts, provider settlement and GRA certification still require their own acceptance. No test messages, charges or GRA submissions were sent by this pass.
