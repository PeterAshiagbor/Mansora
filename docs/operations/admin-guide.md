# Mansora administrator guide

## Accounts

Administrator accounts are created from the server with `npm run api:create-admin`
(see production deployment). Passwords are at least 12 characters. Sessions last
12 hours. There is one administrator role in version one and no two-factor
authentication yet.

## Dashboard areas

| Area | Use |
| --- | --- |
| Overview | Counts of clients and plans, renewals due in 30 days, onboarding progress, live clients that have not synced in 48 hours or backed up in 7 days |
| Clients | Directory with status, plan, setup progress, laptop connectivity, last sync, unsynced count, app version |
| Client page | Onboarding checklist, health, activation codes, deactivating a laptop, plan, report access, cloud backups |
| Service plans | Name, amount, period, included support. Payments are recorded manually; nothing is collected automatically |
| Audit log | Every administrator action, including refused attempts to view client data |

## Viewing a client's reports

You cannot, unless the owner grants access on their laptop (Mansora access).
The grant has a purpose and an expiry and can be stopped by the owner. While it is
active, "View sales summary" works; each view is written to your audit log and to
a log the owner sees. Customer details are never included.

Do not ask owners for their password, and do not ask them to grant access for
longer than the task needs.

## Reading client health

- **Online / Offline**: whether the laptop contacted the server in the last 15 minutes. Offline is normal for a shop with poor internet.
- **Unsynced**: changes the laptop reported as waiting. Cloud summaries exclude them and say so.
- **Last backup**: latest backup the laptop reported or uploaded.

## Suspending an account

Setting a client to "suspended" shows a notice on their dashboard. It does not
stop sales or syncing. No enforcement exists until a policy is agreed (decision D-10).

## Deactivating a laptop

Use when a laptop is lost, stolen or replaced. The laptop can no longer sync.
It cannot be wiped remotely, and it keeps working offline for anyone who can
sign in to it.
