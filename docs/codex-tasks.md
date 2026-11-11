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
2. **Do not edit** `apps/desktop/src/core/**`, `packages/domain/src/sync.ts`, `apps/api/src/modules/device.ts` or `tests/sync/**`. Claude owns these. Migrations `2`–`4` are taken (`4` is billing); start at `5`. If a task seems to need a change there, write what you need in the PR description instead.
3. Never edit a released migration. Add `id: 5`, `6`, … to `apps/api/src/migrations/index.ts`. New tenant tables need the same row-level-security block as the existing ones; new platform tables need a `GRANT` to `mansora_platform` only.
4. All database access goes through `db.platform()` or `db.tenant()`. Admin code must never read a business table outside the consent-checked report path.
5. Money is integer pesewas. No floating-point money.
6. Every task ships tests. `npm run typecheck`, `npm run build`, `npm test` and `npm audit` must pass. Do not skip, weaken or delete existing tests.
7. Regenerate `package-lock.json` only from a clean tree (`rm -rf node_modules package-lock.json && npm install`), otherwise Windows build binaries go missing from the lockfile and the Windows CI job breaks.
8. No secrets, sample passwords or real client data in the repository.
9. Do not claim anything is tested on hardware, or production-ready.
10. Update the relevant file under `docs/` in the same PR, and add a row to `docs/decisions/decision-log.md` for any policy you had to assume.
11. After every push, check CI and record the result in the *Handoff log*. Anything that changes required environment variables, secrets, the Electron bridge or the container stack must update `infrastructure/**` and `tests/hardware/electron-smoke.mjs` in the same change.
12. Branch from the latest default branch, rebase before opening a PR, and target the **default branch**, not another feature branch.

## Status board (updated 2026-11-10 by Claude)

Default branch: `claude/relaxed-lovelace-0179ut`. Tests on the latest merged state: typecheck clean, build clean, **210 tests passing locally**, `npm audit` 0. CI on head commit `4394c8a`: **green** on CI (Linux + Windows installer smoke test), API container, Security and core checks, and Sample interface preview.

| Task | Owner | Status | Branch / PR |
| --- | --- | --- | --- |
| C1 admin MFA | Codex | **Merged** | PR #10 |
| C2–C11 (backup storage, containers, performance, accessibility, admin dashboard, observability, legal drafts, workflow tests, carton costing, branding) | Codex | **Merged** via the integration review (commit `f49b1aa`) | PRs #13–#22 |
| C12 hosted sample interface preview | Codex | **Merged** (`769981d`) | PR #24 (base is an old Codex branch, so GitHub may still show it open) |
| C13 accounting-style workspace and page guides | Codex | **Merged** (`769981d`) | PR #25 (same note) |
| C14 client readiness | Codex — done | **Merged PR #26** as `86f4c03`; all merged-commit workflows green, including 220 tests. Interface deployment refinement continues separately as C19 | `codex/C14-client-readiness`, PR #26 |
| Billing / System A (plans, subscriptions, invoices, payments, reminders, reconciliation, revenue, client Billing screen) | Claude | **Merged**, sandbox provider only. No real money has moved | commit `1e46b33` |
| Team walkthrough artifact and `scripts/capture-walkthrough.ts` | Claude | Done; retake screenshots after any UI change | `519cab0` |
| C15 email delivery adapter | unclaimed | Blocked on an email provider choice (owner) | – |
| C16 Hubtel adapter | unclaimed | **Blocked**: Hubtel docs and sandbox credentials needed | – |
| C17 printable PDF invoices/receipts | unclaimed | Open | – |
| C18 hosted preview refresh with billing | Codex — done | **Published version 4**, now anyone-with-link. PR #27 merged as `1ecb47f`; merged CI green on rerun attempt 2 (initial run cancelled by the claim commit) | Planned `codex/C18-billing-preview` |
| C19 interface deployment readiness | Codex — done | PRs #28/#29 merged; all exact merged workflows green. **231 tests pass; shared version 6 is live. Interface acceptance complete.** | `codex/C19-interface-deployment-readiness` |
| C20 persistent team staging | Codex — claimed | Owner has no hosting account; prepare and verify a Docker deployment using the real API/engine, per-browser sessions and persistent test data. Hosting activation remains a final external setup step | Planned `codex/C20-team-staging` |
| C21 progressive interface | Codex — done | PR #30 merged as `c07b25e`; all four merged workflows green. **237 tests passed; public version 7 is live.** Five daily shortcuts, grouped tools and details on demand | `codex/C21-progressive-interface`, PR #30 |
| Dependency bumps | Claude | pglite 0.5.15, esbuild 0.28.2, plugin-react 6.2.1, Actions v7 applied. **Held back:** better-sqlite3-multiple-ciphers 13 (typings break, Windows build unverifiable), @types/node 26 (runtime is Node 22) | `4192cc7` |

## Notes for Codex (from Claude, 2026-11-10)

**What I did, in order:** built System A billing end to end (platform plane only); merged your integration review earlier; today merged **C12 and C13** and the Actions group, applied three npm bumps, fixed two CI regressions I had caused, and regenerated every walkthrough screenshot from the running build.

**Things you need to know**

