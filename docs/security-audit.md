# Mansora security audit and hardening

Audit date: 2026-11-09. Base commit: 8bbb338ba7e891a021fe5c01ee2b2e7b3eb394b5.
Scope: tracked API, desktop core, domain validation, dependency lockfile and available GitHub metadata. This is a source review and local verification; no production infrastructure or credentials were supplied, and no live penetration test was performed.

## Addressed

- **High: authentication throttling bypass.** The API previously trusted all forwarded IP headers, and login attempts were bucketed by IP plus email. It now ignores forwarding headers by default, permits explicitly configured proxy IPs/CIDRs only, limits aggregate login attempts per IP and failures per email, and bounds limiter memory. Rate limits remain process-local.
- **High: backup integrity on repeated uploads.** A repeated backup UUID could replace file contents while leaving the original checksum in PostgreSQL. Files now use immutable content-addressed names, publish atomically with restrictive file permissions, allow identical retries, and reject UUID reuse with different bytes or another tenant. Upload authentication runs before body parsing, so unauthenticated callers cannot trigger the large raw-body parser.
- **Medium: malformed password hashes.** Both verifiers now reject unsupported work factors, empty hashes and incorrect salt/hash lengths before invoking scrypt. Existing valid hashes remain supported.
- **Medium: response caching and log exposure.** API responses use `Cache-Control: no-store`; request authorization and cookie headers are redacted when logging is enabled.
- **Dependency findings:** upgraded Vitest from 3.x to 5.1.0. The full npm audit changed from 11 findings (2 critical, 9 moderate) to 8 moderate, with no high or critical findings. Counts include dependency-chain entries, not distinct exploitable application paths.
- Added weekly Dependabot updates and CI for locked installation, high/critical dependency auditing, type checking, all tests and the API build. Actions use pinned commit SHAs and read-only repository permissions.

## Validation

- `npm test`: 66 tests passed across 6 files, including 6 hardening regressions.
- `npm run typecheck`: passed.
- `npm run build -w @mansora/api`: passed.
- `git diff --check`: passed.
- `npm audit --json`: 8 moderate, 0 high, 0 critical.
- `npm run build`: fails because `apps/desktop/index.html` is absent. Desktop Electron/build scripts and the referenced `@mansora/admin-web` workspace are also absent. Packaging and browser/Electron security cannot be verified from this checkout.

## Remaining work and deployment requirements

1. Review the moderate dependency chains: `exceljs -> uuid` and Electron packaging dependencies using `minimatch`. The registry proposes major-version changes/downgrades; these were not forced without a working desktop packaging target. Import/export behavior and platform packaging need verification when selecting replacements.
2. Terminate HTTPS at a controlled edge, configure `TRUSTED_PROXIES` only with actual proxy addresses/CIDRs, prevent direct backend access, and have that edge replace client-supplied forwarding headers. Multiple API processes need a shared rate-limit backend and edge connection/request limits.
3. Add per-tenant backup quotas, retention and orphan-file cleanup. Authenticated uploads still buffer up to 200 MiB; checksum validation does not prove a client encrypted its bytes. Keep the backup directory on a private, monitored filesystem. Concurrent conflicting uploads or DB failures can leave unreferenced immutable files.
4. Use encrypted local databases and OS-protected key storage in the desktop host. `openEngine` permits an unencrypted database, and the optional remembered backup passphrase resides in local metadata. The missing host prevents verification of secure key provisioning and Electron isolation.
5. Separate database migration credentials from the runtime role. Startup currently runs migrations, and the configured connection can assume both application roles. RLS tests demonstrate scoped queries; they do not protect against compromise of the runtime connection itself. Use a non-superuser runtime login and deliberate role membership in production.
6. Synced records, including support grants, are trusted assertions from an authorized device. Cloud report consent enforces the synced grant, not independent cryptographic proof of owner action. Device compromise can forge that tenant's business data and grants; protect device tokens accordingly.
7. GitHub rulesets returned an empty list. Require review and passing CI on the default branch after the new workflow has run. The connector rejected the branch-protection read URL, so legacy branch protection could not be verified. No repository administration settings were changed.

The code fixes require deployment to take effect. This audit does not certify production readiness.
