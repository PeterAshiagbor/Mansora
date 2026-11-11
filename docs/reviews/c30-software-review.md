# C30 comprehensive software review — 2026-11-11

**Result:** the reviewed team-test application passes its existing regression and live acceptance checks, but four confirmed findings remain. Resolve F01 before relying on the provider revenue breakdowns for financial decisions. This review changes no application behaviour, account credential, provider setting or live financial record.

Reviewed application: `fcb488d86bd05923cb03afaab09957dd9971cd23` (C29 included), with documentation-only claim `7c7a977d43ec0c88425fa9ea488c8d6440d2c528`. Later concurrent invitation-diagnostics work is outside this snapshot.

PR cleanup: #24 (`8d3a505`) and #25 (`41efbc4`) are both ancestors of the default branch through merge `769981d`. Both were closed as already integrated; no source changes were discarded.

## Findings, highest priority first

### F01 — P1: later-period refunds change the wrong revenue breakdown period

**Confirmed with real API/embedded PostgreSQL, synthetic local records.** In `apps/api/src/billing/reports.ts:41`, the client breakdown filters payments by receipt date but sums each payment's lifetime `amount_refunded`. At line 44 the service breakdown similarly subtracts lifetime allocation refunds from payments received in the selected period. The headline correctly filters completed refunds by their own creation date. Consequently these sections disagree even for a fully allocated single-service payment.

| Scenario: GHS 100 received in November, GHS 20 refunded in December | November | December |
| --- | ---: | ---: |
| Headline net cash | 100 | -20 |
| Headline refunds | 0 | 20 |
| Client-table refunds | **20** | **0** |
| Service cash collected | **80** | **0** |

The affected breakdowns are displayed in the provider Revenue reports screen (`apps/admin-web/src/billing.tsx:140`). Historical service figures change when a later refund occurs, while the refund-only period omits the corresponding client/service activity. No ledger mutation or lost payment was demonstrated; this is a reporting attribution defect.

**Correction:** aggregate receipts and completed refunds independently within the requested interval. Include refund-only clients/services. Preserve the existing unallocated-payment treatment explicitly rather than forcing service totals to match when money is genuinely unallocated. Allocate refunds using the existing recorded allocation history. Do not revise invoice balances or refund accounting to conceal the reporting difference.

**Acceptance:** cross-month and cross-year receipt/refund cases; refund-only periods; full/partial refunds; multiple invoice services; sandbox exclusion; unallocated cash. The example above must reconcile in both periods. **Owner:** Claude billing code, coordinated before editing protected files.

### F02 — P2: invalid report dates become HTTP 500; reversed ranges succeed

**Confirmed with authenticated local API calls.** The date schema in `apps/api/src/billing/routes.ts:16` checks only shape. `/v1/admin/billing/reports/summary?from=2026-99-01&to=2026-99-30` returns HTTP 500 `INTERNAL_ERROR`. `from=2026-12-31&to=2026-12-01` returns HTTP 200 and a zero cash result. A bad reporting request looks like an infrastructure failure or a valid empty period.

**Correction:** validate actual Gregorian dates and `from <= to` before running database queries. Apply the same contract to related report/export routes; the support-report schema in `apps/api/src/modules/admin.ts:22` is also shape-only, although its invalid-date route was not separately exercised here.

**Acceptance:** leap days, impossible month/day, missing dates, reverse order, valid one-day reports; invalid inputs return a clear 400 without financial writes or unexpected-error alerts. **Owner:** Claude billing routes; Codex admin boundary work after coordination.

### F03 — P2: Railway omits the API's operational telemetry wiring

**Confirmed by entrypoint inspection, not a simulated production incident.** `scripts/railway/server.ts:36` passes `logger: false` and omits `metricsToken` and `errorWebhookUrl`. By comparison `apps/api/src/server.ts:20` enables structured logs and passes the two environment settings. `installObservability` reads options, not those environment variables directly. Setting `METRICS_TOKEN` or `ERROR_WEBHOOK_URL` on Railway therefore does not enable those documented API features; metrics remains disabled and the error webhook is unused. The gateway itself also has no equivalent structured request log. The separately wired email-alert path is not claimed broken.

**Correction:** share reviewed API runtime-option construction, enable the existing sanitized logger, and wire optional metrics/webhook settings without exposing secrets or accepting arbitrary forwarded identity headers. Keep team-test recipients/provider restrictions intact.

**Acceptance:** exercise the Railway composition, not only `buildApp`: configured metrics is authenticated, absent metrics stays 404, a local fake webhook receives sanitized error context, logs omit bodies/passwords/tokens, and startup fails clearly on invalid configuration. **Owner:** Codex infrastructure, coordinate `server.ts` with the active C29 session.

### F04 — P2: Railway silently ignores remote-backup configuration

