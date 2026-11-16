# Backup and recovery

## What protects a shop's data

| Layer | Covers | Limit |
| --- | --- | --- |
| Local database (WAL, full sync) | Power cuts, app crashes, restarts | Not loss of the laptop |
| Cloud sync | Everything acknowledged by the server | Only what has synced |
| Encrypted backup file (`.mbk`) | Everything up to the moment it was made, including unsynced records and staff logins | Needs the owner's passphrase; only as recent as the last backup |
| Cloud copy of the backup | The same, off the laptop | Uploaded only when online at backup time |

**Records created after both the last sync and the last backup exist only on the
laptop.** The app counts them and warns on the Dashboard, Sync status and Backup
screens.

## Cloud backup storage

The API can store encrypted backups in a private S3-compatible bucket or the existing private filesystem directory. Driver selection preserves tenant authentication and checksum checks. See [API backup storage](../operations/backup-storage.md) for bucket settings, retention and moving existing files. A bucket and the PostgreSQL backup metadata must be restored together; switching storage configuration does not copy existing backups.

## Recovery scenarios

| Scenario | Outcome | Evidence |
| --- | --- | --- |
| A. Internet lost | Keeps working | `tests/sync/sync.test.ts` (100 offline sales) |
| B. App closes unexpectedly | Committed transactions intact; no partial sale | `tests/sync/crash.test.ts` (process killed mid-sale) |
| C. Laptop restarts | Database and sync queue persist | TEST 04 |
| D. Cloud unavailable | Keeps working; retries with back-off | TEST 05 |
| E. Laptop lost | Restore latest `.mbk` on a new laptop | `tests/integration/engine.test.ts` (restore into a clean directory under a new key; totals, stock, logins and permissions reconcile) |
| F. Cloud data or server lost (browser version) | Restore the newest off-site system backup (Google Cloud Storage) into a new database and volume: [system-backups.md](system-backups.md) | `tests/staging/full-system-snapshot.test.ts`, `tests/staging/system-backups.test.ts`; **not yet rehearsed on Railway** |

## Restoring on a replacement laptop

1. Install the app. Do not activate.
2. Activation screen → "Restore from a backup instead" → passphrase → choose the `.mbk` file.
3. The app verifies the backup (decryption, SQLite integrity and foreign-key checks), restores it under the new laptop's own key and opens it. Staff sign in as before.
4. **Catch-up with the cloud (audit F04).** A backup is usually older than the cloud copy. Until the laptop has caught up, sales and refunds are refused with "This laptop was restored from a backup" so it cannot reuse receipt numbers already given to customers. Choose **Sync now**: the laptop downloads the cloud copy, adds the sales, refunds, stock movements and other records made after the backup, rebuilds stock and customer balances from those records, continues receipt numbering after the highest number on either side, and then sends anything waiting. Covered by `tests/sync/restore-reconcile.test.ts`.
5. No internet at the shop? The owner can choose **Continue offline** on the Sync page. Receipt and refund numbers then jump to the next block of 100,000 (for example R-100001), so they cannot collide with numbers issued after the backup. The jump is recorded in the audit history, and the catch-up still runs on the next successful sync.
6. In the dashboard, the laptop keeps its identity. If the old laptop was stolen, see the limitation below.

## No backup file? Rebuild from the cloud

1. Mansora deactivates the lost laptop and creates a new activation code.
2. On the new laptop's activation screen, tick "This laptop replaces a lost one and I have no backup file".
3. The laptop downloads every record the cloud holds for the business (products, stock, sales, credit, shifts, audit history), continues receipt numbering where it left off, and the person activating takes over the owner account with a new password.
4. Other staff cannot sign in until the owner gives them new passwords (Staff → edit → new password). Staff passwords are never stored in the cloud.

Anything that had not synced when the old laptop was lost is gone. Covered by `tests/sync/recovery.test.ts`.

## After restoring a backup when the old laptop was stolen

A restored backup carries the old laptop's identity. Mansora deactivates that identity (which stops the thief's copy syncing), creates a new activation code, and the owner enters it under Sync status → Repair tools → Re-link. Records are kept and syncing resumes.

## Changes the server refused

A change the server refuses (for example an audit entry from an older version that was larger than the sync limit) is shown as a sync error. The local records are intact. The owner chooses **Repair and resend** on the Sync page: the refused change is rebuilt from the same rows, any over-long audit detail is summarised with a fingerprint, it is split into events the server accepts, and it is sent again. Since the November 2026 hardening, every change is checked against the sync contract before it is saved, so new refusals should not occur.

## After the cloud database is rolled back

Sync status → Repair tools → "Send all records again" queues everything for re-sending. The server ignores what it already holds, so nothing is duplicated.

## Honest limitations

- **Automatic daily backups are optional and off by default.** The owner switches them on under Backup & recovery with a passphrase. They run while the app is open. The passphrase is not stored; a key derived from it is kept in the encrypted local database. The file name carries the information needed to reopen it with the passphrase, so automatic backup files must not be renamed.
- A scripted laptop-loss drill (`scripts/recovery/drill.ts`) was run on 16 November 2026 and passed: every figure matched the cloud copy and recovery took under one second of processing. See [rehearsal-2026-11-16.md](rehearsal-2026-11-16.md). **The witnessed rehearsals on a physical laptop and on Railway are still outstanding**; they are verified by automated tests. A witnessed rehearsal, with the measured recovery point and recovery time recorded here, is still required before a paying client relies on them.
- Rebuilding from the cloud does not bring back staff passwords, pending unsynced records, import history or local backup records.
- A forgotten backup passphrase cannot be recovered.
