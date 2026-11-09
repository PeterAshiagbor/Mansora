# Task list for Codex (parallel work)

These tasks are chosen so they do not touch the files Claude is working in.
Take them in order; each is one pull request.

## Ground rules

1. Branch from the latest `claude/relaxed-lovelace-0179ut` (the default branch). One branch and one pull request per task, named `codex/<task-id>-<short-name>`. Rebase before opening the PR.
2. **Do not edit** `apps/desktop/src/core/**`, `packages/domain/src/sync.ts`, `apps/api/src/modules/device.ts` or `tests/sync/**`. Claude owns these. Migration `id: 2` is already taken; start at `3`. If a task seems to need a change there, write what you need in the PR description instead.
3. Never edit a released migration. Add `id: 2`, `3`, … to `apps/api/src/migrations/index.ts`. New tenant tables need the same row-level-security block as the existing ones; new platform tables need a `GRANT` to `mansora_platform` only.
4. All database access goes through `db.platform()` or `db.tenant()`. Admin code must never read a business table outside the consent-checked report path.
5. Money is integer pesewas. No floating-point money.
6. Every task ships tests. `npm run typecheck`, `npm run build`, `npm test` and `npm audit` must pass. Do not skip, weaken or delete existing tests.
7. Regenerate `package-lock.json` only from a clean tree (`rm -rf node_modules package-lock.json && npm install`), otherwise Windows build binaries go missing from the lockfile and the Windows CI job breaks.
8. No secrets, sample passwords or real client data in the repository.
9. Do not claim anything is tested on hardware, or production-ready.
10. Update the relevant file under `docs/` in the same PR, and add a row to `docs/decisions/decision-log.md` for any policy you had to assume.

## Tasks

### C1 — Two-factor authentication for Mansora administrators (TOTP)
**Status:** Implemented on `codex/C1-admin-totp` for PR review; not deployed. Includes dashboard enrolment and challenged login, migration 3, encrypted secrets, hashed recovery codes, persistent rate limits, audit events, and API/browser regression tests.
**Why:** an admin account can create activation codes and deactivate laptops; a password alone is too weak.
**Scope:** `apps/api/src/modules/admin.ts`, `apps/api/src/security.ts`, new migration, `apps/admin-web/src/App.tsx`.
**Build:** RFC 6238 TOTP using `node:crypto` only (no new dependency). Endpoints to start enrolment (returns secret + `otpauth://` URI), confirm enrolment with a code, and disable (requires password + code). Login becomes two-step when enrolled: password → short-lived challenge → code. Store the secret encrypted with a key from `ADMIN_TOTP_KEY` (32 bytes, base64, required when any admin is enrolled). Ten single-use recovery codes, stored hashed. Rate-limit code attempts per admin. Audit enrolment, disablement, failed codes, recovery-code use.
**Done when:** tests cover a correct code, wrong code, replayed code within the same time step (rejected), clock skew of ±1 step, recovery code used once then rejected, rate limit, and that a session cannot be obtained with a password alone once enrolled. Admin dashboard has an enrolment screen and the second login step.

### C2 — Pluggable backup storage with an S3-compatible driver
**Why:** production must not keep client backups on the API server's disk.
**Scope:** new `apps/api/src/storage.ts`; `apps/api/src/app.ts`, `server.ts`, `.env.example`; the two backup routes may only be changed to call the interface (coordinate: they live in `modules/device.ts` — keep the diff to replacing the `fs` calls).
**Build:** `BackupStorage` interface (`put(key, bytes, sha256)` that never overwrites, `get(key)`, `exists(key)`). Keep the current filesystem behaviour as `FileStorage`. Add `S3Storage` using SigV4 signed `fetch` with `node:crypto` (no AWS SDK): `PutObject` with `If-None-Match: *`, `GetObject`, `HeadObject`; configured by `BACKUP_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`. Server-side encryption header on by default.
**Done when:** the existing backup tests pass unchanged on `FileStorage`; `S3Storage` is tested against a small in-process fake S3 server written in the test (signature verified, overwrite refused, round trip); documentation explains bucket settings (private, versioning, lifecycle).

