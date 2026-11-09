# Architecture

```
SHOP LAPTOP (Windows)                              MANSORA CLOUD
┌───────────────────────────────────────┐          ┌──────────────────────────────────────┐
│ Electron                              │          │ Fastify API (modular monolith)       │
│  renderer: React UI  (sandboxed,      │          │  /v1/devices  activation             │
│            no Node, CSP)              │          │  /v1/sync     idempotent ingest      │
│      │ window.mansora.invoke(cmd)     │  HTTPS   │  /v1/admin    clients, plans, audit  │
│  main: command engine ───────────────┼─────────▶│  /v1/backups  encrypted blobs        │
│      │   auth · permissions · rules   │          │                                      │
│  SQLite (SQLCipher, WAL)              │          │ PostgreSQL 16                        │
│   business tables + outbox            │          │  platform plane │ tenant plane (RLS) │
└───────────────────────────────────────┘          └──────────────────────────────────────┘
                                                              ▲
                                                   Admin dashboard (React)
```

## The laptop is the system of record

Every operation goes through one entry point, `Engine.execute(session, command,
input)` in `apps/desktop/src/core/engine.ts`. It:

1. resolves the session (and locks it after inactivity);
2. checks the command's permission against the signed-in user;
3. validates the input with a schema;
4. runs the handler inside **one SQLite transaction**, together with the audit
   entry and the sync outbox event.

The user interface cannot bypass this: in Electron it only has
`window.mansora.invoke`, and session tokens never leave the main process. Hiding
a button is a convenience; the refusal happens in the engine (and is audited as
`permission.denied`).

### Completing a sale

`sale.complete` writes the sale, its lines (with price and cost snapshots),
payments, stock movements, stock balances, any credit account, the receipt
number, the audit entry and the outbox event, then commits. If anything fails —
including the process being killed — none of it exists
(`tests/sync/crash.test.ts`). Printing happens after the commit; a failed print
never affects the sale and the receipt can be reprinted.

The checkout screen creates the sale's ID once per basket, so pressing "Complete"
twice, or retrying after an error, cannot create a second sale.

### Records that cannot be changed

Sales, sale lines, payments, refunds, repayments, expenses, stock movements and
audit entries are insert-only. SQLite triggers reject `UPDATE` and `DELETE` on
those tables even from direct SQL. Corrections are new records: a refund
references its sale; a stock correction is a new movement.

Stock quantity is never edited. `moveStock()` appends a movement and updates the
balance in the same transaction, so balance = sum of movements at all times (a
test asserts this on both laptop and cloud).

## Sync

Protocol v1 is defined in `packages/domain/src/sync.ts`.

- Each committed command produces one outbox event containing the rows it
  touched. Tables are either **insert** (immutable facts) or **upsert**
  (current state such as products and balances).
- The laptop sends pending events in order. The server stores each event under
  the unique key `(tenant_id, event_id)` and applies its rows in the same
  transaction. An event it has already stored is acknowledged and **not**
  re-applied.
- Upserts carry a version or timestamp guard, so an older copy of a row can never
  overwrite a newer one, whatever order requests arrive in.
- The laptop marks an event synced only after the server's acknowledgement. A
  lost acknowledgement means the event is sent again and ignored by the server.
- Validation failures are rejected permanently and surfaced on the Sync status
  screen; unexpected server errors are not acknowledged, so the laptop retries.
- The tenant is taken from the device's token, never from the payload. A device
  cannot write outside its own business even with forged row IDs.

Version one supports one checkout laptop per store (the API refuses a second
active device), which is what makes "the laptop is authoritative" safe. Multiple
devices are a version 2 change to this protocol, not a patch.

After pushing, the laptop pulls account status and the log of Mansora staff who
viewed its data.

## Tenant isolation

PostgreSQL enforces two planes with two roles (`apps/api/src/migrations`):

| Plane | Role | Contains |
| --- | --- | --- |
| Platform | `mansora_platform` | clients, plans, devices, admin accounts, admin audit |
| Tenant | `mansora_tenant` | every business table, with forced row-level security on `tenant_id` |

All database access goes through `db.platform(fn)` or `db.tenant(tenantId, fn)`.
Admin code runs in the platform plane and has **no privileges** on business
tables. The only admin path into a tenant is the report endpoint, which first
finds an unexpired, unrevoked grant created by that business's owner, and records
the view where the owner can see it.

## Security summary

| Area | Implementation |
| --- | --- |
| Local data at rest | SQLCipher (AES-256, per-page HMAC); random key held by Windows DPAPI via Electron `safeStorage` |
| Passwords | scrypt (N=2^15), verified on the laptop so login works offline; 5 failures lock the account for a minute |
| Sessions | Random token kept in the Electron main process; auto-lock after configurable inactivity |
| Electron | `sandbox`, `contextIsolation`, no Node integration, CSP, navigation and pop-ups blocked, IPC sender checked |
| Device identity | One-time activation code (hashed, expiring); device token stored hashed on the server |
| Admin sessions | 12-hour bearer tokens stored hashed; login rate-limited; all actions audited |
| Backups | Re-encrypted under an owner passphrase; the cloud stores them but cannot read them |
| Transport | HTTPS required for activation except against localhost |

### Known security limitations

- **Delayed revocation.** A disabled staff member is locked out immediately on
  the laptop. A device deactivated by Mansora keeps working offline until it next
  tries to sync; it can still sell but can no longer sync.
- **Staff passwords are not stored in the cloud.** After total loss without a
  backup, logins must be re-created.
- The dev host and demo stack are development tools and are not hardened.
- No external penetration test has been done.

## Time and currency

Money is integer pesewas everywhere; there is no floating-point money arithmetic.
Quantities are whole units in v1. Timestamps are UTC, which equals Ghana local
time all year; day boundaries in reports rely on this (decision D-09).
