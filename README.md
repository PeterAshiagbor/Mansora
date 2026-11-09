# Mansora Sales & Stock

Offline-first POS and inventory core with a multi-tenant Fastify/PostgreSQL API.
Requires Node.js 22.12+ (Node.js 24 is used in CI) and npm.

## Develop and verify

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3-multiple-ciphers
npm test
npm run typecheck
npm run build -w @mansora/api
npm audit --audit-level=moderate
```

Tests use embedded PostgreSQL and encrypted SQLite; they do not need a production database. The repository currently includes desktop core code but lacks the desktop renderer, Electron host/build scripts, demo script and admin-web workspace referenced by package scripts. The full application build and desktop packaging remain unavailable until those sources are restored.

Dependency overrides pin patched `uuid` and `minimatch` versions. Compatibility tests exercise Excel import/export and conditional formatting, desktop packaging filters and universal binary matching. Full OS installer validation still requires the missing desktop host.

## Run the API

Environment variables are read from the process environment. Copy `apps/api/.env.example` for reference and supply values through your deployment's environment or secret manager; the server does not automatically load `.env` files.

1. Provision PostgreSQL and run `npm run api:migrate` as a deployment step with `MIGRATION_DATABASE_URL` (or `DATABASE_URL` as a fallback). The migration identity must be able to create tables and the two application roles.
2. Create a separate runtime PostgreSQL login with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, access to the application database/schema, and membership in `mansora_platform` and `mansora_tenant`. Do not grant it schema ownership or migration/table creation privileges. Assign its password through the database/secret management system.
3. Set `DATABASE_URL` to that runtime login. Create the first administrator with `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` supplied in the environment to `npm run api:create-admin`. Administrator passwords need at least 12 characters.
4. Start with `npm run api:dev`, or build the API and run `npm start -w @mansora/api`. API startup and administrator creation do not apply migrations; always run migrations before starting a new version.

Use HTTPS at the edge. Configure `ADMIN_ORIGINS` with exact browser origins. Leave `TRUSTED_PROXIES` empty for direct connections; otherwise list only the actual proxy IPs/CIDRs, block direct backend access, and replace inbound forwarding headers at the edge. `BACKUP_DIR` must be a private, writable filesystem directory. API responses are not cacheable.

Login password checks use bounded asynchronous scrypt work. Rate limits are local to each process; multiple replicas require shared or edge enforcement. Backup uploads are authenticated before parsing and capped at 200 MiB each; other request bodies are capped at 8 MiB. Tenant storage quotas and retention remain deployment work.

Portable backups omit remembered passphrases. Remembering a passphrase is allowed only with an encrypted local database. Previously created backups are unchanged and should be rotated if they carried remembered secrets.

See [the security audit](docs/security-audit.md) for verification evidence and remaining deployment requirements.
