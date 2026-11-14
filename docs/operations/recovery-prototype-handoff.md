# C38 in-flight prototype handoff — 14 November 2026

Claude owns C38 following the owner's 13 November takeover. This draft preserves already-started work; it must not be merged or enabled independently of that owner. It is rebased onto default `71ea602` and changes no protected engine, device, sync or billing source.

## Implemented and locally verified

- `scripts/recovery/archive.ts`: versioned AES-256-GCM envelope, bounded decompression and manifest checks, private file checksums, path/symlink/overwrite protections and empty-destination extraction. The recovery root is separate from keys carried inside the archive.
- `postgres.ts`: repeatable-read/read-only source capture, raw JSON text to preserve financial integer precision, schema/migration/constraint/RLS/grant/index/PostgreSQL-major fingerprinting, and empty-target restoration. Cyclic subscription/mandate references are validated atomically before original foreign-key modes are restored. No constraint is disabled and no source data is modified.
- `files.ts`: encrypted native SQLite VACUUM copies plus private registry, journals, keys and legacy cloud-backup files. Explicit bounds: 32 MiB private files and 16 MiB database JSON, inside a 64 MiB plaintext envelope limit. Sources outside the configured private tree and symlinks are refused.
- Narrow gateway/background snapshot lock: finish existing requests and background sync/backup work; refuse new work briefly with a retry response; keep health available; always release after failure; wait for a snapshot before closing stores.
- Eight focused tests in four files pass on the current default base, plus TypeScript. The synthetic whole-schema/two-shop rehearsal reopens restored encrypted stores, authenticates owners, compares sales/stock/credit data, and syncs only to a separate test API/database. Source data is verified unchanged. The rehearsal uses embedded PostgreSQL and a separate local storage directory; it does not establish off-site or PostgreSQL 16 production recovery.

## Unfinished, do not represent as working

`manager.ts` is an unintegrated upload/retry prototype. It maps a dedicated system-backup S3 namespace into the existing C32 storage adapter so existing individual backup paths would stay unchanged. It journals immutable encrypted uploads and reads them back before cache removal. It still needs dedicated restart, ambiguous-upload, corruption, callback-failure and shutdown tests plus runtime review. No server starts this manager, and no new required environment setting is introduced by the draft.

The proposed privileged recovery-query boundary is operational backup code, not an administrator/report endpoint. Its authority and isolation must be explicitly reviewed against the board's database-access rules before connecting it to a live database. Review the empty-target guard, foreign-key deferral transaction and schema fingerprint against actual PostgreSQL 16. Never expose raw queries or recovery keys to browser commands.

Full regression/build/audit have not been run on this draft. Only the stated focused tests/typecheck are claimed. No new provider, bucket, key, backup schedule or live restore was configured. Hourly scheduling and retention/key-custody ideas are not owner-approved policy; use the current owner's provider/Pro decision and record it before enabling anything.

## Existing live evidence from the earlier work

The platform UI/gateway changes and the independent US East monitor were deployed successfully. The monitor is pinned to reviewed `685f2ea`; main release `48b95ec` passed seven workflows. The one labelled canary was accepted then bounced and the designated recipient was suppressed. Temporary canary settings were disabled; no suppression was removed or repeated test sent. A corrected working alert inbox is still needed privately. Provider acceptance is not delivery.
