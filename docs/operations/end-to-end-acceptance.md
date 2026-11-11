# End-to-end acceptance — 2026-11-11

The tested release combines C23 platform hardening (PR #35, merge `460bc01ea2b762cc479e85d0a71d42523e487329`) and C24 professional interface (PR #36, merge `077b90825d5b987a2d8031c9d4a63d62221205aa`). Both were merged only after all six final feature workflows passed. All six exact merged workflows also pass.

## Verified application workflows

- **265 tests across 38 files pass**, locally with Chromium and in CI. Typecheck, all production builds and dependency audit pass; audit reports zero vulnerabilities.
- Six sync tests pass separately against a real PostgreSQL 16 service. Windows CI builds the unsigned installer, launches the packaged application and verifies its secure shell. Real API, team-staging and Railway image acceptance jobs pass.
- Real browser scenarios cover client activation; product/customer/staff creation; keyboard barcode sales; exact change and refused-payment recovery; approved refunds; whole-unit stock counts, purchases and damage; carton costs and gross margins; Excel validation, commit and duplicate refusal; discount permissions and approval; credit sale and repayments; cash movements, expenses and shift sign-off; encrypted backup verification; password recovery/re-link; reporting, export and support-consent audit.
- UI acceptance includes larger catalogues and customer lookup, stale/out-of-order report recovery, unsaved form protection, contextual navigation/help, independent owner/cashier browsers, same-origin admin and sandbox checkout. Accessibility checks exercise business/operator pages and forms, keyboard focus, dialogs, table activation, tabs and 200% equivalent viewports.
- Hardening tests cover actual XLSX files, bounded expansion even with false ZIP metadata, malformed/encrypted/traversal archives, permission checks before parsing, concurrent imports, active-handler capacity and health availability. Existing business, billing and sync policies remain intact.

The visual pass corrected a primary-button brand-colour fallback and sidebar expansion timing after search. Capture/browser fixtures were updated to the corrected online sign-in copy. Forty-five walkthrough screenshots were regenerated from the real app with synthetic records; the final full runs pass.

## Hosted review

- Public sample: https://mansora-saas-demo.bgtpk74dbt.chatgpt.site — version 8, public audience preserved. Saved version `appgprj_6af2c4565ff881919480f43aab9e56bb~appgver_ffdfaca8aefc8191bd2633d53d9c0b6c`, succeeded deployment `appgdep_6af47e41aa1881918faa22523058a0f7`; pushed source `4fdf41516efb382224237ca2dd0bab0c3e1d6e6f`, generated from application `118cf5bdde052b6894ea014eedb9766610928c02`. Static sample/asset checks pass. Managed Site browser QA was unavailable; native deployment success and actual-application browser tests are separate evidence.
- Persistent team test: https://mansora-production.up.railway.app — actual encrypted retail stores and PostgreSQL, separate businesses and private account credentials. Only synthetic records belong in this environment.

## Live Railway acceptance

Deployment `e0ece4de-0287-4cf5-b880-4b2f3f0f9604` is SUCCESS for merged application `077b90825d5b987a2d8031c9d4a63d62221205aa`. It waited for GitHub checks before building. At 14:44 UTC:

- Ten authenticated live checks pass: readiness/security headers; both assigned email owner logins and Secure/HttpOnly/SameSite cookies; independent cashier sessions; the existing saved QA product and its original stock/cost surviving deployment; masked cashier costs/denied writes; cross-business and cookie isolation; actual Excel template generation/preview; online billing summary; operator login/clients API; and isolated logout. Existing passwords were preserved.
- Chromium signs into **both businesses**, refreshes the dashboard, opens 15 operational pages per business, switches reporting tabs, opens contextual help and signs out. A separate operator browser signs in, opens ten administration pages and signs out. No uncaught browser exception or HTTP 5xx was observed.
- Private live screenshots were inspected and kept outside the repository; committed screenshots contain synthetic identities only. No invitation email, real charge or customer data was sent.

## Scope of the result

The tested workflows have no outstanding failures. This is evidence for team testing, not a claim that every possible defect or production dependency is resolved. Actual payment/email provider activation, signed hardware distribution and owner policy/legal decisions remain tracked separately. High-volume annual-report latency remains documented in `performance.md`; this UI/hardening release does not change protected reporting or sync algorithms or make new load-capacity promises.
