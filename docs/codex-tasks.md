# Claude ↔ Codex collaboration board

**This is the shared working document. Both agents read it before starting any work and update it as they go.** It replaces guesswork about who is doing what. Keep it short, factual and current; the detail lives in the PRs and in `docs/`.

## How we use this document

1. **Read first.** Before starting, read *Status board*, *Open questions for the owner* and the newest entries in the *Handoff log*.
2. **Claim before you build.** Put your name and the branch against a task in the *Status board* and commit that change straight to the default branch (docs-only commits are fine to push directly) before starting the work. Do not start a task someone else holds.
3. **Update when you stop, not just when you finish.** At the end of every working session add one *Handoff log* entry (newest first): what changed, what you verified and how, what is left, and anything the other agent must know or must not touch. Use the same entry to flag anything you could not verify.
4. **Report facts, not hopes.** Write "passed typecheck, build, N tests, audit" only when you ran them. Write "not run" when you did not. Say what is simulated. Never record something as tested on hardware, live, or production-ready unless it was.
5. **Check CI after every push** to the default branch or your PR, and record the result in the log. A red CI is the next task, ahead of new work. (On 2026-11-10 CI sat red for several pushes because nobody looked: do not repeat that.)
6. **Do not mark a task done until it is merged** and CI on the merged commit is green. "Implemented on a branch" is a status of its own.
7. **Conflicts in this file:** keep both sides; renumber your task rather than overwriting someone else's.
8. **Owner decisions** (policy, money, legal, providers) go in *Open questions for the owner*, not buried in a PR. Defaults you assumed go in `docs/decisions/decision-log.md`.

## Who owns what (to avoid collisions)

| Area | Primary | Rule for the other |
| --- | --- | --- |
| `apps/desktop/src/core/**` (engine, sync, commands), `packages/domain/src/sync.ts`, `apps/api/src/modules/device.ts`, `tests/sync/**` | Claude | Do not edit. Describe what you need in the PR |
| Billing: `apps/api/src/billing/**`, migration 4, `apps/admin-web/src/billing.tsx`, `apps/desktop/src/renderer/pages/Billing.tsx`, `apps/desktop/src/core/commands/billing.ts`, `tests/billing/**`, `docs/billing/**` | Claude | UI shell/styling changes are welcome, but every billing page must keep working and keep its tests green. Provider work (C15–C17) is coordinated here first |
| Shared UI kit, shells, styling, accessibility, page guides, sample preview, interface docs | Codex | Claude adds guides/nav entries for new pages; tell Codex in the log |
| CI workflows, containers (`infrastructure/**`), observability | Codex | If a change of mine needs infrastructure support (new env vars, secrets), I update it and log it |
| Tests under `tests/e2e/**` | Shared | Never weaken or delete a test to get green. Fix the cause or ask |
| Decision log, this document | Shared | Append, do not rewrite each other's entries |

## Engineering ground rules

1. Branch from the latest `claude/relaxed-lovelace-0179ut` (the default branch). One branch and one pull request per task, named `codex/<task-id>-<short-name>`. Rebase before opening the PR.
2. **Do not edit** `apps/desktop/src/core/**`, `packages/domain/src/sync.ts`, `apps/api/src/modules/device.ts` or `tests/sync/**`. Claude owns these. Determine the next unused migration ID from the current registry; never reuse an existing ID. If a task seems to need a change there, write what you need in the PR description instead.
3. Never edit a released migration. Use the next unused ID in `apps/api/src/migrations/index.ts`. New tenant tables need the same row-level-security block as the existing ones; new platform tables need a `GRANT` to `mansora_platform` only.
4. All database access goes through `db.platform()` or `db.tenant()`. Admin code must never read a business table outside the consent-checked report path.
5. Money is integer pesewas. No floating-point money.
6. Every task ships tests. `npm run typecheck`, `npm run build`, `npm test` and `npm audit` must pass. Do not skip, weaken or delete existing tests.
7. Regenerate `package-lock.json` only from a clean tree (`rm -rf node_modules package-lock.json && npm install`), otherwise Windows build binaries go missing from the lockfile and the Windows CI job breaks.
8. No secrets, sample passwords or real client data in the repository.
9. Do not claim anything is tested on hardware, or production-ready.
10. Update the relevant file under `docs/` in the same PR, and add a row to `docs/decisions/decision-log.md` for any policy you had to assume.
11. After every push, check CI and record the result in the *Handoff log*. Anything that changes required environment variables, secrets, the Electron bridge or the container stack must update `infrastructure/**` and `tests/hardware/electron-smoke.mjs` in the same change.
12. Branch from the latest default branch, rebase before opening a PR, and target the **default branch**, not another feature branch.