**Confirmed by entrypoint inspection.** The same Railway `buildApp` call supplies only `/data/cloud-backups`; it does not call `backupStorageFromEnv`. The default `buildApp` consequently creates `FileStorage`. The standard API entrypoint does select the S3 adapter and rejects incomplete S3 settings (`apps/api/src/storage.ts:165`). Supplying those settings to Railway leaves backups local and bypasses that fail-closed configuration check.

The retail stores, secrets and gateway-uploaded backup files then share the web service's `/data` failure domain. Provider volume snapshots may mitigate this, but their schedule/retention and a full restore drill were not verified in this review. A successful restart is not evidence of recovery after volume/key loss.

**Correction:** reuse the existing storage factory with an explicit local fallback under `/data`. Verify an independent protected backup destination and key retention before introducing client production data. Do not rotate keys, delete snapshots or choose a retention policy implicitly.

**Acceptance:** Railway composition selects S3 when fully configured, rejects partial settings, preserves local fallback when unset, maintains encrypted-backup checksum/immutability and tenant checks, and passes an isolated recovery exercise. **Owner:** Codex infrastructure, coordinate the Railway entrypoint with C29.

## Evidence and coverage

| Area | Review evidence | Result / limit |
| --- | --- | --- |
| Build and dependencies | Latest application typecheck, all builds, full dependency audit | Pass; zero reported vulnerabilities |
| Existing automated suite | Real engine/API, embedded PostgreSQL, browser, security, billing, invitation, import, backup, sync/recovery and accessibility tests | **288/288 tests, 42/42 files; no skips** |
| CI | All six workflows on exact claim commit `7c7a977` | Green, including real PostgreSQL sync, API/staging/Railway container acceptance and unsigned Windows packaged-app smoke |
| Live transport and authentication | 10 actual HTTPS/API checks on `app.mansora-consulting.com` | Health/headers, assigned owner emails, Secure/HttpOnly/SameSite cookies, independent cashier session, existing persisted records, cashier cost/write restrictions, cross-business/cookie isolation, real Excel template/preview, billing read, operator API, logout isolation pass |
| Live user workflows | Chromium, both assigned client owners | Dashboard refresh, 15 client pages each, report chooser/tabs, 390px phone drawer/escape/overflow, help and sign-out pass |
| Live operator workflows | Chromium operator sign-in, 10 administration pages, logout | Pass; no uncaught browser exception or HTTP 5xx in this walkthrough |
| Financial review probe | Real invoice, manual receipt and later refund in disposable local fixture | F01 and F02 reproduced; no provider request or email sent |
| Trust boundaries | Engine permission dispatch, PostgreSQL role/RLS access, webhook signatures/idempotency, gateway origin/body/import limits, Electron sandbox/preload/navigation | Inspected with corresponding regression tests passing; no new bypass reproduced |
| Operational integration | Standard API versus Railway composition | F03/F04 confirmed; no production fault injection performed |

The live checks read existing business records and generate an import **preview**, not a committed import. The only financial writes in the additional review probe are disposable local synthetic records. Existing automated tests perform actual transactional writes and recovery scenarios locally. Green regression tests did not cover the later-period refund case; they do not cancel the confirmed finding.

## Reproduce F01/F02

From the repository root:

```bash
npx tsx docs/reviews/c30/reproduce.ts
```

The script creates a localhost API and disposable embedded PostgreSQL, uses the real invoice/payment/refund routes and closes the fixture. No live URL, key or real recipient is used. [Recorded output](c30/observed.json) contains only synthetic amounts/statuses. This is an audit probe reporting observed discrepancies, not a replacement for desired-behaviour regression tests when fixing them.

## Follow-up checklist

- [ ] Fix F01's reporting attribution before relying on provider revenue breakdowns.
- [ ] Add actual-date/range validation and negative-case coverage for F02.
- [ ] Wire and verify Railway telemetry (F03) and backup storage (F04), coordinating active entrypoint ownership.
- [ ] Confirm provider backup schedules, protected key retention, disk-capacity alerts and a full isolated restore drill. Automatic retail backups are opt-in, run daily when due, and retain snapshots; the 1 GB web volume needs an explicit capacity/retention plan.
- [ ] Address existing measured report/sync latency in [performance review](../operations/performance.md). Prior baseline annual sales p95 is about 9.15 seconds and annual profit p95 about 2.76 seconds on the documented large fixture; these were not re-benchmarked or represented as new measurements here.
- [ ] Complete the independently tracked provider, email-delivery, policy/legal, physical printer/scanner/cash-drawer, signing and Windows-hardware recovery acceptance. Invitation provider acceptance and actual inbox receipt are separate checks; this review sends no messages.

Keep F01/F02 financial corrections in the billing owner's scope. C30 is a review/evidence change, not a claim that the four findings have been fixed or that external production gates are complete.
