# Cloud API (v1)

JSON over HTTPS. Errors are `{ "code": "...", "message": "..." }`. Amounts are
integer pesewas. Two kinds of bearer token exist and are not interchangeable.

## Device endpoints (device token)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/devices/activate` | No auth. Exchange a one-time code for `{deviceId, deviceToken, tenant}`. One active device per client. |
| POST | `/v1/sync/events` | Push `{protocol: 1, device: {appVersion, pendingCount, lastBackupAt}, events: [...]}` (max 200). Returns `{accepted: [ids], rejected: [{id, reason}]}`. Safe to repeat. |
| GET | `/v1/sync/pull` | Account status, subscription, log of Mansora access to this business. |
| PUT | `/v1/backups/:id` | Upload an encrypted backup (`application/octet-stream`, `x-sha256` header). |
| GET | `/v1/backups/latest` | Download this business's latest cloud backup. |

Event shape: `{id, seq, type, occurredAt, actorId, payload: {rows: {<table>: [row…]}}}`.
Tables and columns are fixed by `SYNC_TABLES` in `packages/domain/src/sync.ts`;
unknown tables or columns are rejected.

## Admin endpoints (admin session token)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/admin/login`, `/v1/admin/logout`; GET `/v1/admin/me` | Session |
| GET, POST | `/v1/admin/plans`; PUT `/v1/admin/plans/:id` | Service plans |
| GET, POST | `/v1/admin/clients` | Directory with health; create client (also creates the 12 onboarding steps) |
| GET, PUT | `/v1/admin/clients/:id` | Profile, onboarding, devices, backups, grant metadata; edit profile/status |
| PUT | `/v1/admin/clients/:id/onboarding/:step` | Mark a step done or not done |
| PUT | `/v1/admin/clients/:id/subscription` | Plan, status, renewal date |
| POST | `/v1/admin/clients/:id/activation-codes` | New code (shown once, 72 hours) |
| POST | `/v1/admin/devices/:id/revoke` | Deactivate a laptop |
| GET | `/v1/admin/clients/:id/reports/summary?from&to` | Sales summary. **403 unless the owner has an active grant.** Every call is audited. |
| GET | `/v1/admin/overview` | Platform health; no client financial data |
| GET | `/v1/admin/audit?tenantId` | Administrator audit log |

`GET /health` checks the database connection.
