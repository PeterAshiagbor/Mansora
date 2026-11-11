# Railway team-test deployment

This adapter runs the existing API and browser retail gateway in one web service, plus a dedicated Railway PostgreSQL service. A persistent `/data` volume holds encrypted retail stores, keys, backup files and private test credentials. It targets team testing, with sample business data and sandbox-only payments; it is not a production billing/provider acceptance claim.

## Railway project

1. Create a project, add a dedicated PostgreSQL service named `Postgres`, and connect this repository's default branch as the web service. Set the service Dockerfile path to `infrastructure/railway/Dockerfile`, root directory `/`, health check `/healthz` and health-check timeout 300 seconds. Railway currently deprecates railway.json/railway.toml configuration; these settings are applied directly through the service configuration. The image uses standard RUN instructions because Railway rejects BuildKit secret mounts.
2. Mount a persistent volume at **`/data`** on the web service. Start with 1 GB and monitor storage. Keep **one replica**; horizontal scaling of this native SQLite transport is unsupported. Set deployment overlap to zero and draining to 30 seconds so the previous instance stops before the new instance uses the volume. This single-volume test environment can have a brief interruption on redeploy.
3. Add web-service variable `DATABASE_URL` as the private Railway reference `${{Postgres.DATABASE_URL}}`. The database is dedicated to Mansora: initialization creates application roles and restricts schema/connect privileges. Do not point this at a shared database or a production database.
4. Add `STAGING_TESTER_EMAILS` as a JSON array of the two owner-supplied tester addresses. Real addresses belong in private service variables, never committed configuration. Example: `["first@example.test","second@example.test"]`.
5. Optionally set `STAGING_TESTER_PASSWORDS` to a private JSON array of two distinct, cryptographically generated passwords (at least 24 characters), in the same order as the emails. This makes initial passwords retrievable from Railway's private Variables dashboard. Keep the variable private; existing passwords are never reset if the value is changed. Without it, passwords are generated into the private volume only.
6. Generate a Railway HTTPS domain on the web service. The adapter uses `RAILWAY_PUBLIC_DOMAIN`; if using a custom hostname, explicitly set `STAGING_ORIGIN=https://your-test-hostname`. Railway injects `PORT`; port 4000 is reserved for the internal API. The application listens publicly only through the authenticated staging gateway.
7. Deploy and wait for healthy status. Run `node /app/railway/smoke.cjs` in a private Railway service shell. It prints only pass/fail labels. Check service usage and configure Railway's available budget/usage controls; $5–$15 is a target, not a fixed price or an application-enforced spending ceiling.

If GitHub auto-deployment is enabled, merged application changes can trigger a deployment; a GitHub merge alone does not prove the service deployed. Record the Railway deployment ID, source commit, domain and acceptance results in the collaboration board after checking the actual service.

## Accounts

Each supplied email is an alias for the actual owner account created during activation of one sample business (first address Shop A, second Shop B). They have independent accounts, passwords and business data. The native engine's single-owner rule is preserved; the adapter does not insert extra owners or change staff permissions. Each business also has generated manager and cashier credentials for restricted-role and collaboration tests. In the browser's Username field, enter the assigned email; ordinary generated usernames also work.

An authorized operator can retrieve `/data/staging/test-accounts.json` through Railway's private service shell. It contains the assigned emails, workspace IDs, usernames, roles and random passwords. Do not put its contents in deployment logs, public artifacts or issue comments. The separate provider administration account is recorded in `/data/secrets/operator-account.json`; the two business owners are not automatically made platform administrators. Ordinary provisioning does not send invitations. An explicit `STAGING_TESTER_INVITATION_ID` enables the separately journaled Resend invitation operation described in `test-invitations.md`; passwords activate only after provider acceptance.

Accounts, passwords and keys persist on the mounted volume. Repeated startup does not reset them. Changing the supplied tester list after provisioning fails closed for operator review. Changing the public hostname is supported; existing browser sessions expire on restart and users sign in again. Deleting/replacing the database or volume independently requires deliberate recovery, not automatic re-provisioning.

