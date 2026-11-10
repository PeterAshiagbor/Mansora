# Combined software review

`codex/integration-review` combines the prepared C2–C11 implementations on
default-branch commit `348d95c862b29f5518531d2b139c8dd0061f8732` (which
already includes C1). The individual PRs remain the review units listed in
[the task list](../codex-tasks.md). This branch provides the complete combined
application for review, without changing the default branch or deploying it.

## Included work

| Task | Source commit | PR |
| --- | --- | --- |
| C2 backup storage | `55afb932` | #13 |
| C3 restricted API container | `438cbe97` | #14 |
| C4 measured performance | `d04aab99` | #15 |
| C5 accessibility | `d349a5a9` | #17 |
| C6 admin workflows | `9e8f0d88` | #18 |
| C7 safe observability | `fff07fdf` | #19 |
| C8 privacy drafts | `2f750bf5` | #20 |
| C9 desktop workflow tests | `b4ad1d7f` | #21 |
| C10 retail pricing and restricted discounts | `f64862e4` | #16 |
| C11 official brand and SaaS positioning | `b5bd7f5b` | #22 |

## Integration resolutions

- The API initializes the C2 storage abstraction while retaining C7 request IDs,
  safe logs, protected metrics, health checks and error hook. Registered routes
  receive the storage context. Both storage and HTTP errors retain request IDs.
- Environment examples retain both S3 and observability settings. No credentials
  are supplied.
- Admin onboarding retains C6 optimistic updates and C5 contrast corrections.
  The provider navigation retains C11 branding and C5 accessibility attributes.
- Product tables retain C10 selling prices, permission-gated margins and carton
  calculation alongside C5 textual stock-state badges.
- Both stylesheets use C11 shared brand tokens and offline fonts while retaining
  C5 focus outlines and the desktop print/reduced-motion rules.
- Decision entries and task records are combined; the owner's brand/provider
  and individual-item costing confirmations are recorded explicitly.
- The combined accessibility suite additionally scans C6 client audit and
  deactivation screens at both viewport sizes. No existing assertion is removed.

## Verification

Local checks use Node 24.22.1 on Linux and Chromium with Playwright installed
outside the repository. Browser tests use synthetic businesses and runtime
credentials, the encrypted laptop engine and local PGlite API.

- `npm run typecheck` — passed.
- `npm run build` — passed for desktop, admin and API.
- `NODE_PATH=/tmp/mansora-browser/node_modules npm test -- --maxWorkers=1` — 153 tests across 21 files passed, zero skipped (126.21 seconds).
- `npx tsx --test docs/legal/inventory.test.ts` — passed; verifies every migrated schema column and sync field against the inventory.
- `node --test infrastructure/secrets.test.mjs` — passed.
- `npm audit` — zero vulnerabilities, including development dependencies.
- The combined lockfile exactly matches the clean-install C5 lockfile already checked by Windows CI.

The C11-only branch separately passed all 104 tests, typecheck, build and audit.
Combined screenshots are reviewed at 1366 × 768 and the 683 × 384 CSS viewport
equivalent to the available layout at 200% zoom. Neither native zoom nor NVDA
is claimed. GitHub CI separately checks Linux browser workflows, PostgreSQL 16,
Windows unsigned packaging/shell smoke tests and the API container stack.

## Outstanding owner-dependent work

Physical scanners/printers and Windows shop hardware, code-signing credentials,
live hosting and storage credentials/region, Ghanaian legal review and the
outstanding policy decisions remain open. In particular no discount percentage,
retention period, subscription-expiry enforcement or legal ownership terms are
approved by this integration. Mansora is the confirmed SaaS provider; each
client retains its business identity in its workspace and receipts.

Large-dataset measurements and proposed report improvements remain in
[performance](performance.md). Rejected indexes are not shipped. Passing tests
is evidence of software behavior, not production or hardware acceptance.