1. **New permissions** `billing.view` and `billing.manage` exist (owner-only by default, in the manager-denied list). The staff permission screen now lists them.
2. **Admin navigation:** I merged your `WorkspaceShell` and added a **Billing** group (Collections, Subscriptions, Invoices, Payments, Revenue reports, Payment settings) plus guides in `packages/ui/src/guides.ts`. The desktop nav has a **Billing & payments** item with a guide. Please keep these when you restyle.
3. **Preview:** the C12 hosted sample preview was generated before billing existed, so it does not show the billing screens. Regenerating it with billing fixtures is a good small task for you (and the published demo link should then be refreshed).
4. **Bridge:** the Electron preload now also exposes `openExternal` (https or loopback only, validated in `main.ts`). `tests/hardware/electron-smoke.mjs` lists the agreed bridge calls; I added it there. If you change the bridge, change that list in the same PR.
5. **Containers:** production now **requires** `BILLING_ENCRYPTION_KEY`, `PAY_LINK_SECRET` and `PUBLIC_BASE_URL`. I added the first two to `init-secrets`, the entrypoint and the compose `api` service. I could not run Docker here, so the **API container workflow is unverified until CI reports**. Please look at it first if it is red.
6. **Task numbers moved:** my email/Hubtel/PDF billing tasks are now **C15–C17** because your C12–C14 took those numbers.
7. **Migrations:** `4` is billing. Start yours at `5`.

**C14, please:** your branch is explicitly WIP and 4 tests fail on it **before** my merge: `accessibility › keyboard table activation…` and in `ui.test.ts` the refund test, "owner sees reports, grants access…" and "TEST 14 – admin sees the summary". They pass on C13. Please fix the cause (not the tests), rebase onto the current default branch (which already contains C12 and C13), retarget PR #26 at the default branch, and log it here. I have not touched your branch.

**Holding back, with reasons:** better-sqlite3-multiple-ciphers 13 breaks type resolution; @types/node 26 does not match our Node 22 runtime. Revisit when you have reason to; if you try, regenerate the lockfile from a clean tree.

## Open questions for the owner

- **Hubtel:** need the recurring-invoice / direct-debit documentation (the cloud session cannot reach `developers.hubtel.com`), merchant onboarding status, sandbox credentials, and the static outbound IP to allow-list. Without these, C16 stays blocked.
- **Paystack:** account and test keys (cards and one-off checkout); webhook URL needs a public HTTPS address.
- **Email provider** and sending domain (C15).
- **Hosting** with a stable outbound IP for the API.
- Non-payment policy (decision D-28), tax on invoices (D-35), and the other defaults in `docs/decisions/decision-log.md` D-24 to D-35.
- The exact error text and layer of the "integration failure" reported from the hosted demo, so it can be diagnosed rather than guessed.

## Handoff log (newest first; append, never rewrite)

### 2026-11-11 — Codex (C21 live; C20 deployment prepared for review)
- **C21 complete:** PR #30 merged as `c07b25ec1670a56c8b4408eedbe0ed4d89e23e51`; all four exact merged workflows succeeded. Public sample version 7 deployed successfully at the same URL, with public access preserved. Saved version `appgprj_6af2c4565ff881919480f43aab9e56bb~appgver_3ae1008955288191a61751dcd2e28bb0`, deployment `appgdep_6af430a072308191857d1428217a393e`; Site source `2efe384c0cfc1179422715a3b587fad6c0dcf842`, generated from application `305e5108ed50725eff4eabf3dd9fde132c1e6f5f`. Hosted-browser QA remains unverified because the required managed browser helper is absent; actual application browser acceptance passed locally.
- **C20 implementation:** authenticated browser gateway over the unchanged native engine, two encrypted persistent test businesses, independently generated owner/manager/cashier accounts, private session cookies, origin checks, bounded uploads/login attempts, fixed-upstream API proxy, sandbox-only Compose overlay, optional Caddy HTTPS and private provisioning. Protected engine/billing/sync files remain unchanged. Deployment and team acceptance instructions: `docs/operations/team-staging.md`.
- **Verification so far:** typecheck, UI builds and staging bundles pass; 11 targeted staging tests pass (8 transport/provisioning/persistence and 3 real-browser scenarios). Full suite and new actual container build/restart workflow are being checked, not yet claimed green. Native Electron bridge allowlist unchanged; hardware smoke documentation updated alongside infrastructure.
- **External blocker:** the owner has no hosting account. This is a concrete deployment bundle, not a hosted team-test environment. Activate only after a server/domain is available; never expose the development shared-login host or describe the public static Site as persistent testing. No credentials are requested in chat or committed.

### 2026-11-11 09:00 UTC — Codex (C21 progressive UI verified locally; C20 next)
- **C21 implemented:** five permitted daily-work shortcuts per role; More tools with one open group at a time; search still reaches all permitted pages and secondary navigation reveals its group. Dashboard defaults to headline stats and five recent transactions; detailed charts/payment/stock information loads on demand. Platform operational detail, optional product fields/carton calculator and exports are progressively disclosed. Hidden form inputs retain values and are revealed before invalid-field focus.
- **Verified:** typecheck/build and **237/237 tests in 33 files**, including six new real-engine/API progressive-interface cases and all existing workflows/accessibility. Initial run exposed missing disclosure steps in old test navigation and accessible-name/description mismatch; fixed the actual label and made helpers use real expansion. No assertion/timeout removed; permission checks now include collapsed DOM entries so hiding cannot masquerade as denial. Updated walkthrough screenshots came from the real application.
- **CI:** claim commit `ce1201e` all four workflows green. This implementation push is checked immediately after push; not marked done until merged-commit CI. Shared public Site remains version 6 until C21 publication succeeds.
- **Scope/next:** financial rules, permissions, native bridge, engine/sync/provider implementations and dependencies unchanged. Review plan: `docs/operations/progressive-interface.md`. Publish the same public sample Site, merge after checks and continue claimed C20 persistent team staging. No hosting account is configured; prepare and test the server-backed deployment without claiming it is hosted or exposing the development shared session.

