# Phase report — Phases 0 and 1, with the core of Phases 2–4

Date: 9 November 2026 · Version 0.1.0

## Summary

The foundation the specification asked for first is built and proven by automated
tests: a laptop can complete sales with no internet, survive a restart or a
crash, and sync every record to the cloud exactly once; two businesses are fully
isolated; and Mansora cannot see a client's reports without the owner's consent.

On top of that, working versions of all 26 client screens and the admin
dashboard exist and are exercised by a browser end-to-end test.

**It is not production-ready.** Nothing has been run on a physical Windows
laptop, scanner or receipt printer by a person; the installer is unsigned; no
production cloud exists; and the legal, privacy and commercial items are open.

## Features implemented

**Shop laptop application**
- Activation with a one-time code; owner login created on the laptop; offline login; auto-lock; password-guess throttling
- Checkout: search and barcode entry, basket, basket discount, cash / card / mobile money / credit / split payments, change, receipt (print, reprint, PDF), keyboard shortcuts
- Refunds: full or partial, supervisor approval at the till, restock or write-off per item, credit cancelled before cash is paid out
- Products, categories, stock overview, movement ledger, damages and corrections, stock counts, purchases and suppliers with moving-average cost
- Customers, credit sales, due dates, partial repayments, overdue balances
- Cashier shifts: float, live expected cash, cash in/out with approval, close with variance, manager sign-off
- Expenses, kept separate from cost of goods
- Reports: dashboard, sales (daily, monthly, product, cashier, best sellers), payments, gross profit, stock; export to Excel and CSV; print/PDF
- Staff and per-person permissions; business settings
- Product and opening-stock import from Excel/CSV with template, column mapping, preview, validation, duplicate detection, history and safe retry
- Full business data export (Excel, JSON)
- Sync status, encrypted backup with verification, restore onto a fresh laptop
- Owner password recovery with a one-time code; rebuilding a replacement laptop from cloud data; re-linking a restored laptop; re-sending synced records
- Owner-controlled Mansora access with a visible access log; audit history

**Cloud API and admin dashboard**
- Client directory, 12-step onboarding checklist, service plans and subscriptions (recorded, not collected), activation codes, laptop deactivation
- Client health: last sync, unsynced count, app version, last backup, connectivity, "data may be incomplete" flag
- Idempotent sync ingest; encrypted backup storage
- Consent-gated sales summary; platform overview with no client financial data; administrator audit log

## Tests executed and results

`npm test` — **84 passed, 0 failed** (Node 22, Linux). Sync and isolation suites
were also run against a real PostgreSQL 16.15 server as a non-superuser: 18 passed.
`npm run typecheck` — clean. All three applications build.

| Spec test | Result | Where | Notes |
| --- | --- | --- | --- |
| 01 Laptop independence | Pass (software) | `tests/e2e/ui.test.ts` | Whole flow in a desktop browser with keyboard and mouse. **Not run on a physical Windows laptop** |
| 02 Barcode scan | Pass (simulated) | `tests/e2e/ui.test.ts` | Rapid keystroke scans, including a repeat. **No physical scanner** |
| 03 Sale and stock deduction | Pass | `tests/integration/engine.test.ts` | 20 → 17, one −3 movement, retry creates no second sale |
| 04 Offline transactions | Pass | `tests/sync/sync.test.ts` | 100 offline sales, restart, reconnect; cloud totals and stock equal the laptop's |
| 05 Sync retries | Pass | `tests/sync/sync.test.ts` | Lost acknowledgements ×3, raw replays, reversed and concurrent delivery |
| 06 Refund | Pass | engine + e2e | Approval, restock vs write-off, limits, reports |
| 07 Credit repayment | Pass | engine | Balance falls; no sale created; cash counted in shift |
| 08 Cashier restrictions | Pass | engine + e2e | Refused in the engine, audited; cost data stripped from responses |
| 09 Tenant isolation | Pass | `tests/security/isolation.test.ts` | Row-level security, forged events, credential mix-ups |
| 10 Cash shift | Pass | engine | Expected cash and variance exact |
| 11 Receipt printing | **Not tested** | — | Receipt content is tested; no printer has been used |
| 12 Backup restoration | Pass (automated) | engine | Restored into a clean directory under a new key. **Not rehearsed on a second physical laptop** |
| 13 Data export | Pass | engine | Excel and JSON; no secrets included |
| 14 Mansora access control | Pass | isolation + e2e | Denied, granted, logged, revoked, expired |
| 15 Data integrity | Pass | engine + `tests/sync/crash.test.ts` | Failure before commit, and SIGKILL mid-transaction |

CI (GitHub Actions, run 42702980256): the Linux job passes typecheck, build, all tests, the sync suite on PostgreSQL 16 and the dependency audit. The Windows job builds the unsigned installer on Electron 44 and launches the packaged app, which passes its shell checks (no Node access in the page, only the agreed bridge calls, unauthenticated and unknown commands refused, navigation blocked). Electron 45 is not yet usable: the encrypted-SQLite module does not compile against it.

## Known limitations

1. **Hardware untested**: no scanner, receipt printer, cash drawer or reference laptop.
2. **Electron app not used by a person.** CI launches the packaged Windows app and checks its shell; every workflow test runs through the development browser host instead.
3. **Unsigned installer; no automatic updates.**
4. **No production cloud**, monitoring, error reporting or backup schedule.
5. Owner password recovery, rebuilding a laptop from cloud data, re-linking a restored laptop and re-sending records are built and tested in software, **not rehearsed on physical laptops**.
6. Automatic daily backups exist but are off until the owner switches them on, and only run while the app is open.
7. **Subscription expiry is not enforced** (policy undecided).
8. **One administrator role, no two-factor authentication.**
9. **Receipts**: no logo, no online sharing; PDF uses the printer page size.
10. **Whole-unit quantities only**; no price override at the till; no discount limits.
11. Discounts have no percentage or amount limits (policy undecided).
12. **Remote permission changes** from the cloud are not implemented; staff are managed on the laptop.
13. **Accessibility** has had no formal audit; it has labels, focus handling and keyboard support but has not been tested with a screen reader.
14. **Performance** has not been measured with a large catalogue (tens of thousands of products).
15. `npm audit` reports no known vulnerabilities (two transitive packages are pinned to patched versions by overrides).

## Remaining work

**Needs Mansora** — brand assets; reference hardware; approval of the defaults in the decision log; hosting region and Act 843 review; code-signing certificate; ownership and commercial terms.

**Engineering, next** — run and fix on physical Windows hardware (Phase 5); signed installer and updates; production deployment with monitoring; discount limits once policy exists; administrator two-factor authentication; load testing; external security review; first-client pilot (Phase 6).

## Demonstration

```bash
npm install && npm run build
npm run demo -- --seed
```

1. Open http://127.0.0.1:5173, sign in as `cashier` with the printed password. Open a shift with 100.
2. Click the search box, type `6001068000012` and press Enter (this is what a scanner does). Press F9, type 100, Enter.
3. Sign out; sign in as `owner`. Look at Dashboard, Reports, Stock, Audit history.
4. Open http://127.0.0.1:5174 and sign in as the demo administrator. Open the sample client and press "View sales summary": it is refused.
5. On the laptop: Mansora access → grant. Back in the dashboard: the summary now appears, and the Audit log shows both the refusal and the view.
6. Stop the demo. Run `npm run desktop:dev`, sell again: the status bar shows Offline and a waiting count. Restart the demo: it syncs.
