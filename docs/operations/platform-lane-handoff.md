# Codex session 1 — Platform lane

Claimed on 2026-11-11 by the existing review/domain/email Codex session, at the owner's explicit request to take a Codex lane from the plan. Source: [roadmap §6a](product-audit-and-roadmap.md#6a-who-builds-what) and the [shared task board](../codex-tasks.md).

This session owns **C36, C37, C38, C48 and C49** under the latest rebalanced plan. C36 is claimed; the others are reserved in sequence. Codex session 2 retains C35/C39–C42/C50/C51; Claude retains engine/sync/billing and its assigned tasks. Concurrent #47 updates are preserved. No website build or interface redesign is part of this lane.

## Execution order and current prerequisite

1. Complete this session's existing C32 runtime wiring, [PR #46](https://github.com/PeterAshiagbor/Mansora/pull/46), then integrate/deploy the existing C43 data pack, [PR #48](https://github.com/PeterAshiagbor/Mansora/pull/48). Retarget #48 to default after #46 merges. Preserve all other sessions' commits.
2. C36: provision and register a new workspace without restarting the service.
3. C37: explicit client deployment mode, trusted client identity and isolated sign-in throttling, browser owner recovery.
4. C38: independent protected backups, isolated restore drill, uptime monitoring and error alerts.
5. C48: signed Windows installer and automatic updates, initially with a test certificate.
6. C49: silent receipt printing and cash-drawer signal in the packaged Electron shell.

At claim time, the six refreshed feature workflows for #46 are **queued**. Its original feature head passed all six workflows, and the integrated local suite passes 294 tests/43 files with browsers and no skips. Those results do not replace current-head release checks. Keep CI/deployment gates enabled; do not mark C32, C43 or any new task complete before the corresponding merged/deployed verification.

Both actual test businesses already contain the owner portion of C43: sample catalogue, customers/suppliers, purchases/expenses, four owner/credit sales and partial repayment each. Live edits, CSV/Excel/JSON exports, sales/profit analysis and mobile sign-in/product/dashboard walkthroughs pass. Full manager/cashier-owned sample history and restart automation remain pending #48 deployment. Both Resend invitations are delivered and both passphrases activated; preserve their journal and operation ID.

## Current prerequisite update

After the lane claim, GitHub merged #46 as `473f64f` and #48 as `cf4fa36` (2026-11-11 21:07 UTC). This session did not issue those merge calls. The code prerequisite is now on default, and C36 preparation has begun on `codex/C36-workspace-provisioning`. Exact merged CI remains queued and Railway deployments `15d83ea4` / `393ce632` are WAITING, so neither release is represented as live or fully accepted. The sample-pack environment opt-in is not yet enabled. Keep the previous live-data and invitation evidence separate from the queued release.

## C36 — workspace provisioning

Reserved branch: `codex/C36-workspace-provisioning`, targeting default.

Initial implementation review: `loadWorkspaces` opens a fixed registry, the gateway builds a separate map, and background sync/backup iterate the original array. A third shop must join all three consistently. Owner onboarding also needs a tenant-bound activation proof: do not introduce a platform endpoint that silently sets an owner password or allow public activation to select an arbitrary upstream API. Coordinate the narrow existing engine-contract requirement with Claude before changing protected code.

Implementation surface: `scripts/staging/**`, `scripts/railway/**` and a narrowly coordinated administrator integration boundary. Today bootstrap fixes two shops and the gateway, sync loop and backup loop capture the workspace list at startup. Provisioning must update all of those lifecycles, not just expose a new URL.

- Use existing authenticated administrator/client-activation contracts; keep platform metadata separate from retail records. No unauthenticated self-signup or new default staff accounts.
- Persist an idempotent provisioning operation and private per-workspace keys/registry before advertising the workspace. Never overwrite an existing store, rotate an existing key or adopt an unrelated tenant on retry.
- Register exactly one live engine per workspace; coordinate concurrent requests, background sync/backup and shutdown. Do not require a redeploy or terminate existing sessions to add a shop.
- Keep test data opt-in and limited to registered team-test businesses. New real-client workspaces must start without fictional sales or test credentials.