## Security and lifecycle

The initializer repairs ownership of the fresh mounted volume, drops to UID/GID 1000, then starts application code. Startup refuses a missing/ephemeral `/data` mount. Migration and runtime passwords, TOTP encryption key, billing encryption key, pay-link key and encrypted retail database master key are generated once and stored privately. The Railway-provided administrator database connection is used only for role/schema initialization; application requests use `mansora_runtime`, without superuser, role-creation, database-creation, RLS-bypass or migration membership. PostgreSQL migration and platform/tenant access rules remain unchanged.

The bootstrap database reference remains a private Railway service setting available to authorized service operators; this combined-container adapter does not claim container isolation of that setting from application code. Keep Railway project access restricted. The original multi-container deployment remains available for stricter process/secret separation.

The API binds to loopback, preserving the engine's HTTPS-or-loopback activation check. The gateway checks request origin, scopes HttpOnly cookies to each business, enforces request/session limits and delegates permissions to the real engine. Health checks depend on API/database readiness, not just an open port. Sandbox billing jobs run every 15 minutes; retail sync and backups retain their existing schedules. Live payment credentials are refused.

Use Railway backup facilities for both the database and web volume, with protected key retention. Restoration must be tested separately; a green startup/restart test is not a backup-restoration test. Desktop printers, scanners, cash drawers, offline selling and native restoration still need desktop/hardware acceptance. Review region, retention and legal requirements before introducing real client data.

## Evidence

The Railway acceptance workflow builds this exact image against PostgreSQL 16, runs the native engine and Excel smoke checks as a non-root user, signs in using both synthetic test email aliases, recreates the entire stack without deleting volumes, and requires the original saved record. Transport tests cover alias isolation, private key preservation, changed-identity refusal and unhealthy readiness. Existing UI, financial, permission and native bridge tests continue to run. A Railway account/domain deployment is recorded only after actual authenticated deployment succeeds.

## Shared API runtime configuration (C32)

The normal API entrypoint and Railway adapter both use `apps/api/src/runtime.ts`. Railway enables the existing sanitized structured request logger and honors `METRICS_TOKEN`, `ERROR_WEBHOOK_URL` and `TRUSTED_PROXIES`. Metrics remain disabled (404) when unset, and require bearer authentication when configured. Through the gateway the path is `/api/metrics`; no credentials belong in URLs. Error webhook delivery uses the existing sanitized metadata and bounded failure handling. These settings are server-only and introduce no browser/IPC contract.

`BACKUP_DIR` overrides the default; otherwise Railway uses `/data/cloud-backups`. The shared storage factory honors all five `BACKUP_S3_*` connection settings and optional server-side encryption setting. Partial S3 configuration fails startup instead of silently falling back to disk. With no S3 settings, the existing local volume behavior is preserved. This wiring does not provision a bucket or choose a provider, region, retention policy or new backup credentials. Local backup bytes still share the web volume failure domain until a separate approved remote destination is configured.

Composition verification exercises the shared runtime options against real API metrics authentication and sanitized error delivery, signed fake-S3 backup round trips/immutability/tenant isolation, filesystem fallback/override paths and partial configuration refusal. Railway image acceptance additionally configures a synthetic metrics token and checks the actual gateway endpoint before and after container recreation. This addresses C30 F03/F04 configuration defects; it does not claim a live remote backup or monitoring destination has been configured.

## Additive test business records

Set `STAGING_SAMPLE_DATA_VERSION=retail-v1` to prepare the actual registered test businesses using the existing authenticated commands. See [the data pack guide](test-data.md) for content, export/report permissions, restart behavior and the private journal. This setting never resets existing business data or weakens gateway, role, tenant, encryption or import controls.

## Add a browser workspace without redeploying

The Railway adapter supports the authenticated **Browser workspace** action on an existing client. The owner completes the private setup link and chooses their own password; the new encrypted store joins the running gateway, sync/backup loops and durable registry. Existing test workspaces are preserved. See [C36 provisioning and acceptance](browser-workspaces.md). Client-mode readiness and independent recovery remain C37/C38 tasks.
