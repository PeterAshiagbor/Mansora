# Shared browser platform hardening

The live Railway deployment uses the existing native encrypted retail engine and PostgreSQL API. This pass protects the shared browser transport and deployment path; financial rules, role permissions, sync, schema, payment providers and native IPC remain unchanged.

## Changes

- HTTPS origins emit one-year HSTS. Loopback HTTP development does not. All staging responses retain no-store, strict script/frame policy, no-referrer and nosniff, and add no-index/no-archive, same-origin resource policy, and disabled microphone/geolocation permissions.
- Active route handlers are limited to 16, with a clear 503/Retry-After response at capacity. Health probes remain available. Header count, keep-alive requests, socket connections and existing request/header deadlines are bounded.
- Only one authorised spreadsheet preview/commit can run at a time. Competing imports receive a retryable response. Permission checks happen before resource-intensive preflight, and the actual engine still performs its own authentication, permission and schema validation.
- XLSX files are checked before ExcelJS loads the workbook. ZIP entry counts and offsets are validated; encrypted, multi-disk, ZIP64, traversal and inconsistent archives are rejected. Both declared sizes and actual bounded DEFLATE output are checked against a 32 MB expanded limit. The engine's existing 10 MB compressed-file limit still applies. Ordinary CSV and valid Excel remain supported.
- GitHub browser tests run in Microsoft's official Playwright 1.65.0 Noble image, pinned by digest, with the matching Playwright client and a real Chromium launch check. All browser/financial/sync assertions remain. This removes the repeated runtime APT dependency download that failed when GitHub's Ubuntu mirror DNS was unavailable. The container reaches its real PostgreSQL service through the service hostname. Setup and Linux job duration are bounded.

## Railway deployment checks

The actual Mansora GitHub repository trigger `463621e8-87af-4410-821f-f53955198a5b` now has `checkSuites=true`, verified through Railway's service read-back. CLI environment source edits reported no change for this legacy trigger field, so the documented authenticated GraphQL fallback updated only the trigger's checkSuites boolean. Source repository, branch, volumes, private variables and region were preserved. New automatic deployments wait for GitHub checks.

The project is `a1cf9cc8-51b7-4ede-ab94-46e0635e589d`, web service `10eec874-69fc-4cd6-819e-a739f1f7d9ca`, environment `e3191e69-1291-4769-a16e-4c782f396f5b`. It is explicitly a team-test application despite Railway's default environment label. A fixed monthly charge is not promised; existing resource limits remain in place.

## Evidence and limits

Focused tests exercise actual Excel exports, compressed-content expansion beyond false ZIP metadata, malformed/encrypted/multi-disk archives, permission-before-parsing, concurrent imports, handler saturation and health availability. Existing real browser sales/stock/Excel/billing checks remain intact. Full CI, exact merged source and live response checks are recorded in the collaboration board when complete.

Already verified live before this pass: both named test email logins, secure cookie flags, separate owner/cashier sessions, a saved QA product, cross-business isolation, cashier cost/write restrictions, Excel writer/parser, billing summary, provider admin API and isolated logout. Test credentials were privately copied unchanged into Railway Variables; the temporary SSH key was removed and no credentials entered GitHub or deployment logs.

This does not claim a penetration test, successful backup restoration, production legal/provider approval, hardware acceptance, or isolation from a fully compromised application process. The combined-container bootstrap credential tradeoff remains documented in railway-staging.md. Use synthetic business data for team testing.
