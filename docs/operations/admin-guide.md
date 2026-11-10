# Mansora administrator guide

## Accounts

Administrator accounts are created from the server with `npm run api:create-admin`
(see production deployment). Passwords are at least 12 characters. Sessions last
12 hours. There is one administrator role in version one. Administrators can
enrol in two-factor authentication under **Account security**.

## Authenticator setup and sign-in

1. Open **Account security**, enter your current password, and choose **Set up authenticator**.
2. Add the displayed setup key to a trusted authenticator app (time-based, SHA-1, six digits, 30 seconds). The setup URI is also available. Treat both as secrets; do not share them or send them to a QR-code website.
3. Enter an authenticator code within ten minutes to enable protection. Until this confirmation succeeds, password sign-in is unchanged.
4. Save the ten recovery codes somewhere secure outside this browser. They are displayed once and each works once. Enabling protection signs out your other sessions.
5. On your next sign-in, enter your password, then an authenticator code or unused recovery code. Password verification alone does not grant access. The challenge expires after five minutes; starting a new password sign-in replaces the previous challenge.

Codes from the preceding/current/following 30-second step are accepted, but each accepted step must be newer than the last one used (including the enrolment code). If a code was just used, wait for the next code. Keep the server and authenticator clocks synchronized. Five failed factor checks in five minutes block further checks for that administrator until the window ends, across IP addresses and server restarts.

To disable or replace an authenticator, choose **Disable two-factor authentication** and enter your password plus a fresh authenticator code or an unused recovery code. All sessions, pending challenges and remaining recovery codes are invalidated. Sign in again and enrol a replacement if needed. Failed settings verification keeps the current session open so you can correct the input.

If you lose the authenticator, use a recovery code to sign in. You need another unused recovery code (or a fresh authenticator code) plus your password to disable the factor before replacing it. There is no password-only reset or support override. If all recovery codes are lost/used, follow your organization's approved identity-verification and database recovery procedure; the application does not invent an account-recovery policy.

Enrolment, enablement, disablement, failed verifications and recovery-code use appear in the audit log. Setup keys, entered codes and recovery-code plaintext do not appear there. The server must retain `ADMIN_TOTP_KEY` to decrypt enrolled secrets; a missing or wrong key blocks startup/login rather than bypassing the factor.

## Dashboard areas

| Area | Use |
| --- | --- |
| Overview | Counts of clients and plans, renewals due in 30 days, onboarding progress, live clients that have not synced in 48 hours or backed up in 7 days |
| Clients | Directory with status, plan, setup progress, laptop connectivity, last sync, unsynced count, app version |
| Client page | Onboarding checklist, health, activation codes, deactivating a laptop, plan, report access, cloud backups |
| Service plans | Name, amount, period, included support. Payments are recorded manually; nothing is collected automatically |
| Account security | Enrol an authenticator, view enabled state and remaining recovery-code count, or disable with reauthentication |
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

## Finding clients and reviewing changes

On **Clients**, search by business, owner, phone, email or support contact and combine it with the status filter (onboarding, active, suspended or closed). Matching is case-insensitive. Filters apply to the client list already returned by the server and do not change account status.

Open a client and choose **Client audit** to see that client's administrative history. The dashboard requests the existing admin audit endpoint with `tenantId`; filtering happens on the server. It shows the latest 300 entries, the endpoint's existing limit. Platform-wide plan changes and other clients' actions are not part of this view. Use **Client overview** to return to onboarding, health, subscriptions and consent-controlled reports.

Onboarding checkboxes show the chosen state while a request is pending, remain disabled during the save, and return to the server state if saving fails. The audit trail records both marking a step complete and unmarking it. Account and subscription status changes retain their existing meaning: they do not stop a shop selling offline.

**Deactivate laptop** opens an in-app dialog describing the offline/sync consequence. Cancel leaves the device active. Confirm revokes its cloud access and records the action; it does not erase the laptop's records or prevent offline sales. This uses the same existing API operation as before. An expired administrator session, or a device token supplied in its place, returns the dashboard to sign-in and removes the stored token.

C6 validation includes Chromium tests for plan/client create and edit, status and combined search filters, checking/unchecking onboarding, subscription assignment, activation code creation, cancellation and confirmation of deactivation, client-scoped audits, actual session expiry and rejection of a still-valid device token. All fixtures run on localhost; no production client data or devices are used.
