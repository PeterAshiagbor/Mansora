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

## Database roles

| Role | Used by | Privileges |
| --- | --- | --- |
| Migration role | Deploy step only | Owns the schema; `CREATEROLE` on first run |
| API login role | The running API | Member of `mansora_platform` and `mansora_tenant`; **not** superuser, **no** `BYPASSRLS` |

## Configuration (environment variables)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (TLS required) |
| `PORT`, `HOST` | Listen address |
| `ADMIN_ORIGINS` | Exact origin(s) of the admin dashboard, comma-separated |
| `BACKUP_DIR` | Directory for client backup files |

## Deploy

```bash
npm ci && npm run build
DATABASE_URL=... npm run api:migrate
ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... DATABASE_URL=... npm run api:create-admin   # first time only
node apps/api/dist/server.js
```

Admin dashboard: deploy `apps/admin-web/dist` and replace `config.js` with
`window.MANSORA_API_URL = 'https://api.<your-domain>';`.

## Before real client data

- [ ] Ghana Data Protection Act 2012 (Act 843) review; registration with the Data Protection Commission if required
- [ ] Controller / processor agreement with each client; privacy notice
- [ ] Hosting region and any cross-border transfer approved
- [ ] Retention and deletion rules defined and implemented
- [ ] Backup restore of the cloud database rehearsed into a clean environment
- [ ] Independent security review of the API and installer
- [ ] Backup storage moved from a local directory to private object storage
- [ ] Two-factor authentication for administrators (not yet built)
- [ ] Monitoring and alert routing tested