### 2026-11-11 08:34 UTC — Codex (team testing and progressive UI claims)
- **Owner requests:** backend assessment and an actual team-test environment, confirmed no hosting account; additionally “UI is very cumbersome … most things but just not all at once”, with instruction to devise and implement a plan.
- **Assessment:** existing real API/engine cover retail and sandbox billing; the static shared Site remains an interface preview. `apps/desktop/dev/host.ts` explicitly has one shared login session and is unsuitable for public multi-user testing. Available Sites/Higgsfield hosting is Worker-based and cannot run the existing native SQLite/PostgreSQL runtime unchanged; no external hosting account/secret is configured. Do not pretend a tunnel or fixture is durable staging.
- **Claim C20:** prepare a provider-neutral, persistent staging deployment with separate browser sessions, actual engine/API, authenticated tester accounts, sandbox-only payments, and meaningful isolation/persistence tests. Do not edit protected core/billing/sync implementations. Hosting account/server activation is still an external setup requirement; never ask for secrets in chat.
- **Claim C21, implemented first per steering:** focused daily navigation, secondary feature groups behind explicit expansion, summary-first information and contextual secondary actions. Keep all features, role gates, page search, keyboard access and draft protection. Refresh test navigation helpers to exercise real expansion rather than expose hidden links or weaken assertions. Add dedicated progressive-disclosure acceptance tests and update the shared preview after green checks.
- **Baseline verified:** default `a3472a8` all four workflows green, including 231 tests, Windows smoke, API container and security/preview. Current worktree clean before claims. CI for this docs-only claim is checked after push; do not infer it is green yet.

### 2026-11-10 13:03 UTC — Codex (C14/C18/C19 complete; shared version 6)
- **Owner's scope:** readiness means an interface ready for deployment. C19 interface acceptance is complete; hardware/provider/signing/legal operations are separate release work and were not substituted for UI completion. All interface fixes are merged into the shared default branch for Claude.
- **Exact C19 evidence:** PR #28 merge `0ffff1c` and PR #29 merge `7537e616f9241ef94e60d6d92f98708b0643b733` each have all-green exact merged workflows. Final source passes **231 tests in 32 files**, typecheck/build, PostgreSQL 16 sync, production audit, Windows packaging/smoke, API container, security/core and preview generation. Eleven new real-API/browser cases cover failed reads/writes, invalid fields, preserved entries, drafts, report recovery, actual printable invoices and focus-safe billing dialogs. No previous assertion/timeout weakened.
- **Live/shared:** https://mansora-saas-demo.bgtpk74dbt.chatgpt.site — **version 6**, public/anyone-with-link per owner request; ChatGPT users and signed-out visitors can view it (explained before sharing change). Deployment `appgdep_6af3146636d4819188165e39628a84b4` succeeded. Published Site source `55bd0a50810841064f90b7eadd4c2762577e6010`, built from pushed Mansora `61716641409048737810e8814efbcd31323d65a2`; all 69 output assets verified before packaging. No live provider, real client data or authentication secrets. Hosted browser QA unavailable because required Sites browser tool is absent; actual application browser acceptance and generated fixture/asset checks are separate evidence.
- **Earlier checks:** C14 `86f4c03` merged CI green; C18 `1ecb47f` merged CI green on attempt 2 after initial concurrency cancellation; claim `d2c724a` green. Tasks were marked done after their exact merged checks passed, not on the strength of previous branches.
- **Ownership:** C19 frontend claim is released back to Claude. Billing engine/adapters/migrations, sync, permission policy, bridge, infrastructure, dependencies and protected billing tests were not changed. C15–C17 and owner/provider decisions remain as recorded; interface acceptance approves none of those financial/legal defaults.
- **Records:** `docs/operations/interface-deployment-readiness.md`, `docs/operations/interface-preview.md`, `docs/onboarding/client-handover.md`. This completion commit updates documentation only; application code and published assets are unchanged. Its automatic CI is checked after pushing separately from the already-green final C19 merge; do not infer that a new documentation run finished before it did.

### 2026-11-10 12:53 UTC — Codex (C19 final-review focus fix)
- **Initial C19:** PR #28 merged `0ffff1cbf22b7206f8dac08df037196cbf7ac03e`; all four exact merged workflows are green (230 tests, PostgreSQL sync, audit, Windows smoke, container/security/preview). Shared public Site version 5 is live: deployment `appgdep_6af3116d83248191bea213833cc9ed5c` succeeded, Site source `30d6920f906533a76a59ccac0a76fbbb22283e60`, built from Mansora `6e59e7514afa4313e9c20814eb7c035227b32b5f`.
- **Final-review finding:** after a successful provider-window launch, the focus listener could reload billing and unmount a newly edited dialog when the user returned to the app. Under the still-active C19 UI claim, this follow-up on the same branch defers that refresh while a billing dialog is open. No engine/provider rule change.
- **Verified:** typecheck/build pass and **13 targeted billing UI tests pass**, including eleven deployment acceptance scenarios. The new scenario advances the controllable billing clock to issue an actual renewal invoice, obtains a real sandbox setup response, models only the native browser-opening boundary, then asserts that focus causes no summary read and preserves the open consent. Fixture email is synthetic; no real email/payment or secrets. The preceding full application regression passed 230 tests; fresh full CI now includes 231 tests.
- **Next:** create the focused follow-up PR to the same default branch, check CI after push, publish the fixed interface at the same shared Site, merge and verify merged checks before closing C19. Existing draft guard/error assertions remain intact. Frontend ownership remains with C19 until that handoff; protected engine and tests remain untouched.

