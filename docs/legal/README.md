# DRAFT — not legal advice — for review by a Ghanaian data-protection lawyer

## C8 review pack

**Status:** Engineering drafts prepared for review; no legal approval, hosting choice, retention policy, registration conclusion or deletion capability is implemented by these documents. These files are the C8 task's documentation/status record; its scope is limited to `docs/legal/`.

- [Data inventory](data-inventory.md), with [machine-readable purposes/locations/access](data-inventory.json), lists every migrated laptop/cloud column, including technical fields, rather than guessing which fields a future lawyer will classify as personal.
- [Customer privacy notice template](privacy-notice.md) needs the shop's details and approved practices before display.
- [Controller/processor agreement outline](controller-processor-outline.md) contains role, instruction, security, subprocessor, rights, incident and exit questions.
- [Retention/deletion proposal](retention-deletion.md) asks a decision for each table and explains immutability, foreign-key, offline sync, replay and backup consequences.
- [Ghana legal/transfer checklist](ghana-review-checklist.md) gathers Act 843 registration, rights, hosting, cross-border and operational questions.

### Schema coverage check

From the repository root, after installing the normal development dependencies:

```sh
npx tsx --test docs/legal/inventory.test.ts
```

The test migrates fresh in-memory SQLite and embedded PostgreSQL databases, reads **schema metadata only** (PostgreSQL catalog access goes through `db.platform()`), and checks every actual column against the inventory and human-readable list. It also verifies every sync-contract field exists on both sides and every table has a retention proposal. No production connection, client records or credentials are read. The helper never changes application migrations or the sync protocol.

This standalone documentation test lives under `docs/legal/` to respect C8's scope. The existing `npm test` glob does not automatically include it; run the command explicitly during release/schema review or add it to an approved future CI change. A new table/column missing from the inventory fails the check. Review new fields individually for purpose, access, copies and legal questions; do not blindly regenerate the inventory to silence a failure. This gate detects schema coverage, not legal completeness, dynamic JSON keys or actual deployment settings.

The schema snapshot is based on default-branch `348d95c` (laptop migration 1; cloud migrations 1–3). Runtime options in separate container/storage/observability PRs require deployment review even when they add no database columns. The current pack inventories 522 columns across 65 source/table entries. Future schema changes must update these counts and entries deliberately after review.

### Decisions still required

Which entity is controller or processor for each purpose, what legal grounds and periods apply, which host/region/subprocessors will be used, who holds/rotates/retires keys, how privileged access is governed, and how rights/incidents/exits are handled remain open questions. No default period or country was assumed. Financial/audit immutability and historical sync/backup copies make direct SQL deletion unsafe; the pack describes the missing engineering work without claiming it is already done.