### C3 — Container image and deployment files for the API
**Scope:** new `infrastructure/` folder only (`Dockerfile`, `docker-compose.yml` for local PostgreSQL + API, `README.md`).
**Build:** multi-stage image, non-root user, read-only root filesystem, `HEALTHCHECK` on `/health`, no dev dependencies in the final image. Compose file runs migrations as a separate one-shot service with a separate migration role, then the API with a runtime role that is `NOSUPERUSER NOCREATEROLE NOBYPASSRLS` — include the SQL that creates both roles. A CI job builds the image and runs the compose stack, then calls `/health` and one authenticated admin endpoint.
**Done when:** `docker compose up` gives a working API from a clean machine, and the CI job passes.

### C4 — Performance test with a large catalogue, and any indexes it shows are needed
**Why:** nothing has been measured beyond a handful of products.
**Scope:** new `tests/performance/`; a **new** SQLite migration in `apps/desktop/src/core/schema.ts` is the one permitted exception to rule 2, limited to `CREATE INDEX` statements.
**Build:** a script (not part of `npm test`; add `npm run test:perf`) that creates 20,000 products, 200,000 sales with 3 lines each over 12 months and 2,000 customers through the engine's commands or direct inserts that respect the schema, then times: product search by name fragment, barcode lookup, `sale.complete`, `report.sales` and `report.profit` for one month and one year, `stock.overview`, `sale.list` for a day, and a sync push of 1,000 events against the embedded API.
**Done when:** results (median and p95, machine described) are written to `docs/operations/performance.md`; any query over 200 ms at p95 is either fixed with an index and re-measured, or listed with a proposed fix. Do not change query results.

### C5 — Accessibility pass on the shared UI kit and both interfaces
**Scope:** `packages/ui/src/index.tsx`, `apps/admin-web/src/**`, and `apps/desktop/src/renderer/**` (interface only; no engine calls added or removed).
**Build:** add `axe-core` as a dev dependency and an end-to-end test that runs it on every desktop page and every admin page and fails on serious or critical violations. Fix what it finds. Also check by hand: every control reachable and operable by keyboard, visible focus, modal focus trap and return, tables have captions or labels, colour is never the only signal (stock badges, variance badges), text contrast at least 4.5:1, and the layout works at 1366 × 768 and at 200% zoom.
**Done when:** the axe test passes with no serious or critical violations, and `docs/operations/accessibility.md` lists what was checked, what was fixed and what remains (screen-reader testing on Windows with NVDA must be listed as not done unless you actually did it).

### C6 — Admin dashboard: tests and small gaps
**Scope:** `apps/admin-web/src/**`, new `tests/e2e/admin.test.ts`, read-only use of the API.
**Build:** browser tests for: add client, edit client, change status, tick and untick onboarding steps, create and edit a plan, assign a subscription, create an activation code, deactivate a laptop (with a fake activated device created through the API), session expiry returns to the login screen, and a non-admin token is rejected. Add client search and status filter to the Clients page, and a per-client audit tab using the existing `?tenantId=` parameter. Replace `window.confirm` with the `Modal` component.
**Done when:** the tests pass in CI and need no network beyond localhost.

### C7 — Structured logging, request IDs and an error-reporting hook in the API
**Scope:** `apps/api/src/app.ts`, `server.ts`, new `apps/api/src/observability.ts`.
**Build:** request ID on every request (accept a validated incoming `x-request-id`, else generate) returned in the response and included in error bodies; JSON logs with tenant ID and device ID or admin ID where known, and never tokens, passwords, backup bytes or event payloads; a `reportError(err, context)` hook that is a no-op unless `ERROR_WEBHOOK_URL` is set; `/health` split into liveness and readiness; a `/metrics` endpoint (Prometheus text, protected by a bearer token from the environment) with request counts and durations by route, sync events accepted and rejected, and login failures.
**Done when:** tests assert that secrets never appear in captured log output for login, sync and backup requests, and that request IDs propagate.

## Not for Codex (Claude is doing these)

Discount limits at checkout (waiting on Mansora's policy) · signed auto-updates (waiting on a certificate) · Windows packaging in CI.