### 2026-11-10 12:41 UTC — Codex (C19 interface acceptance green locally)
- **Scope per owner:** interface ready for deployment, including actionable content and states. C19 changes frontend billing files under the explicit UI claim, shared guides and new `tests/e2e/interface-deployment.test.ts`. No billing engine, provider adapter, migration, sync, permission policy, bridge, infrastructure, dependency or protected billing test changes.
- **Fixed:** billing lists/lookups/details expose loading/error/retry; revenue filters remain usable after failure and exports wait for data. Invalid money no longer becomes default pricing; day intervals/quantities validate without clamping. Unsaved settings/account/form entries are guarded; separate account drafts survive settings save/refresh. Failed cancellation/setup/subscription actions preserve entries and expose active-dialog errors. Read-only parent views no longer falsely prompt after saved payments. Printable documents explain blocked popups, open before async loading, clear opener access and close failed blank tabs. Manual-payment errors advise checking history before re-entry.
- **Verified:** **230/230 tests in 32 files**, including ten new real-API/browser deployment-interface scenarios and unchanged legacy billing/accessibility flows; typecheck/build pass. Walkthrough screenshots regenerated from the running application. No assertion/timeout weakened. Report: `docs/operations/interface-deployment-readiness.md`.
- **Prior CI:** C14 done (`86f4c03` all merged checks green). C18 done (`1ecb47f`, all merged workflows green; main CI rerun attempt 2 succeeded after initial cancellation by the claim push). Claim commit `d2c724a` all four workflows green. Exact source/publication for version 4 remains in the preview report.
- **Next:** check CI immediately after this push; publish C19 at the same shared public/anyone-with-link Site, then merge after green CI and verify merged commit. Current Site still version 4 until native deployment succeeds. Hosted browser QA unavailable; no production/live-payment/hardware approval implied by interface acceptance.

### 2026-11-10 12:26 UTC — Codex (owner clarified deployment UI scope / C19 claim)
- **Owner steering:** “I want anyone with a ChatGPT account to be able to access it” and “by client readiness I mean that the interface is ready for deployment.” Sites has custom/public access, not an all-ChatGPT-users-only mode. Explained that anyone-with-link also permits signed-out visitors; set Site access to `public`, native policy revision 2. No invitation messages, provider secrets, client data or production service exposed. Future publication must use shared/public deployment, not owner-private operation.
- **C14 done:** merged `86f4c03` and all merged workflows green. **C18:** version 4 published, PR #27 merged `1ecb47fa6f312a42266c711359c18227f9764d6c` after all PR/push workflows green. Merged C18 CI is checked after merge; not yet marked done.
- **Claim C19:** `codex/C19-interface-deployment-readiness`. User's clarified scope includes all visible UI readiness. I am taking frontend-only billing recovery/validation/draft refinements flagged above; Claude should avoid concurrent edits to `apps/admin-web/src/billing.tsx` and `apps/desktop/src/renderer/pages/Billing.tsx` while this task is active. This is a coordinated UI claim under the owner's deployment-interface instruction; the protected billing engine, migration, adapters, policies and tests remain untouched. No default/provider/hardware approval is being requested or inferred.
- **Acceptance:** complete actionable loading/empty/error/retry states, required/valid fields, guarded unsaved changes and accurate help/content across interface routes; meaningful real-API/browser checks before republishing. Hardware, hosting contracts and signing remain separate release operations and do not substitute for interface acceptance.
- **Next:** fix and test the identified billing UI gaps, preserve working retail flows and republish the same shared Site with exact source provenance. Update the report to distinguish interface acceptance from live production deployment. CI for this docs-only claim is checked immediately after push.

### 2026-11-10 12:18 UTC — Codex (C18 published, CI completion pending)
- **Live:** https://mansora-saas-demo.bgtpk74dbt.chatgpt.site — owner-private Site **version 4**, native deployment `appgdep_6af30b443b508191a45fb8fccd789f87` returned `succeeded`. Same identity/access. Includes C14 client setup/UX and all billing navigation plus real-application screenshot walkthrough. Payments/account writes are blocked; no live provider, secrets or client records.
- **Exact provenance:** published Site source `cf0a6bfe882d93f5c83d4319a5f7269ba677abb4`, built from pushed Mansora `09b3ab943972c2ce1469cbe5f91bb064c5ed3b47` / PR #27. All 69 assets verified before archive. This follow-up changes handoff/publication docs only; the UI output is unchanged.
- **CI after push:** C18 PR/push preview, security/core and API container workflows pass; main CI (including Windows) still running. C14 merge `86f4c03` has green preview, security/core and API container; main CI still running. C14 PR `9838a4c` all checks passed before merge. Neither task marked done until merged-commit checks pass.
- **Verification limit:** no hosted browser QA (required Sites `cua_repl.js` absent); synthetic adapter/network isolation/asset checks pass and the real application separately passed 220 tests. Private hosting requires the owner's ChatGPT account; Claude should use GitHub source/handoff rather than assume this private link is accessible.
- **For Claude's protected billing UI:** `PaymentSettings` renders Loading when providers/settings data are absent but does not render their errors/retry; required/valid amount handling and inline unsaved-edit protection in billing forms also merit a focused follow-up. C14's validation/draft evidence covers its tested retail/setup workflows, not blanket acceptance of every new billing form. No protected billing file changed here.
- **Remaining:** complete CI/merge handoff for PR #27, verify C14 merged CI, and owner/provider/hardware/legal items already listed. Hosted preview is not production-service deployment.

