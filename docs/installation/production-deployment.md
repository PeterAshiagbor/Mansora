# Production deployment (cloud)

**Not yet done.** No production environment exists. This is the procedure to
follow once Mansora has approved a hosting region (decision D-12) and controls
the cloud account and domain.

## What to provision (all in Mansora-owned accounts)

1. Managed PostgreSQL 16 with automated daily backups and point-in-time recovery.
2. A container or Node 22 host for the API behind HTTPS (managed certificate).
3. Static hosting for the admin dashboard on its own HTTPS origin.
4. Private storage for client backup files (encrypted by clients already).
5. Log collection, uptime monitoring on `/health`, and error alerting.

For a reproducible local container stack and CI smoke verification, see [infrastructure/README.md](../../infrastructure/README.md). It separates migration/runtime credentials and does not choose or deploy production hosting.

## Database roles

| Role | Used by | Privileges |
| --- | --- | --- |
| Migration role | Deploy step only | Owns the schema; `CREATEROLE` on first run |
| API login role | The running API | Member of `mansora_platform` and `mansora_tenant`; `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`; owns nothing |

## Configuration (environment variables)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Runtime login's PostgreSQL connection string (TLS required) |
| `MIGRATION_DATABASE_URL` | Used only by `npm run api:migrate`. The API server never runs migrations |
| `TRUSTED_PROXIES` | Exact proxy IPs/CIDRs whose forwarding headers are trusted. Empty for direct connections |
| `PORT`, `HOST` | Listen address |
| `ADMIN_ORIGINS` | Exact origin(s) of the admin dashboard, comma-separated |
| `ADMIN_TOTP_KEY` | Base64 of 32 cryptographically random bytes; required for enrolment and whenever any administrator is enrolled. Supply from a secret manager; never put the key in dashboard config or source control |
| `BACKUP_DIR` | Directory for client backup files |

## Deploy

```bash
npm ci && npm run build
MIGRATION_DATABASE_URL=... npm run api:migrate
ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... DATABASE_URL=... npm run api:create-admin   # first time only
node apps/api/dist/server.js
```

Admin dashboard: deploy `apps/admin-web/dist` and replace `config.js` with
`window.MANSORA_API_URL = 'https://api.<your-domain>';`.

## Administrator TOTP encryption key

Generate a fresh key in your secret manager, or use `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"` in a secure administrative terminal and store its output there. Supply the same `ADMIN_TOTP_KEY` to every API instance. Do not include the value in commits, logs, browser configuration or support messages.

Run the new migration before deploying the API. It adds only platform MFA tables, with no change to released migration 1 or tenant data. When an administrator is enrolled, startup verifies that the key can decrypt an enrolled secret; missing/invalid keys prevent startup. Enrolment also refuses to proceed without a configured key.

Back up the key separately from the database and test restoration together. Changing or losing it makes enrolled secrets unreadable, including when attempting to use a recovery code; the server fails closed. There is no automatic key-rotation, password-only bypass or administrative MFA-reset endpoint in this task. Coordinate a controlled disable/re-enrol operation while the old key is available, or define a separately reviewed recovery/rotation procedure before changing the key.

## Before real client data

- [ ] Ghana Data Protection Act 2012 (Act 843) review; registration with the Data Protection Commission if required
- [ ] Controller / processor agreement with each client; privacy notice
- [ ] Hosting region and any cross-border transfer approved
- [ ] Retention and deletion rules defined and implemented
- [ ] Backup restore of the cloud database rehearsed into a clean environment
- [ ] Independent security review of the API and installer
- [ ] Backup storage moved from a local directory to private object storage
- [ ] Configure and back up `ADMIN_TOTP_KEY`, enrol administrators, and test recovery codes
- [ ] Monitoring and alert routing tested
