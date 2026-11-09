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

## Recovery scenarios

| Scenario | Outcome | Evidence |
| --- | --- | --- |
| A. Internet lost | Keeps working | `tests/sync/sync.test.ts` (100 offline sales) |
| B. App closes unexpectedly | Committed transactions intact; no partial sale | `tests/sync/crash.test.ts` (process killed mid-sale) |
| C. Laptop restarts | Database and sync queue persist | TEST 04 |
| D. Cloud unavailable | Keeps working; retries with back-off | TEST 05 |
| E. Laptop lost | Restore latest `.mbk` on a new laptop | `tests/integration/engine.test.ts` (restore into a clean directory under a new key; totals, stock, logins and permissions reconcile) |
| F. Cloud data damaged | Restore managed PostgreSQL backup | **Not rehearsed — no production environment yet** |

## Restoring on a replacement laptop

1. Install the app. Do not activate.
2. Activation screen → "Restore from a backup instead" → passphrase → choose the `.mbk` file.
3. The app verifies the backup (decryption, SQLite integrity and foreign-key checks), restores it under the new laptop's own key and opens it. Staff sign in as before. Anything that was waiting to sync is sent.
4. In the dashboard, the laptop keeps its identity. If the old laptop was stolen, see the limitation below.

## No backup file? Rebuild from the cloud

1. Mansora deactivates the lost laptop and creates a new activation code.
2. On the new laptop's activation screen, tick "This laptop replaces a lost one and I have no backup file".
3. The laptop downloads every record the cloud holds for the business (products, stock, sales, credit, shifts, audit history), continues receipt numbering where it left off, and the person activating takes over the owner account with a new password.
4. Other staff cannot sign in until the owner gives them new passwords (Staff → edit → new password). Staff passwords are never stored in the cloud.

Anything that had not synced when the old laptop was lost is gone. Covered by `tests/sync/recovery.test.ts`.

## After restoring a backup when the old laptop was stolen

A restored backup carries the old laptop's identity. Mansora deactivates that identity (which stops the thief's copy syncing), creates a new activation code, and the owner enters it under Sync status → Repair tools → Re-link. Records are kept and syncing resumes.

## After the cloud database is rolled back

Sync status → Repair tools → "Send all records again" queues everything for re-sending. The server ignores what it already holds, so nothing is duplicated.

## Honest limitations

- **Automatic daily backups are optional and off by default.** The owner switches them on under Backup & recovery with a passphrase. They run while the app is open. The passphrase is not stored; a key derived from it is kept in the encrypted local database. The file name carries the information needed to reopen it with the passphrase, so automatic backup files must not be renamed.
- **None of these recovery paths has been rehearsed on physical laptops**; they are verified by automated tests.
- Rebuilding from the cloud does not bring back staff passwords, pending unsynced records, import history or local backup records.
- A forgotten backup passphrase cannot be recovered.