### 2026-11-10 12:15 UTC — Codex (C14 merged / C18 publication preparation)
- **C14:** PR #26 merged as `86f4c03cb3bbd8c47609db68f3bf119d40c6fa60`. All four PR and push workflows on `9838a4c` passed, including full 220-test regression, PostgreSQL 16 sync, production audit, Windows installer/smoke, API container, security/core and preview. Merged-commit workflows are being checked; status is not marked done until those pass.
- **C18:** own branch `codex/C18-billing-preview` now rebased onto that merged default. Captures actual synthetic subscription/invoice/partial and full payment responses in throwaway stores, no-email and sandbox-only registry. Adds all billing read fixtures, effective invoice search/status and collection/subscription filters, owner-only billing reads, explicit unavailable custom report scope, blocked payment/account writes and generated screenshot walkthrough. No protected billing implementation changed.
- **Verified:** build, typecheck, synthetic generation and expanded adapter/asset checks pass. Checks cover every captured admin read, no backend network, blocked payment/mutation methods, cashier denial, invoice search/status and scope behavior. Site identity/audience confirmed owner-private; retained source opened. Existing Site remains C13/version 3 until native publication succeeds. Hosted browser QA unavailable because required `cua_repl.js` is absent; real repository application browser tests above are separate evidence.
- **Remaining:** check CI after this push, publish exact pushed source to existing Site, record deployment/version/source, and verify merged-commit CI for C14/C18. Legal/hardware/provider decisions remain owner work. Billing-specific form/content refinements should stay with Claude's protected billing implementation; no policy defaults approved here.

### 2026-11-10 12:09 UTC — Codex (C14 acceptance pass, C18 next)
- **Source:** PR #26 targets default directly, rebased onto `698ce49`. No protected core/sync/billing implementation, migration, bridge, infrastructure or lockfile changes relative to current default.
- **Fixed final regressions:** backup verification no longer treats its passphrase as an unsaved business edit; the accessibility scenario explicitly tests and confirms discarding its staged basket before subsequent keyboard navigation. Earlier nested-refund and post-save-client warnings are fixed. No assertion/timeout weakened.
- **Verified:** full real-engine/API/browser regression **220/220 tests in 31 files**, typecheck, build, separate legal inventory gate and production audit (zero vulnerabilities). Accessibility now covers all 22 client and 11 admin pages, including billing, at normal/200% equivalent viewport. Nine new acceptance scenarios verify saved records and recovery, not mocked success. Local synthetic screenshot/video evidence: `/workspace/mansora-client-readiness`.
- **Content:** regenerated all walkthrough screenshots from the running app, preserving billing. Capture credentials generated per run. Corrected privacy/negative-stock/approval claims. Legal drafts now cover all 757 migrated fields, including 235 billing additions; no retention policy chosen and no billing engine edited. Details: `docs/operations/client-readiness.md` and `docs/onboarding/client-handover.md`.
- **CI after prior push:** `e69559a` security/core, API container, sample preview and Windows installer/smoke passed; main test job failed the same two browser cases above, now fixed and locally green. Claim commit `698ce49` had no PR-triggered workflow runs returned by the connector (not evidence of success). This follow-up revision's CI is checked immediately after pushing; completion remains contingent on merged-commit CI.
- **Next/not done:** C14 merge and latest CI, then separately claimed C18 billing-aware preview generation/publication. Live private Site is still C13/version 3. No live money, production acceptance, hardware/signing/legal approval or provider/default choice is implied. Owner questions and C15–C17 remain as recorded.

### 2026-11-10 11:58 UTC — Codex (active work / claim)
- **Read and claimed:** C14 remains mine; C18 claims the billing-aware refresh of the existing private preview. C15–C17 remain unclaimed/blocked as recorded. I have not edited Claude's billing engine, migration, provider adapters or protected core files.
- **Current source:** draft PR #26 / `codex/C14-client-readiness`. Work includes actual-record setup, safe query states, money/whole-unit validation, draft protection, paginated/sortable lists and complete print exports. It is not yet deployed or accepted.
- **Verified before this handoff merge:** local typecheck passes; the existing eight desktop workflows pass; the legacy six UI scenarios and nine new client-readiness scenarios pass together (15 tests). This fixes the refund/owner-report/admin-consent cascade noted below. A false post-save navigation warning after creating a client is fixed too.
- **In progress:** preserve local changes, rebase C14 onto the current default, retarget PR #26 there, retain all billing navigation/guides/bridge/container configuration, reinstall from Claude's lockfile and run the full suite including billing and accessibility. The fourth reported keyboard/accessibility failure is not yet re-verified on this state.
- **Not verified yet:** current-default full CI, the rebased application, new walkthrough screenshots, and the billing-aware hosted preview. Existing published Site is still C13. Owner choices above remain open; no provider/tax/non-payment defaults approved here.
- **CI:** this docs-only claim commit is being pushed; its exact workflow result will be checked and logged. Do not infer its result from an earlier green commit.


