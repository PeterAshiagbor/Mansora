# API backup storage

The API stores bytes already encrypted by the client's backup passphrase. Storage
selection does not change device authentication, tenant isolation, the backup ID
rules, database metadata or the client's SHA-256 integrity check. The API cannot
establish from a checksum alone that a client encrypted its bytes.

## Drivers and configuration

`BackupStorage` exposes asynchronous `put(key, bytes, sha256)`, `get(key)` and
`exists(key)`. Keys are relative paths, never public download URLs. Both drivers
refuse to replace an existing key with different contents. An identical retry
succeeds without replacing the object. Invalid checksums are rejected before
writing, and traversal/absolute paths are rejected. Historical Windows separators
are normalized to `/`.

With no S3 configuration, the server uses `FileStorage` at `BACKUP_DIR` (default
`./data/backups`). It writes private temporary files and atomically publishes
complete files with a hard link that cannot replace an existing path. Existing
local backups and the existing backup tests continue to use this driver.

For S3-compatible storage, supply all five values to the API process:

| Variable | Value |
| --- | --- |
| `BACKUP_S3_ENDPOINT` | HTTPS service endpoint, for example the provider's regional S3 endpoint. Optional path prefixes are supported. No credentials, query string or fragment in the URL |
| `BACKUP_S3_REGION` | The region used by the provider's SigV4 verifier |
| `BACKUP_S3_BUCKET` | An existing private bucket; the API does not create buckets |
| `BACKUP_S3_ACCESS_KEY_ID` | Runtime credential identifier, from a secret manager |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Runtime signing secret, from a secret manager |
| `BACKUP_S3_SERVER_SIDE_ENCRYPTION` | Optional; defaults to `AES256` (SSE-S3). `none` is an explicit opt-out for compatible services that do not implement SSE-S3 |

Partial configuration fails startup, so a missing S3 credential cannot silently
switch production to local disk. `BACKUP_DIR` is unused when S3 is selected.
HTTP is accepted only for loopback development/test endpoints. This driver uses
path-style addressing (`endpoint/bucket/key`), SigV4 with service `s3`, and static
access-key credentials. It does not implement STS session tokens, IAM-role
credential discovery, multipart uploads or automatic backend failover.

Every PUT includes `If-None-Match: *`, the content hash, SHA-256 metadata and the
encryption header unless explicitly disabled. A precondition failure causes a
signed GET and checksum comparison: only identical existing bytes count as a
safe retry. Existing objects are never overwritten. GET and HEAD are also signed;
redirects are rejected to avoid forwarding signed credentials to another host.
Requests and body reads have a 30-second timeout. Uploads and S3 downloads are
bounded to 200 MiB, matching the backup upload route. Storage errors expose safe
messages rather than provider response bodies or credential-bearing requests.

## Bucket and credential settings

- Keep the bucket private. On AWS, enable all Block Public Access settings and
  bucket-owner-enforced object ownership; do not configure public ACLs, anonymous
  reads or public website hosting. The driver does not set ACLs or public URLs.
- Use TLS and enable default bucket encryption as well as the request's explicit
  SSE-S3 header. If disabling the header for another provider, verify equivalent
  at-rest protection and document that provider's configuration.
- Enable bucket versioning and keep independent backups of the PostgreSQL metadata.
  Restrict the runtime identity to the backup bucket: `s3:PutObject` and
  `s3:GetObject` for the relevant object namespace, plus scoped `s3:ListBucket`
  where needed for HEAD to distinguish a missing key (404) from forbidden access
  (403). Do not give the runtime credential DeleteObject, bucket-administration
  or public-access-policy permissions. Consider a bucket policy requiring
  conditional writes. Versioning alone does not prevent an administrator deleting
  an object or creating a delete marker.
- Choose lifecycle retention with Mansora's privacy/retention policy, not an
  arbitrary software default. Coordinate current/noncurrent-version expiry with
  backup metadata and restore requirements. A lifecycle rule that deletes a file
  while the database still advertises it produces a missing backup, not a fallback
  to a different backend. Configure incomplete-multipart cleanup if other tools
  upload multipart data. The driver itself uses single-part PUT.
- Rotate the runtime credential through the secret manager, restart API instances,
  and verify access. Never put credentials in the dashboard configuration,
  repository, endpoint URL or support messages.

## Moving from local files to S3

Changing configuration selects a driver; it does not copy existing files. Before
cutover, back up the database and local directory, copy every retained file to the
same relative key in the private bucket with conditional writes, and verify its
SHA-256 against `backup_records.sha256`. Preserve existing keys, including legacy
keys, and normalize Windows separators consistently. Set `sha256` object metadata
to the verified hex digest where supported. Keep the previous store intact until
a restore rehearsal succeeds. Then configure all API replicas to use the same
bucket and region and verify upload/download through an authorized test device.
Do not switch some replicas while others still write to local disk.

Switching back similarly requires the retained objects to exist in the selected
filesystem. There is no implicit fallback, replication, retention job or orphan
cleanup in this interface. Files/objects and metadata cannot commit in a single
transaction; a database failure after PUT can leave an orphan for a separately
reviewed cleanup job. Authenticated upload concurrency and tenant storage quotas
remain operational controls.

## Verification and limits

`tests/storage/backup-storage.test.ts` runs both drivers through a shared storage
contract and uses an in-process fake S3 HTTP server that independently verifies
SigV4 against the received method, path, headers and payload hash. It covers
encoded paths, all three methods, conditional retries/conflicts, concurrent writes,
SSE defaults, missing objects, bad signatures, corruption, provider errors,
redirect rejection, timeouts and the authenticated API backup routes with two
tenants. The existing filesystem backup tests are unchanged.

This verifies the local protocol and application behavior. No real merchant/cloud
bucket or physical-laptop recovery was configured or tested for this task. Run a
provider-specific upload/download and recovery rehearsal before production use.
