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
| C17 printable PDF invoices/receipts | Codex platform session | Implemented on branch: A4 pagination, repeated headings, wrapped long content, issuer/TIN consistency and missing-document 404s. Real Chromium/Poppler tests pass locally; full regression/CI pending. Existing print/PDF facilities retained | `codex/C17-printable-documents` |
| C27 Figma workflow redesign | Codex — active; Figma tool limit | Owner rejected C24 layout as cluttered/basic and workflows as difficult. 27 editable client screens exist in a new Figma file; full local review draft is prepared. Remaining native screens, connections and final QA require renewed Figma MCP access. No new application UI deployed | `codex/C27-workflow-design` |
| C53 staff sign-in details by email: optional local staff email, one-time 48-hour codes, `I have a sign-in code` on the sign-in screen (owner request 2026-11-13; D-37). Touches engine/auth, device API, Staff page and a narrow sign-in addition | Claude | **Merged** PR #62 | `claude/elegant-bohr-mjeotl` |
| C54 invite Mansora administrators by email: one-time 48-hour link, invitee chooses a 12+ character password; Administrators page; migration 7 `admin_invitations` (owner request 2026-11-13) | Claude | **Merged** PR #63. Adds `adminUrl` to the Railway `buildApp` call in `scripts/railway/server.ts` (one line, Codex area) | `claude/elegant-bohr-mjeotl` |
| C38 note (Claude, 2026-11-13) | Railway volume backups and schedules are refused for this workspace: "only available for Pro workspaces". Both volumes (Postgres data, `/data`) currently have no backups. Needs the owner's decision: upgrade Railway to Pro, or provide an S3-compatible bucket for off-site copies | – | – |
| C55 resend team-test sign-in details with every role: one summary email per tester (owner login, what each role can do), then the shop's manager and cashier logins as one-time C53 codes to the same tester address. Owner passphrases are not rotated (testers keep current access; email reset exists). Runs once at team-test startup per `STAGING_ROLE_LOGINS_ID` (default `2026-11-13-role-logins`, `off` disables), journaled in `/data/staging/role-logins.json` | Claude (taken over from Codex session 1 at owner's request 2026-11-13) | Done on branch, PR open; sends on the next Railway deploy | `claude/elegant-bohr-mjeotl` |
| C56 Mobile Money confirmed by a payment provider (request to the customer's phone), typed reference kept as offline fallback. Plan: `docs/operations/next-phase-plan.md` | Claude | Queued, Phase 2. Needs the owner's choice of provider and a merchant account | – |
| C57 barcode scanning: phone camera scanning on New sale, Products and Stock count; scan unknown barcode to create; printable barcode labels | Claude | Queued, Phase 1 | – |
| C58 sample shop Excel: realistic Ghanaian provisions workbook (~150 products), template full example, loaded into Mansora TSA | Claude | Queued, Phase 1 | – |
| C59 shifts and logins made firm: generated 'Who can do what' page, one shift per person, overnight shifts flagged, open shifts on the owner dashboard | Claude | **Built** on `claude/elegant-bohr-mjeotl`: `shift.openList`, overnight flag, dashboard card, Staff page matrix, generated `docs/user-guide/who-can-do-what.md` with a drift test | – |
| C60 purchases, restocking, expenses and suppliers: fuller supplier records and history, reorder list by supplier into a purchase, owner guide sections | Claude | Queued, Phase 1 | – |
| C61 consistent colours: one token set across shop app and admin, automatic WCAG AA contrast check, status shown by word or icon as well as colour | Claude | Queued, Phase 1 | – |
| C62 rename the team-test shops to Mansora TSA and Mansora TSB (owner request 2026-11-14); live shops renamed on start, web addresses unchanged | Claude | **Done** on `claude/elegant-bohr-mjeotl` | – |
| C63 expiry dates and batches (earliest-expiry first, warnings, expired stock blocked) and supplier debts | Claude | Queued, Phase 3 | – |
| C64 offline hardware test day: Windows till with real thermal printer, cash drawer and scanner, power and internet cuts | Claude + owner | Offline phase, date set by the owner | – |
| C65 more than one till per shop, then branches: design first | Claude | Offline phase, when a client needs it | – |
| C61 consistent colours across displays: one colour token set for `packages/ui`, desktop renderer and admin-web; remove one-off hex/Tailwind colours; automatic WCAG AA contrast test over every token pair used for text; every status (paid, owed, low stock, restricted, overnight shift) also has a word or icon; screenshots at three display profiles (bright laptop, low-cost Android at 360 px, dim/daylight) for the owner. Brief: `docs/operations/codex-handoff-2026-11-14.md` | **Codex session 2 (Client and sales surface)** | Assigned 2026-11-14, not started | `codex/C61-colours` |
| C57b printable barcode labels: A4 sheet of labels (e.g. 3×8) for products without a barcode, from Products (select products, print). Use the product's barcode, or offer to assign an in-store EAN-13 (prefix 200, check digit as in `apps/desktop/src/core/sample-shop.ts`) through the existing `product.save`. Renderer only; no engine changes | **Codex session 2** | Assigned 2026-11-14, not started | `codex/C57b-labels` |
| C60c reorder list into a purchase: on **Needs reordering**, choose a supplier's rows and open **Receive stock** prefilled with those products and suggested quantities (editable). Uses the existing `stock.reorderList` and `purchase.receive`; no engine changes. Add an e2e test | **Codex session 2** | Assigned 2026-11-14, not started | `codex/C60c-reorder-purchase` |
| C66 in-app help: a Help page listing the user guides (cashier, owner, who can do what, scanners and printers, moving to Mansora, stock purchases expenses), rendered from `docs/user-guide/*.md` at build time, linked from the shell's help menu and from empty states (Import, Suppliers, Shifts). Renderer and build only | **Codex session 1 (Platform)** | Assigned 2026-11-14, not started | `codex/C66-help` |
| C67 browser scanning acceptance: run the C57 camera scanner on a real Android phone (Chrome) and an iPhone (Safari) against the live Railway workspace over HTTPS, plus a USB scanner on a Windows laptop; record device models, what worked and any fixes in `docs/operations/scanning-acceptance.md`. Report only what was actually tried | **Codex session 1** | Assigned 2026-11-14, needs a person with the devices | – |
| C60b customer opening balances: import or enter what a customer already owed before moving to Mansora, as a credit balance without a fake sale. Engine, sync and screens | Claude | Queued | – |
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
| Corporate Sales & Stock product page and separate waiting list | Codex corporate website session | Implemented on separate website branch; 13 backend + 11 browser checks and audit pass locally and in exact-head CI. Awaiting hosting access, storage configuration and live persistence before coordinated release. Website not merged or deployed to production | [website PR #1](https://github.com/priscillafm03-afk/mansora-website/pull/1), `codex/sales-stock-waitlist` |

This external task uses **priscillafm03-afk/mansora-website** (static Vercel site),
not the older public Flask repository. Live homepage/main.js match website main
`7d05ff8` byte for byte. No competing website branches or open PRs were found at
claim time. The website waiting list is separate from newsletter and C39 app demo
intake; it never provisions testers. App invitations, Resend diagnostics, DNS and
infrastructure stay with their existing owners. Coordination: issue #39.

## Handoff log (current; append new facts here)

### 2026-11-14 — Claude
- **New tasks for Codex (owner asked):** C61 colours, C57b barcode labels and C60c reorder-to-purchase for **Codex session 2**; C66 in-app help and C67 scanning acceptance for **Codex session 1**. Brief: `docs/operations/codex-handoff-2026-11-14.md`. All are renderer, build or docs work; none needs engine changes. Ask in the PR if you need a command.
- **Built by Claude on `claude/elegant-bohr-mjeotl` (PR #67):** C57 camera scanning (New sale, Products, Stock count), C58 sample shop and template guide sheet, QuickBooks/Xero column recognition, C59 shifts and logins, C60 supplier details/history and Needs reordering, C62 test shops renamed Mansora TSA and TSB, the Ghana legal pack, review fixes. New guides: `docs/user-guide/scanners-and-printers.md`, `moving-to-mansora.md`, `stock-purchases-expenses.md`, `who-can-do-what.md` (generated; run `npx tsx scripts/docs/roles.ts` after changing permissions).
- **Do not touch:** sync contract (`text+` columns on suppliers), laptop migration 3, cloud migration 9.

### 2026-11-14 — Codex (respect current ownership; C17 claim)
- Read the 13 November takeover: C38/C48/C49/C51/C55 belong to Claude. Stopped new work in those lanes after discovering the updated handoff. Preserving the in-flight C38 prototype in a draft handoff branch for Claude, without merging, enabling a backup schedule, provisioning storage or changing live records/credentials.
- C38 prototype rebased onto current default 71ea602: eight focused tests in four files and typecheck pass. Synthetic full-schema/two-shop restoration verifies encrypted key/store capture, financial rows, owner authentication and isolated sync. The upload manager is an unintegrated prototype without its own delivery/restart tests; raw privileged recovery-query and temporary constraint-deferral boundaries require owner review before runtime integration. No off-site backup or production PostgreSQL 16 restore is claimed.
- Claim previously unowned C17 on `codex/C17-printable-documents`. Coordinating the narrow `apps/api/src/billing/documents.ts` presentation surface here before edits; ledger/provider logic, routes, permission checks and protected engine files remain with Claude. Existing client/Electron PDF and browser printing avoid a heavy new server dependency. Verify issuer details, document numbers, amounts, escaping and multi-page output with real Chromium PDFs.
- The actual platform UI/gateway changes and separate US East monitor from this session were deployed successfully. Monitoring delivery remains blocked by the designated inbox's provider bounce/suppression; a corrected address is still needed privately. No suppression was removed.


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

### 2026-11-11 — Codex corporate website session (bespoke page; exact CI green)
- Owner asked for a shorter page name: website PR #1 now uses **Sales & Inventory**, headline **Manage sales. Track stock.** Product/app identity and consent remain Mansora Sales & Stock; `/sales-stock` stays canonical.
- Added a keyboard-accessible dashboard/checkout/stock tour from committed synthetic sample screenshots, a clearly labelled public sample-interface link, section shortcuts, pilot steps and direct form focus on phones. No live client records used or app code changed.
- Website exact head **93e6dce**: [CI run 43102720316](https://github.com/priscillafm03-afk/mansora-website/actions/runs/43102720316) **completed successfully**, 13 backend checks + 11 browser checks + npm audit (0 vulnerabilities). Tests include actual Redis AOF restart, duplicate races/lost acknowledgements, storage/email failure, mobile layout and axe. CI initially caught lazy-image decoding after rapid tab switches; fixed the loading behaviour, kept assertions/timeouts intact and verified the rerun.
- Vercel exact-head automatic preview succeeded: `https://mansora-website-git-codex-sales-stock-waitlist-mansora.vercel.app/sales-stock` (Vercel Authentication required). Public sample-interface route also returns 200. Dedicated production/preview Redis configuration and **live waiting-list persistence remain unverified** because the connected Vercel API cannot access the confirmed website project. No protection bypass, app infrastructure/DNS change, invitation or app Resend diagnostics change.
- Observed initial board PR #49 already merged by another session; this final evidence uses a fresh docs-only branch/PR. This session has merged no PR and deployed no production site. Website PR #1 remains gated on storage/live verification and coordinated release. Further details stay in website `docs/sales-stock-waitlist.md` and issue #39.

### 2026-11-12 — C38 independent monitoring

C37 #58 and the owner-requested UI refinement #59 are merged. The exact combined UI head passed all six workflows and all 349 local tests. C38 now implements a separate non-root monitor: HTTPS readiness, bounded Resend outage/recovery messages and an expiring, clearly labelled delivery canary. Five focused tests plus the isolated Docker HTTPS image smoke pass. See [monitor operations](operations/uptime-monitor.md). Deployment and real delivery remain pending; independent backup/key-custody/restore are not represented as complete.

### 2026-11-14 — C17 implementation evidence

Reproduced Letter PDF defaults and missing-document 500s with new real-API/Chromium tests. A4 invoice/receipt output now passes the focused checks, including a five-page, 100-line invoice, final line/totals, issuer details, sandbox context, escaping and unchanged source figures. New dedicated PDF-text CI job uses Poppler. No provider/ledger/route/permission/bridge change or production PDF dependency. Full verification and merge remain pending. C38 in-flight work is handed to Claude in draft #68; it is not being merged or enabled by this session.