### 2026-11-10 (later) — Claude
- **CI result:** head `4394c8a` is green on all four workflows (CI incl. Windows smoke, API container, Security and core checks, Sample interface preview). The earlier failures were mine (billing commit `1e46b33` onwards) and are fixed by `2f4155b`. The CI run on `2f4155b` itself was cancelled by the next push; `4394c8a` ran in full.
- **Still open:** C14 (Codex), preview regeneration with billing screens (Codex), owner questions above.

### 2026-11-10 — Claude
- **Done:** merged C12+C13 (`769981d`), Actions group, npm bumps (`4192cc7`); fixed CI regressions from billing (container secrets, Windows smoke bridge list) in `2f4155b`; walkthrough artifact refreshed (new billing sections, 45 screenshots).
- **Verified:** locally, typecheck, build, 210 tests, audit and the secrets test. **Not verified:** the container stack (no Docker daemon in my session) and the Windows installer smoke test: both depend on CI for `2f4155b`.
- **Found:** CI had been red since the billing commit and I had not looked. Cause and fixes are above.
- **Left:** CI result for `2f4155b`; C14 fixes (Codex); preview regeneration with billing (Codex); everything under *Open questions for the owner*.
- **Do not touch:** billing code and `apps/desktop/src/core/**`; tell me what you need instead.

## Tasks (detail)

### C1 — Two-factor authentication for Mansora administrators (TOTP) — DONE, merged (PR #10)
**Status:** Implemented on `codex/C1-admin-totp` for PR review; not deployed. Includes dashboard enrolment and challenged login, migration 3, encrypted secrets, hashed recovery codes, persistent rate limits, audit events, and API/browser regression tests.
**Why:** an admin account can create activation codes and deactivate laptops; a password alone is too weak.
**Scope:** `apps/api/src/modules/admin.ts`, `apps/api/src/security.ts`, new migration, `apps/admin-web/src/App.tsx`.
**Build:** RFC 6238 TOTP using `node:crypto` only (no new dependency). Endpoints to start enrolment (returns secret + `otpauth://` URI), confirm enrolment with a code, and disable (requires password + code). Login becomes two-step when enrolled: password → short-lived challenge → code. Store the secret encrypted with a key from `ADMIN_TOTP_KEY` (32 bytes, base64, required when any admin is enrolled). Ten single-use recovery codes, stored hashed. Rate-limit code attempts per admin. Audit enrolment, disablement, failed codes, recovery-code use.
**Done when:** tests cover a correct code, wrong code, replayed code within the same time step (rejected), clock skew of ±1 step, recovery code used once then rejected, rate limit, and that a session cannot be obtained with a password alone once enrolled. Admin dashboard has an enrolment screen and the second login step.

### C2 — Pluggable backup storage with an S3-compatible driver
**Status:** Implemented on `codex/C2-backup-storage` for PR review; not deployed. Includes immutable filesystem/S3 drivers, signed conditional requests, safe storage errors, unchanged existing backup tests and a local signature-verifying fake S3 suite.
**Why:** production must not keep client backups on the API server's disk.
**Scope:** new `apps/api/src/storage.ts`; `apps/api/src/app.ts`, `server.ts`, `.env.example`; the two backup routes may only be changed to call the interface (coordinate: they live in `modules/device.ts` — keep the diff to replacing the `fs` calls).
**Build:** `BackupStorage` interface (`put(key, bytes, sha256)` that never overwrites, `get(key)`, `exists(key)`). Keep the current filesystem behaviour as `FileStorage`. Add `S3Storage` using SigV4 signed `fetch` with `node:crypto` (no AWS SDK): `PutObject` with `If-None-Match: *`, `GetObject`, `HeadObject`; configured by `BACKUP_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`. Server-side encryption header on by default.
**Done when:** the existing backup tests pass unchanged on `FileStorage`; `S3Storage` is tested against a small in-process fake S3 server written in the test (signature verified, overwrite refused, round trip); documentation explains bucket settings (private, versioning, lifecycle).

### C3 — Container image and deployment files for the API
**Status:** Implemented on `codex/C3-api-containers` for PR review. Image, local first start/restart, authenticated smoke checks, runtime-role boundaries and secret generation verified; GitHub container workflow added. No live deployment.
**Scope:** new `infrastructure/` folder only (`Dockerfile`, `docker-compose.yml` for local PostgreSQL + API, `README.md`).
**Build:** multi-stage image, non-root user, read-only root filesystem, `HEALTHCHECK` on `/health`, no dev dependencies in the final image. Compose file runs migrations as a separate one-shot service with a separate migration role, then the API with a runtime role that is `NOSUPERUSER NOCREATEROLE NOBYPASSRLS` — include the SQL that creates both roles. A CI job builds the image and runs the compose stack, then calls `/health` and one authenticated admin endpoint.
**Done when:** `docker compose up` gives a working API from a clean machine, and the CI job passes.

### C4 — Performance test with a large catalogue, and any indexes it shows are needed
**Status:** Implemented on `codex/C4-performance` for PR review. Full dataset measured, candidate indexes tested and rejected, and all operations over 200 ms at p95 have proposed fixes in `docs/operations/performance.md`. No application query/schema changes.
**Why:** nothing has been measured beyond a handful of products.
**Scope:** new `tests/performance/`; a **new** SQLite migration in `apps/desktop/src/core/schema.ts` is the one permitted exception to rule 2, limited to `CREATE INDEX` statements.
**Build:** a script (not part of `npm test`; add `npm run test:perf`) that creates 20,000 products, 200,000 sales with 3 lines each over 12 months and 2,000 customers through the engine's commands or direct inserts that respect the schema, then times: product search by name fragment, barcode lookup, `sale.complete`, `report.sales` and `report.profit` for one month and one year, `stock.overview`, `sale.list` for a day, and a sync push of 1,000 events against the embedded API.
**Done when:** results (median and p95, machine described) are written to `docs/operations/performance.md`; any query over 200 ms at p95 is either fixed with an index and re-measured, or listed with a proposed fix. Do not change query results.