Acceptance: create a third shop through the actual administrator path without a process restart; sign in and save/read a record; prove all three shops are isolated; retry/concurrent provisioning does not duplicate stores or accounts; partial failure preserves existing shops; sync/backup and shutdown include the new shop. Record live and container evidence separately.

## C37 — gateway client mode and recovery

Reserved branch: `codex/C37-client-gateway`, targeting default after C36.

- Make banner and resource budgets explicit deployment configuration. Preserve the current team-test banner and all existing caps until an explicitly configured client mode replaces them with tested bounds. The owner's instruction to retain hardening takes precedence over literally deleting limits in the earlier roadmap.
- Derive client address only from a reviewed trusted-proxy boundary. Never trust an arbitrary incoming forwarded-address header. Throttle using workspace/account and trusted client address with bounded state; keep abuse controls while preventing one shop's mistakes from locking out unrelated shops.
- Owner recovery must use a recorded owner address, generic responses, bounded requests and a short-lived, single-use proof. Keep credentials and proof out of logs, exports and URLs where possible. Do not infer ownership from an email in a request.
- If the existing protected engine recovery contract cannot support the required proof, document the narrow change for Claude and coordinate it. Do not edit protected auth code or write password hashes directly.

Acceptance: account/tenant/address throttle isolation behind the hosting proxy; forged forwarded headers fail; expiry, replay and enumeration cases for recovery; origin/cookie/role/body/import/session controls still pass. Test both team-test and client configuration. Do not silently convert the live team-test environment into a production client environment.

## C38 — backup, recovery and monitoring

Reserved branch: `codex/C38-recovery-monitoring`, targeting default after prerequisites.

- Build on C32's selected backup storage and sanitized telemetry, not a second storage path. Cover PostgreSQL, encrypted retail stores, registry and the private keys needed to recover them. A second directory on the same volume is not off-site protection.
- Inventory existing provider capabilities and destinations first. Record provider/region, access boundary, retention, recovery objectives and key custody before changing policy or introducing a paid destination. Never publish keys or backup contents as CI artifacts.
- Rehearse a restore into an isolated destination using synthetic/test data; verify authentication, tenant isolation, balances, stock, sync continuity and backup integrity. Never overwrite the live volume/database for the drill.
- Uptime monitoring must work when the app is down. Deliver a sanitized error/availability alert to the authorized human recipient; demonstrate it using a canary or isolated deliberate outage, without disrupting other sessions or client shops.

Acceptance: an independently stored backup and protected keys can recreate the test service; evidence includes timestamps and integrity checks, an authenticated post-restore workflow and an observed alert. A green restart or provider API acceptance alone does not complete this task.

## C48–C49 — reserved offline tier

C48 branch: `codex/C48-signed-updates`, after browser readiness/recovery. Build and test signing/update plumbing with a test certificate; keep real signing credentials private and explicitly supplied by the owner. Verify release integrity, update installation and failure recovery in a Windows test environment. Do not claim a trusted production signature or hardware acceptance from a Linux build.

C49 branch: `codex/C49-printing-drawer`, after C48. Use the existing Electron shell and a narrow permission-checked bridge; update the exact bridge smoke-test allowlist alongside any intentional contract change. Verify silent printing without a dialog and the intended drawer pulse against real equipment. Keep browser behavior and unsupported hardware explicit; mocks do not count as physical acceptance.

## Working and handoff rules

One branch/PR per task; branch from current default, preserve concurrent changes, run required typecheck/build/tests/audit and inspect CI. Change no Claude-owned engine/sync/billing file without coordination. Keep the current UI, hardening and actual-platform test records intact. Update the board and this document with exact completed/pending evidence when work stops. Reserve C42's board archiving for Codex session 2.
