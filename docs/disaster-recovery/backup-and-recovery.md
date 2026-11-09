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

## Honest limitations

- **Automatic scheduled backups are not built.** Backups are made by the owner pressing a button. Cloud sync is the automatic protection.
- **Rebuilding a laptop from cloud data is not built.** Without a `.mbk` file, a new laptop starts empty; history stays visible to Mansora (with consent) and can be exported, but is not loaded back.
- **A restored laptop reuses the old device identity.** If the old laptop was stolen and is deactivated, the restored one is deactivated too; re-keying a restored laptop to a new identity is not built. Until then, restore first and only deactivate if the stolen laptop is a real risk, then contact the developer.
- **Restore has been verified by automated test, not on a physical replacement laptop.**
- **Cloud restore loses acknowledgements.** If the cloud database is rolled back, events the laptops already marked as synced after the restore point are not re-sent. A "re-send everything since" tool is needed and is not built. The data remains on the laptops.
- A forgotten passphrase cannot be recovered.
