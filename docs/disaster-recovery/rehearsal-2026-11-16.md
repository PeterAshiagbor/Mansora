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