## Status board — active work (2026-11-12)

[Complete historical board and evidence](archive/codex-tasks-2026-11-12.md). Only open, reserved or acceptance-pending tasks belong here.

| Task | Owner | Current state / dependency | Branch / evidence |
| --- | --- | --- | --- |
| C16 Hubtel adapter | unclaimed | **Blocked**: Hubtel docs and sandbox credentials needed | – |
| C17 printable PDF invoices/receipts | unclaimed | Open | – |
| C27 Figma workflow redesign | Codex — active; Figma tool limit | Owner rejected C24 layout as cluttered/basic and workflows as difficult. 27 editable client screens exist in a new Figma file; full local review draft is prepared. Remaining native screens, connections and final QA require renewed Figma MCP access. No new application UI deployed | `codex/C27-workflow-design` |
| C53 staff sign-in details by email: optional local staff email, one-time 48-hour codes, `I have a sign-in code` on the sign-in screen (owner request 2026-11-13; D-37). Touches engine/auth, device API, Staff page and a narrow sign-in addition | Claude | **Merged** PR #62 | `claude/elegant-bohr-mjeotl` |
| C54 invite Mansora administrators by email: one-time 48-hour link, invitee chooses a 12+ character password; Administrators page; migration 7 `admin_invitations` (owner request 2026-11-13) | Claude | **Merged** PR #63. Adds `adminUrl` to the Railway `buildApp` call in `scripts/railway/server.ts` (one line, Codex area) | `claude/elegant-bohr-mjeotl` |
| C38 note (Claude, 2026-11-13) | Railway volume backups and schedules are refused for this workspace: "only available for Pro workspaces". Both volumes (Postgres data, `/data`) currently have no backups. Needs the owner's decision: upgrade Railway to Pro, or provide an S3-compatible bucket for off-site copies | – | – |
| C55 resend team-test sign-in details with every role: one summary email per tester (owner login, what each role can do), then the shop's manager and cashier logins as one-time C53 codes to the same tester address. Owner passphrases are not rotated (testers keep current access; email reset exists). Runs once at team-test startup per `STAGING_ROLE_LOGINS_ID` (default `2026-11-13-role-logins`, `off` disables), journaled in `/data/staging/role-logins.json` | Claude (taken over from Codex session 1 at owner's request 2026-11-13) | Done on branch, PR open; sends on the next Railway deploy | `claude/elegant-bohr-mjeotl` |
| C33 owner's daily closing summary email: owner-only opt-in in Settings, sends once a day after a chosen hour on a successful sync, no costs or profit, server sends immediately and stores a record without figures (`/v1/devices/daily-summary`) | Claude | **Merged** PR #65 | `claude/elegant-bohr-mjeotl` |
| C34 shop activity for Mansora: each sync reports counts only (sales today, staff active today, last sale time); admin Overview shows Active / No sales for 2+ days / 7+ days / Not set up. Migration 8 adds four `devices` columns. The sync `device` object gains an optional `activity` field: deploy the server before or with tills that send it | Claude | Done on branch, PR open | `claude/elegant-bohr-mjeotl` |
| C36 live third-shop acceptance | Codex Platform session | #51 merged; third-shop browser/API/container/restart tests pass and code is deployed through the live default. Actual live administrator-created third shop remains unclaimed; do not infer it from CI | PR #51; `docs/operations/browser-workspaces.md` |
| Platform UI refinement (owner request) | Codex Platform session | Implemented: restrained website palette, static glows, clearer copy and redundant-label removal. Merged in #59; 349 combined tests and all six feature checks passed; live release acceptance pending | `codex/platform-ui-refinement` |
| C37 client mode, proxy/account throttling and browser owner recovery | Codex Platform session | Implemented: explicit modes/bounds, isolated sign-in/resource budgets and recorded-owner email recovery through the existing device command. Code merged in #58; 349 tests and six feature checks passed. Live proxy and owner recovery acceptance pending | `codex/C37-client-gateway` |
| C38 off-site backups of database and data volume with keys, one rehearsed restore, uptime check, error alerts to a person (N1) | **Claude** (taken over from Codex session 1 at owner's request 2026-11-13) | Active: independent HTTPS/Resend monitor implemented and locally verified; live deployment/canary pending. Off-site backup, key custody and isolated restore remain unfinished. See operations/uptime-monitor.md | `codex/C38-recovery-monitoring` (reserved) |
| C44 decimal quantities and saved pack sizes: engine, schema, sync contract (X3). Publishes the command contract for C51 | Claude | Queued | – |
| C45 wholesale/retail price levels and supervised price override: engine (X4) | Claude | Queued | – |
| C46 VAT, NHIL and GETFund on sales: tax-inclusive prices, receipt lines, tax report (X5) | Claude | Queued | – |
| C47 customer credit limit with supervised override: engine (X1) | Claude | Queued | – |
| C48 offline tier: signed-installer pipeline and automatic updates for the Windows till (L1) | **Claude** (taken over from Codex session 1 at owner's request 2026-11-13) | Reserved after C36–C38 per latest rebalanced plan. Test-certificate plumbing first; real certificate and Windows acceptance remain explicit prerequisites | `codex/C48-signed-updates` (reserved) |
| C49 offline tier: silent receipt printing and cash-drawer signal in the Electron shell (X2) | **Claude** (taken over from Codex session 1 at owner's request 2026-11-13) | Reserved after C48. Preserve restricted IPC bridge; physical printer/drawer acceptance must be recorded separately | `codex/C49-printing-drawer` (reserved) |
| C51 interface for C44–C47: quantity entry, pack sizes, price levels, tax lines, credit limits. Each part starts after Claude's engine PR for it merges | **Claude** (taken over from Codex session 2 at owner's request 2026-11-13) | Reserved; waits for Claude command contracts | – |

## Current verification and recent integrations

Default branch: `claude/relaxed-lovelace-0179ut`. Actual platform: https://app.mansora-consulting.com. Coordination: issue #39. [Platform lane handoff](operations/platform-lane-handoff.md) and [roadmap](operations/product-audit-and-roadmap.md) contain scope/acceptance details.

- The combined C41/C50/C35 tree passes **334/334 tests in 56 files**, browser coverage enabled, no skips; typecheck/build pass. The merged source was compared against the reviewed tree. Each approved PR had green exact-head workflows before merge; final merged CI/deployment is monitored separately.
- Owner explicitly approved only the unfinished-session merges #53, #55 and #56 after checks. #56 merged as `1ef3474`; #53 as `27c20cb` including the reproduced/fixed F9-behind-dialog defect; #55 as `a1ca314` with both feature guides preserved. Original authorship retained. No corporate or unrelated PR was merged.
- C40 support/recovery guidance (#52) and C39 consented Leads (#54) were already merged by the other session. Preserve them. C30 code findings F01/F02 are fixed in #47; F03/F04 wiring is in #46. Actual off-site protection/restore remains C38.
- C32/C36 code is deployed through the default. C43 completed both private test businesses; deployment `adc46d21` logged **0 prepared, 2 preserved, 0 awaiting review** after restart. New dynamic shops are excluded from fictional data. Both Resend invitations were delivered; preserve operation ID/journal and existing credentials.
- This is not a production-readiness, real-provider settlement, human training or physical-hardware acceptance claim. Completed implementation history and old limitations remain in the archive.

## Open dependencies and owner decisions

- C16: Hubtel recurring/direct-debit documentation, merchant onboarding, sandbox credentials and outbound-IP requirements remain unavailable. Paystack account/test configuration is also separate; never test with real charges.
- Region/data-protection/legal approval, invoice/tax issuer details and commercial terms remain owner/legal decisions. Approved non-payment policy is implemented; do not treat that resolved decision as an open blocker.
- C38 must verify independent backups and protected keys with an isolated restore and observed alert. Local volume restart is not recovery evidence.
- C48/C49 need a real signing certificate and Windows/printer/scanner/drawer acceptance. Test certificates/mocks do not establish physical acceptance.
- C51 waits for Claude's C44–C47 command contracts. Preserve existing engine ownership and do not invent APIs or financial behavior.

## Corporate website coordination (2026-11-11)

| Task | Owner | Status | Branch / PR |
| --- | --- | --- | --- |
| Corporate Sales & Stock product page and separate waiting list | Codex corporate website session | Implemented on separate website branch; local checks pass. Awaiting exact-head CI, hosting access, storage configuration and live persistence before coordinated release. Not merged or deployed to production | [website PR #1](https://github.com/priscillafm03-afk/mansora-website/pull/1), `codex/sales-stock-waitlist` |

This external task uses **priscillafm03-afk/mansora-website** (static Vercel site),
not the older public Flask repository. Live homepage/main.js match website main
`7d05ff8` byte for byte. No competing website branches or open PRs were found at
claim time. The website waiting list is separate from newsletter and C39 app demo
intake; it never provisions testers. App invitations, Resend diagnostics, DNS and
infrastructure stay with their existing owners. Coordination: issue #39.

## Handoff log (current; append new facts here)

### 2026-11-13 — Claude (owner asked Claude to take over the Codex sessions' work)
- **Taken over:** C38 (remaining: off-site backup, key custody, isolated restore; the C38 part 1 monitor is merged), C48, C49, C51 and C55. Codex sessions: please do not start new work on these rows; record anything in flight in a handoff entry so it can be picked up.
- **Merged today:** C53 staff sign-in codes (PR #62) and C54 administrator invitations (PR #63), both with all workflows green.
- **C55:** team-test role logins run once at startup. The owner declined a Railway API token for this session, so nothing on Railway is changed from here; the send happens on the next automatic deploy. Inviting the owner's chosen administrator requires adding her address to `RESEND_ALLOWED_RECIPIENTS` in Railway first (team-test allowlist); the address stays out of the repository.

### 2026-11-12 — unfinished client/sales completion and board archive

Owner requested completion of another unfinished session, then explicitly approved merges of #53/#55/#56 after checks. All three were reviewed and merged with original source/authorship preserved. Review reproduced an extra payment dialog from F9 inside parked-basket review; a new browser test failed before the fix and passed afterward. The final combined suite is 334/334, no skips. The guide overlap retains both parked-basket and WhatsApp guidance. No external WhatsApp message, real charge/refund or client financial record was created by this completion review.

C42 stores the entire pre-archive board verbatim with its source commit and SHA-256; every still-active/reserved/unclaimed task listed above is retained. Corporate ownership is unchanged. Historical claims are snapshots, not instructions to duplicate completed work.

C37 has been restored and rebased onto the approved combined default, including C42. Gateway isolation and real owner recovery integration/browser tests pass locally; full regression and CI review are in progress. Live proxy trust and owner recovery acceptance remain explicit. Continue C37 → C38 → C48/C49. Do not reset test credentials, bypass hardening or overwrite active sessions' source.

### 2026-11-12 — Platform continuation

Approved unfinished-session PRs #53/#56/#55 are merged; combined 334 tests passed, and Railway deployment 95d62c15 reached SUCCESS. C42 archive #57 passed all six checks and merged as c747a6b. C37 continues in its claimed lane; see [gateway/recovery operations](operations/browser-gateway.md). The owner additionally requested restrained platform UI refinement using the existing website palette; that work uses a separate branch and preserves current structure.

### 2026-11-12 — C38 independent monitoring

C37 #58 and the owner-requested UI refinement #59 are merged. The exact combined UI head passed all six workflows and all 349 local tests. C38 now implements a separate non-root monitor: HTTPS readiness, bounded Resend outage/recovery messages and an expiring, clearly labelled delivery canary. Five focused tests plus the isolated Docker HTTPS image smoke pass. See [monitor operations](operations/uptime-monitor.md). Deployment and real delivery remain pending; independent backup/key-custody/restore are not represented as complete.
