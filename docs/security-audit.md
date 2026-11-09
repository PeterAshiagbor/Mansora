# Mansora security audit and hardening

Audit date: 2026-11-09. Base commit: 8bbb338ba7e891a021fe5c01ee2b2e7b3eb394b5.
Scope: tracked API, desktop core, domain validation, dependency lockfile and available GitHub metadata. This is a source review and local verification; no production infrastructure or credentials were supplied, and no live penetration test was performed.

## Addressed

- **High: authentication throttling bypass.** The API previously trusted all forwarded IP headers, and login attempts were bucketed by IP plus email. It now ignores forwarding headers by default, permits explicitly configured proxy IPs/CIDRs only, limits aggregate login attempts per IP and failures per email, and bounds limiter memory. Rate limits remain process-local.
- **High: backup integrity on repeated uploads.** A repeated backup UUID could replace file contents while leaving the original checksum in PostgreSQL. Files now use immutable content-addressed names, publish atomically with restrictive file permissions, allow identical retries, and reject UUID reuse with different bytes or another tenant. Upload authentication runs before body parsing, so unauthenticated callers cannot trigger the large raw-body parser.
- **Medium: malformed password hashes.** Both verifiers now reject unsupported work factors, empty hashes and incorrect salt/hash lengths before invoking scrypt. Existing valid hashes remain supported.
- **Medium: response caching and log exposure.** API responses use `Cache-Control: no-store`; request authorization and cookie headers are redacted when logging is enabled.
- **Dependency findings:** upgraded Vitest from 3.x to 5.1.0. The full npm audit changed from 11 findings (2 critical, 9 moderate) to zero findings after patching transitive `uuid` and `minimatch` with explicit overrides. Counts include dependency-chain entries, not distinct exploitable application paths.
- Added weekly Dependabot updates and CI for locked installation, moderate-and-above dependency auditing on Node.js 22 and 24, type checking, all tests and the API build. Actions use pinned commit SHAs and read-only repository permissions.

## Follow-up improvements

- HTTP login verification now uses asynchronous scrypt with at most four concurrent checks per process. Unknown accounts and malformed stored hashes receive dummy password work to reduce account-enumeration timing differences. The desktop verifier remains synchronous for local use.
- The 200 MiB body allowance is scoped to the authenticated backup route; unrelated raw-body requests retain the normal 8 MiB cap.
- Remembered passphrases require local database encryption and are removed from portable backup copies without changing live metadata.
- Migrations run as a separate deployment step, with an optional dedicated connection string. The README documents runtime role provisioning and missing application sources.

## Validation

- `npm test`: 72 tests passed across 8 files, including authentication concurrency, request limits, backup secrets and dependency compatibility regressions.
- `npm run typecheck`: passed.
- `npm run build -w @mansora/api`: passed.
- `git diff --check`: passed.
- `npm audit --json`: 0 vulnerabilities across all severity levels.
- `npm run build`: fails because `apps/desktop/index.html` is absent. Desktop Electron/build scripts and the referenced `@mansora/admin-web` workspace are also absent. Packaging and browser/Electron security cannot be verified from this checkout.

## Remaining work and deployment requirements

1. Maintain the explicit dependency overrides for patched `uuid` and `minimatch` until upstream packages adopt patched versions. Regression tests exercise Excel import/export, conditional formatting (which uses uuid), packaging include/exclude filters and universal binary matching. Full installer validation remains blocked by the missing desktop host.
2. Terminate HTTPS at a controlled edge, configure `TRUSTED_PROXIES` only with actual proxy addresses/CIDRs, prevent direct backend access, and have that edge replace client-supplied forwarding headers. Multiple API processes need a shared rate-limit backend and edge connection/request limits.
3. Add per-tenant backup quotas, retention and orphan-file cleanup. Authenticated uploads still buffer up to 200 MiB; checksum validation does not prove a client encrypted its bytes. Keep the backup directory on a private, monitored filesystem. Concurrent conflicting uploads or DB failures can leave unreferenced immutable files.
4. Use encrypted local databases and OS-protected key storage in the desktop host. `openEngine` permits an unencrypted database, and remembered backup passphrases reside in encrypted local metadata only. New portable backups omit the remembered passphrase; rotate older backups that included one. The missing host prevents verification of secure key provisioning and Electron isolation.
5. Separate database migration credentials from the runtime role. API startup and administrator creation no longer run migrations; use the explicit migration command with `MIGRATION_DATABASE_URL`. The runtime connection still must assume both application roles. RLS tests demonstrate scoped queries; they do not protect against compromise of the runtime connection itself. Use a non-superuser runtime login and deliberate role membership in production.
6. Synced records, including support grants, are trusted assertions from an authorized device. Cloud report consent enforces the synced grant, not independent cryptographic proof of owner action. Device compromise can forge that tenant's business data and grants; protect device tokens accordingly.
7. GitHub rulesets returned an empty list. Require review and passing CI on the default branch after the new workflow has run. The connector rejected the branch-protection read URL, so legacy branch protection could not be verified. No repository administration settings were changed.

The code fixes require deployment to take effect. This audit does not certify production readiness.