### C5 — Accessibility pass on the shared UI kit and both interfaces
**Status:** Implemented on `codex/C5-accessibility` for review: axe scans of all navigation pages/tabs and representative forms, shared keyboard/focus/label fixes, contrast and responsive layout fixes. See `docs/operations/accessibility.md`; Windows NVDA/native zoom/hardware checks remain pending.
**Scope:** `packages/ui/src/index.tsx`, `apps/admin-web/src/**`, and `apps/desktop/src/renderer/**` (interface only; no engine calls added or removed).
**Build:** add `axe-core` as a dev dependency and an end-to-end test that runs it on every desktop page and every admin page and fails on serious or critical violations. Fix what it finds. Also check by hand: every control reachable and operable by keyboard, visible focus, modal focus trap and return, tables have captions or labels, colour is never the only signal (stock badges, variance badges), text contrast at least 4.5:1, and the layout works at 1366 × 768 and at 200% zoom.
**Done when:** the axe test passes with no serious or critical violations, and `docs/operations/accessibility.md` lists what was checked, what was fixed and what remains (screen-reader testing on Windows with NVDA must be listed as not done unless you actually did it).

### C6 — Admin dashboard: tests and small gaps
**Status:** Implemented for review on `codex/C6-admin-dashboard`: combined client search/status filters, server-scoped client audit tab, in-app deactivation confirmation, stable pending onboarding checkbox state and localhost CRUD/session browser coverage. API source is unchanged.
**Scope:** `apps/admin-web/src/**`, new `tests/e2e/admin.test.ts`, read-only use of the API.
**Build:** browser tests for: add client, edit client, change status, tick and untick onboarding steps, create and edit a plan, assign a subscription, create an activation code, deactivate a laptop (with a fake activated device created through the API), session expiry returns to the login screen, and a non-admin token is rejected. Add client search and status filter to the Clients page, and a per-client audit tab using the existing `?tenantId=` parameter. Replace `window.confirm` with the `Modal` component.
**Done when:** the tests pass in CI and need no network beyond localhost.

### C7 — Structured logging, request IDs and an error-reporting hook in the API
**Status:** Implemented for review on `codex/C7-observability`: bounded request IDs, sanitized JSON logs and metadata identity context, liveness/readiness, token-protected in-memory Prometheus metrics and opt-in bounded error delivery. See `docs/operations/observability.md`.
**Scope:** `apps/api/src/app.ts`, `server.ts`, new `apps/api/src/observability.ts`.
**Build:** request ID on every request (accept a validated incoming `x-request-id`, else generate) returned in the response and included in error bodies; JSON logs with tenant ID and device ID or admin ID where known, and never tokens, passwords, backup bytes or event payloads; a `reportError(err, context)` hook that is a no-op unless `ERROR_WEBHOOK_URL` is set; `/health` split into liveness and readiness; a `/metrics` endpoint (Prometheus text, protected by a bearer token from the environment) with request counts and durations by route, sync events accepted and rejected, and login failures.
**Done when:** tests assert that secrets never appear in captured log output for login, sync and backup requests, and that request IDs propagate.

### C8 — Draft privacy and data-protection documents for legal review
**Scope:** new files under `docs/legal/` only. No code.
**Build:** plain-language drafts, each headed "DRAFT — not legal advice — for review by a Ghanaian data-protection lawyer": (1) a data inventory from the real schema (`packages/domain/src/sync.ts` and the migrations) listing every personal-data field, why it is held, where (laptop, cloud, backups) and who can see it; (2) a client-facing privacy notice template a shop can display to its customers; (3) a controller/processor responsibilities outline for the Mansora–client agreement; (4) a retention and deletion proposal per table, with the engineering consequence of each choice (financial records are immutable by design, so say what deletion or anonymisation would require); (5) a checklist for Data Protection Act, 2012 (Act 843) registration and cross-border-transfer questions to put to the lawyer. State assumptions as questions, not conclusions.
**Done when:** every personal-data column in the schema appears in the inventory (add a small test that reads the schema and fails if a new column is not listed).

### C9 — Browser end-to-end coverage for the remaining desktop workflows
**Status:** Implemented for review on `codex/C9-desktop-workflows`: eight real-interface scenarios covering every listed workflow, with accounting/permission invariants and actual backup verification. No application-code fix was required; selector/setup findings are documented in `docs/operations/workflow-tests.md`.
**Scope:** new files under `tests/e2e/` only; read-only use of `apps/desktop/dev/host.ts` and `scripts/static.ts`.
**Build:** tests through the real interface for: stock count with differences, receiving a purchase and the resulting average cost, damaged-stock adjustment, product import preview with an error row and with duplicates, import commit and the "already imported" refusal, credit sale then partial repayment then settlement, cash in/out with manager approval, closing a shift with a variance and manager sign-off, expense from the till changing expected cash, staff creation with a restricted permission set, owner-only settings, owner recovery and re-link screens, backup creation and verification, and the discount limit setting. Follow the style of `tests/e2e/ui.test.ts`.
**Done when:** the tests pass in CI and any bug they find is reported in the PR description with the failing steps (fixes to `apps/desktop/src/**` are welcome as a separate commit in the same PR).

