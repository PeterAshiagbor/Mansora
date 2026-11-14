# Off-site backups of the browser version (Google Cloud Storage)

Owner request, 14 November 2026: back up client information and everything on the software to Google, for now,
under **Priscilla@mansora-consulting.com**. Longer term this moves to a dedicated backup service; nothing below
needs to change for that except the bucket settings.

## What is copied, how often, and how it is protected

- **Everything needed to rebuild the service**: the PostgreSQL database (clients, billing, every shop's synced
  records), every shop's own encrypted store, the shop registry and the private keys.
- **Every 6 hours** (`SYSTEM_BACKUP_INTERVAL_HOURS`, 1 to 24). Each copy pauses new requests for a few seconds
  while it is taken; people see "try again in a moment" at most.
- **Encrypted before it leaves Railway** with `SYSTEM_BACKUP_ENCRYPTION_KEY` (AES-256-GCM). Google stores only
  unreadable data. **Without that key no copy can be opened**: keep it in Mansora's password manager as well as
  on Railway.
- **Checked every time**: the copy is downloaded again and decrypted before it counts as done. A failed upload is
  retried (15 minutes, then longer), with the same copy kept safely on the server until it succeeds.
- Railway logs say `System backup stored off-site and verified (…)` after each good copy, and
  `System backup failed; it will be retried` otherwise.

Limits: up to 16 MB of database records and 32 MB of shop files per copy (ample for the pilot). Past that the copy
fails loudly and the storage needs upgrading.

## One-time setup (about 20 minutes, signed in as Priscilla@mansora-consulting.com)

1. Open **console.cloud.google.com**. Accept the terms. Create a project named **mansora-backups**. Add billing
   (Cloud Storage for this size costs well under a dollar a month).
2. **Cloud Storage → Buckets → Create**:
   - Name: `mansora-system-backups` (or another unique name; note it).
   - Location: **Region**, `europe-west1` (Belgium) or `africa-south1` (Johannesburg).
   - Storage class: **Standard**. Access control: **Uniform**. **Prevent public access: on**.
   - Data protection: **Soft delete 7 days**. Leave object versioning off.
3. In the bucket → **Lifecycle** → Add rule: **Delete object** when **age is 90 days**. (Ninety days of copies are
   kept; older ones are removed.)
4. **IAM & Admin → Service accounts → Create**: name `mansora-backup-writer`. No project role.
5. Back in the bucket → **Permissions → Grant access**: principal `mansora-backup-writer@…`, roles
   **Storage Object Creator** and **Storage Object Viewer**. (It can add copies and read them back; it cannot
   delete or change them.)
6. **Cloud Storage → Settings → Interoperability → Create a key for a service account** →
   `mansora-backup-writer`. Google shows an **Access key** and a **Secret** once.
7. In **Railway → the Mansora service → Variables**, add (paste directly; never send these by chat or email):
   - `SYSTEM_BACKUP_S3_BUCKET` = the bucket name from step 2
   - `SYSTEM_BACKUP_S3_ACCESS_KEY_ID` = the Access key from step 6
   - `SYSTEM_BACKUP_S3_SECRET_ACCESS_KEY` = the Secret from step 6
   - `MANSORA_SYSTEM_BACKUPS` = `1`

   Already set (no change needed): `SYSTEM_BACKUP_S3_ENDPOINT` = `https://storage.googleapis.com`,
   `SYSTEM_BACKUP_S3_REGION` = `auto`, `SYSTEM_BACKUP_S3_SERVER_SIDE_ENCRYPTION` = `none` (Google encrypts
   stored data itself), `SYSTEM_BACKUP_INTERVAL_HOURS` = `6`, and `SYSTEM_BACKUP_ENCRYPTION_KEY`.
8. Copy the value of `SYSTEM_BACKUP_ENCRYPTION_KEY` from Railway into Mansora's password manager.
9. Railway redeploys. Within about 10 minutes the log shows `System backup stored off-site and verified`, and the
   bucket has a file under `system-snapshots/v1/<today>/`.

**Do not change `SYSTEM_BACKUP_ENCRYPTION_KEY` once backups exist**: the server refuses to start backups with a
different key, so old copies are never left unreadable by accident.

## Restoring (the server or its data is lost)

1. Create a **new, empty** PostgreSQL database and a new, empty volume (for example a new Railway service).
2. In the Google bucket, find the newest file under `system-snapshots/v1/` and note its name.
3. With the same `SYSTEM_BACKUP_*` settings and the encryption key from the password manager:

   ```
   RESTORE_DATABASE_URL=postgres://… RESTORE_DATA_DIR=/data \
   npx tsx scripts/recovery/restore.ts system-snapshots/v1/<date>/<id>.msbk
   ```

   It downloads the copy, verifies it, writes the shop stores, registry and keys, creates the database roles and
   tables, and loads every row in one transaction. It refuses a database or folder that is not empty.
4. Start the server on that database and volume as usual. Shops and staff sign in as before; administrators sign
   in again.
5. Anything done after the copy you restored (at most 6 hours) is not in it. Laptops that were offline still hold
   their own records and send them when they next sync.

**Monthly drill**: run the same command with `--check` at the end. It downloads and verifies the newest copy without
restoring anything. Record the date and result.

## Privacy

The copies hold the same personal and business data as the live service (see `docs/legal/data-inventory.md`),
encrypted, in the chosen Google region, for 90 days. Record the region and the 90-day retention in the data
processing records, and Google as a sub-processor (storage only: Google never has the key).
