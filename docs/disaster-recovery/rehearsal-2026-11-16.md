# Laptop-loss recovery drill: 2026-11-16

Environment: disposable container, embedded PostgreSQL and a real Mansora engine (scripts/recovery/drill.ts). Synthetic data. **Not** Railway, and **not** a physical Windows laptop.

| Measure | Result |
| --- | --- |
| Backup taken | 2026-11-16T00:59:23.033Z |
| Last successful sync before the loss | 2026-11-16T00:59:23.237Z (pushed 29 changes) |
| Changes only on the lost laptop (not synced, not backed up) | 5 sale(s): the recovery point is the last sync |
| Sales on the lost laptop / after recovery | 71 / 66 |
| Records added from the cloud during catch-up | {"inserted":134,"updated":0,"rebuiltStock":2,"rebuiltCredit":1} |
| Recovery time (restore file, open, catch up from cloud) | 0.94 s (excludes installing the app and fetching the backup file) |

| Check | Result |
| --- | --- |
| Restored sales equal the cloud copy | Pass |
| Sales value equals the cloud copy | Pass |
| Refunds equal the cloud copy | Pass |
| Customer credit equals the cloud copy | Pass |
| Stock units equal the cloud copy | Pass |
| Only the unsynced, unbacked-up sales are lost | Pass |
| Catch-up sync succeeded | Pass |
| New receipt number continues without collision | Pass |
| Cloud accepts the replacement laptop again | Pass |

Overall: **PASS**


## Hosted (browser) system backup

`tests/staging/full-system-snapshot.test.ts`, `tests/staging/system-backups.test.ts` and `tests/staging/snapshot-lock.test.ts`: 9 of 9 passed on the same day. They take an encrypted system snapshot of PostgreSQL plus the shop stores and keys, then restore it into a new database and volume. The off-site upload is simulated.

## What this rehearsal does and does not prove

- It proves the restore and catch-up logic end to end on real code, with every figure matching the cloud copy, no receipt-number collisions and a measured recovery point. The recovery point is the last successful sync, or the last backup if that is newer.
- It is **not** the witnessed rehearsal on production-like infrastructure that the audit asks for. Still to do, with a named witness, on synthetic data, never over live data:
  1. **Physical laptop.** Install the signed Windows build on a clean laptop, restore a real `.mbk` file from another laptop, choose Sync now, and record the elapsed time, including fetching the file and installing.
  2. **Railway.** Restore the newest off-site system backup into an isolated Railway environment (new database and volume), then check sign-in, tenant isolation, balances, stock and sync continuity. Record the elapsed time from the decision to restore.
- Rerun this drill after any change to sync, backup or restore: `npx tsx scripts/recovery/drill.ts`. It exits non-zero on any failed check.

## Railway rehearsal attempt, 16 November 2026 (owner-approved, read-only finding)

The owner approved a restore rehearsal into a temporary, isolated Railway environment. Before creating anything, a
read-only check of project "Mansora team testing", environment `production`, found **no backup to restore from**:

- Off-site system backups are **off**. `SYSTEM_BACKUP_ENCRYPTION_KEY`, the interval, endpoint and region are set,
  but `SYSTEM_BACKUP_S3_BUCKET`, the access-key pair and `MANSORA_SYSTEM_BACKUPS` are not.
- Railway volume backups for the production database volume (`Postgres data`) and the `/data` volume
  (`Mansora persistent data`) have **no backups and no schedule**.
- With the owner's approval, enabling a daily Railway backup schedule was attempted. Railway refused: *"Manual
  backups and backup schedules are only available for Pro workspaces"*. **Nothing in production was changed.**

**Severity: critical.** If the production volume or database were lost today, browser shops' data and the platform
database (clients, billing, synced records) could not be recovered. Laptop shops keep their own copies.

To unblock the rehearsal, either:
1. complete the Google bucket setup in `system-backups.md` (about 20 minutes, Google account owner) and switch
   `MANSORA_SYSTEM_BACKUPS` on; then restore the first verified copy into a temporary environment, or
2. move the Railway workspace to Pro, enable daily volume backups on both production volumes, and take a first backup.

Option 1 is the documented, encrypted, provider-independent path and is needed for the isolated restore either way.
