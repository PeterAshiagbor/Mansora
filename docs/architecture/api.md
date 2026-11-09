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
| POST | `/v1/devices/owner-recovery` | Confirm a one-time owner recovery code for this business. |
| GET | `/v1/sync/snapshot` | All synced rows for this business, to rebuild a replacement laptop. Audited. |
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
| POST | `/v1/admin/clients/:id/recovery-codes` | Owner recovery code (reason required, 1 hour, shown once) |
| POST | `/v1/admin/devices/:id/revoke` | Deactivate a laptop |
| GET | `/v1/admin/clients/:id/reports/summary?from&to` | Sales summary. **403 unless the owner has an active grant.** Every call is audited. |
| GET | `/v1/admin/overview` | Platform health; no client financial data |
| GET | `/v1/admin/audit?tenantId` | Administrator audit log |

## Administrator two-factor authentication

Without an enrolled factor, `POST /v1/admin/login` accepts `{email, password}` and returns `{token, admin}` as before. With an enrolled factor it instead returns `{requiresTotp: true, challenge, expiresAt}` and **no session token**. `POST /v1/admin/login/totp` accepts `{challenge, code}` and returns the session only after verifying a fresh TOTP or consuming an unused recovery code. Challenges are random, stored hashed, expire in five minutes, and are replaced by another password sign-in for the same admin.

| Method | Path | Body / response |
| --- | --- | --- |
| GET | `/v1/admin/totp` | Session required; `{enabled, recoveryCodesRemaining}` |
| POST | `/v1/admin/totp/enrol` | Session and `{password}`; returns `{secret, uri, expiresAt}` (ten minutes) |
| POST | `/v1/admin/totp/confirm` | Session and `{code}`; returns `{enabled: true, recoveryCodes}` (shown once) |
| POST | `/v1/admin/totp/disable` | Session and `{password, code}`; returns `{enabled: false, signInAgain: true}` and revokes all sessions |

The implementation uses RFC 6238 SHA-1, six digits, 30-second steps, ±1 step tolerance, and a monotonically increasing last-used step. Confirmation also consumes its step. Ten 80-bit recovery codes are stored as SHA-256 hashes. Encrypted secrets use AES-256-GCM with administrator-bound authenticated data and `ADMIN_TOTP_KEY` (canonical base64 of exactly 32 random bytes). All MFA tables are platform-only; no business data is involved.

Factor verification and recovery consumption serialize on the administrator row in a transaction. Failure counters and audit entries commit even when the HTTP response is an error. Five failures in a five-minute window block further verification across API replicas; the existing per-IP limiter is an additional process-local control. Invalid settings verification returns 400 (keeps the session); invalid second-step login returns 401; exhausted attempts return 429; unavailable decryption returns 503. Enabling retains only the session that verified the confirmation code, invalidating all other sessions and challenges.

`GET /health` checks the database connection.
