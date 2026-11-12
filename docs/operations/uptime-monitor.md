# Independent platform availability monitor (C38 part 1)

The monitor is a separate, small Node service with no retail volume, database connection, platform session or encryption key. It probes the fixed public HTTPS `/healthz` address every minute, with redirects refused, normal TLS verification, a ten-second timeout and a 4 KiB response cap. Readiness requires HTTP 200 and the expected JSON contract.

After three consecutive failures it sends a sanitized Resend alert to the configured `PLATFORM_ALERT_EMAIL`. Continued outages produce at most one accepted reminder per thirty-minute window. A recovery message follows a successful probe. Bodies and idempotency keys are stable within each window, including across process recreation. Temporary delivery failures retry on subsequent checks, at most three attempts per window; permanent failures stop for that window. Logs contain fixed event categories, never response bodies, credentials or customer data.

The monitor's own `/healthz` describes whether its probe loop is running; it remains healthy when the target is down. There is no public alert-triggering endpoint. Incident state is deliberately small and in memory; Resend idempotency bounds duplicates across restarts. A restart needs three new failed probes and may not send a recovery notification for an incident it did not observe. This is availability alerting, not a durable incident-history system.

## Deployment configuration

Use the existing Railway project and a separate single-replica service, built from `infrastructure/monitor/Dockerfile`. Prefer the documented US East Metal region `us-east4-eqdc4a`, separate from the app's US West deployment. Bound it to 0.1 vCPU / 0.25 GiB, with sleeping disabled and self-health path `/healthz`. It uses no volume and needs no public domain. Pin deployment to the reviewed commit after all CI checks pass; future monitor updates require reviewing and updating that pin. No platform/database service setting needs changing.

| Variable | Value/source |
| --- | --- |
| `PORT` | `8080` |
| `MANSORA_MONITOR_URL` | `https://app.mansora-consulting.com/healthz` |
| `PLATFORM_ALERT_EMAIL` | `${{Mansora.PLATFORM_ALERT_EMAIL}}` |
| `RESEND_API_KEY` | `${{Mansora.RESEND_API_KEY}}` |
| `RESEND_FROM_EMAIL` | `${{Mansora.RESEND_FROM_EMAIL}}` |
| `RESEND_REPLY_TO` | `${{Mansora.RESEND_REPLY_TO}}` |

These are private Railway references, not copied/read-back credential values. The adapter allows only the designated alert recipient. Do not copy database, owner/test passwords, operator credentials or volume keys into the monitor. A separate Railway region reduces app/region coupling; a Railway-wide control-plane/account failure remains a shared dependency. Independent-provider monitoring remains a future improvement.

For one authorized delivery rehearsal, set a stable nonsecret `MANSORA_MONITOR_CANARY_ID` and an ISO `MANSORA_MONITOR_CANARY_UNTIL` no more than thirty minutes ahead. The explicit subject says **monitoring test — no platform outage**. Repeated attempts inside that short window use the same idempotency key. After expiry no canary is sent, including after later restarts. Remove the canary variables after verifying provider delivery. Never manufacture a real outage or reset a shop password for this drill.

## Evidence

Five tests verify failure thresholds, reminder/recovery behavior, stable provider identity/body across recreation, bounded temporary/permanent retries, response-content redaction, serialized probes, oversized responses, configuration checks, canary labeling and the actual monitor HTTP health while the target is down.

`bash scripts/monitor/container-smoke.sh IMAGE` runs the built non-root image against a synthetic HTTPS service on an internal Docker network without Internet egress. It verifies certificate trust, the real probe and self-health without a database, retail volume or real email. The separate **Independent uptime monitor** workflow runs this image acceptance.

Local focused tests, typecheck, bundled build and the isolated Docker smoke pass. Live service creation, regional placement, successful deployment and an observed canary delivery must be recorded separately after deployment; provider acceptance alone does not establish inbox delivery.

## Remaining C38 scope

The live inventory on 12 November found one app replica with 1 GiB `/data` and a separate 5 GiB PostgreSQL volume in sfo; no application `BACKUP_S3_*` destination, bucket or Railway alert webhook. Snapshot schedules are not exposed by this inventory and were not verified.

This monitor does not complete off-site recovery. C38 still requires a protected remote destination and retention policy, consistent PostgreSQL plus encrypted-store/registry/private-key capture, independent key custody, and a rehearsed restore into an isolated destination with authentication, balances, stock, tenant isolation and sync continuity. Do not mark C38 complete from a green restart, the existing same-volume backups or this monitor alone.
