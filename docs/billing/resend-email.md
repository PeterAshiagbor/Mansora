# Resend reminders, communications and platform alerts

The owner selected Resend on 11 November 2026. Billing invoices, receipts,
collection reminders and failure messages already use the durable notification
queue; the Resend adapter now delivers that queue. Administrators can also write
individual service messages under **Collections → Messages**, process the queue,
and retry a failed email. Composition resolves the saved billing contact rather
than allowing arbitrary recipient addresses. No marketing/bulk campaign system
or newsletter consent is inferred.

## Configuration

Set these private server variables, never frontend values or committed secrets:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | A sending-capable Resend key for the verified domain |
| `RESEND_FROM_EMAIL` | Verified sender, e.g. `Mansora <notifications@mansora-consulting.com>` |
| `RESEND_REPLY_TO` | Support/reply inbox |
| `PLATFORM_ALERT_EMAIL` | Operator inbox for sanitized API exception alerts |
| `RESEND_ALLOWED_RECIPIENTS` | Optional production restriction; mandatory comma-separated allowlist in team-test mode |

The owner supplied a Gmail inbox privately as the reply-to/alert destination.
That inbox is not an authenticated From domain. Existing
Resend DNS records are evidence of DNS setup, not evidence that the accessible
Resend account is verified or that a valid API key has been installed. Verify the
sender domain in Resend before enabling. No API key was available during the
initial implementation; live provider delivery is not claimed by passing tests.

## Delivery semantics

The API worker polls each minute. Billing's existing scheduled job also drains
the queue. Each worker leases at most ten due messages in a committed database
transaction before network I/O. Concurrent workers skip leased rows. A crash
leaves a fifteen-minute lease, after which the same notification ID is retried
with the same Resend idempotency key. Temporary network/rate/server failures
back off for 2, 4, 8, 16 minutes up to five attempts; permanent failures stop.
Failures store bounded, generic error descriptions, not provider response bodies
or message contents. Migration 5 only extends platform notifications; released
migrations, tenant business data and payment policies are unchanged.

Resend retains idempotency protection for 24 hours. After 23 hours from the first
attempt, an ambiguous send stops for provider reconciliation. Inspect it in
Resend before explicitly creating a replacement. Do not automatically clear
that protection to make a failed row disappear. “Sent” records Resend acceptance
and the provider message ID. It is not proof of inbox delivery, opening or
reading. Bounce/delivery webhooks and marketing subscriptions are not implemented.

API 500 alerts include only request ID, method, route template, status and safe
error type/code; no raw exception text/stack, request body, query, token or client
identity is emailed. Repeated identical route errors are suppressed for five
minutes per process, bounded at 1,000 keys and eight pending callbacks. This is
API exception notification, not independent uptime monitoring: crashes before
startup and complete host/database outages still require Railway monitoring.

## Verification

Automated tests exercise the HTTPS request contract, stable keys, allowlist,
transport/provider failures, concurrent workers, retry timing/expiry, admin
authorization, contact resolution, duplicate submissions and error redaction.
Use a designated test inbox for first live verification. Confirm the message ID
in Resend, actual inbox receipt, Reply-To, reminders and failure recovery before
removing any production recipient restriction. Never use real customer addresses
for a deployment smoke test.