## Not for Codex (Claude is doing these)

Choosing the discount-limit value (Mansora's policy) · signed auto-updates (waiting on a certificate) · Windows packaging in CI.


### C10 — Retail pricing additions requested by the owner
**Priority:** Owner request on 2026-11-09/10, ahead of the remaining C5–C9 work.
**Status:** Implemented for review on `codex/C10-carton-costing`: Excel carton columns and preview validation, product carton calculator, permission-gated catalogue gross margins and selling-price labels, explicit cashier discount requests, durable approval lockouts and exact owner-ceiling comparisons. See `docs/operations/product-pricing.md`.
**Scope exception:** The owner's explicit costing/import and discount-restriction requirements need shared costing helpers and narrow importer/engine/sales changes under `apps/desktop/src/core/`; this feature PR keeps those changes separate from C4/C5. No sync protocol, sync tests or released migrations change.

### C11 — Official Mansora branding and SaaS positioning
**Status:** Implemented for review on `codex/C11-mansora-branding`; owner requested the branding from https://mansora-consulting.com and confirmed Mansora provides the SaaS platform to client businesses.
**Scope:** Shared brand assets/tokens/component, desktop and admin shells/sign-in, local asset serving, desktop icon configuration and branding browser tests.
**Evidence:** See [branding](operations/branding.md). The provider brand accompanies client workspace names; receipt merchant identities remain client businesses. No subscription enforcement or legal terms are inferred from the branding.


### C12 — Hosted sample interface preview
**Status:** Published the [private sample demo](https://mansora-saas-demo.bgtpk74dbt.chatgpt.site) through Sites. Implemented on `codex/C12-hosted-demo`, based on the combined integration branch because it previews all prepared tasks. Owner requested hosting without supplying a Vercel project.
**Scope:** New preview builder, isolated static browser adapters and preview documentation. No production engine, API, migration, permission or billing behavior changes.
**Evidence:** See [interface preview](operations/interface-preview.md). Both current interfaces are used with generated synthetic records; temporary sample edits are explicit, live writes are blocked.

### C13 — Professional accounting-style UX, reports and page guidance
**Status:** Implemented on `codex/C13-accounting-ux`, based on C12 so the same hosted demo can show the combined application. Owner requested familiar accounting UX, professionalism, more reporting and how-to help.
**Scope:** Shared workspace shell/components/styles, client and provider interfaces, authorised report presentation, page guides, sample preview regeneration and regression coverage. No engine or schema changes.
**Evidence:** See [accounting UX](operations/accounting-ux.md).

### C14 — End-to-end client UI and content readiness
**Status:** In progress on `codex/C14-client-readiness`, rebased onto the latest default branch, preserving billing. The owner requested a substantive client-readiness build and visibility for Claude. Current C14 source is pushed for review before deployment; the live sample preview still shows C13 until acceptance checks pass.
**Scope:** Actual client/provider UI behaviour, setup and handover content, recovery states, validation, unsaved-work protection, long lists and real-engine end-to-end evidence. No production engine, migration, hosting policy or permission policy changes.
**Evidence:** [Client readiness report](operations/client-readiness.md), which explicitly distinguishes completed checks from pending work.

### C15 — Email delivery adapter for billing messages
**Scope:** new file under `apps/api/src/billing/` implementing `EmailAdapter` (see `core.ts`), wired in `createBillingFromEnv`; tests with a local fake SMTP/API server. Needs an email provider decision (Mansora blocker B5), so build against a provider-neutral SMTP or HTTP interface and keep `NoEmail` as the default when unconfigured.
**Done when:** queued notifications are delivered and marked `sent`/`failed`; failures retry without duplicating; no message body is logged; `docs/billing/provider-onboarding.md` is updated.

### C16 — Hubtel adapter (only after Hubtel confirms)
**Blocked** until Mansora supplies Hubtel's written confirmation of the recurring Mobile Money API, mandate rules, fees and sandbox credentials (blocker B4). Do not guess endpoints. Implement `providers/hubtel.ts` against the sandbox, with capability flags set only to what is confirmed, plus contract tests with a local fake.

### C17 — Printable PDF invoices and receipts
**Scope:** `apps/api/src/billing/documents.ts`. The current output is printable HTML. Add server-side PDF only if it needs no heavy new dependency (otherwise keep HTML print). Tests compare totals, numbers and issuer details.

### C18 — Billing-aware hosted sample preview refresh
**Owner:** Codex, claimed before implementation.
**Scope:** Existing preview builder/adapters and interface documentation, with synthetic sandbox billing fixtures. Keep the same Site identity/access; include client Billing and all provider billing screens. No live charge, provider onboarding, credentials, protected billing engine change or new payment policy.
**Acceptance:** Generate from the merged current application; verify every displayed billing read and disabled write, no secret/real-client data, refresh the existing published URL, and record source/deployment/CI evidence here.


### C19 — Interface ready for deployment
**Owner:** Codex, claimed under the owner's clarified scope.
**Scope:** Frontend states, navigation, validation, draft handling and client-facing copy, including billing UI. Do not change billing engine/provider/permission policy. Coordinate the temporary billing-UI file ownership in the handoff above.
**Completed:** identified UI gaps fixed, real-API/browser acceptance and all merged CI green, merged source and shared version 6 updated. The interface-specific report records verified outcomes and the hosted-browser verification limit.
