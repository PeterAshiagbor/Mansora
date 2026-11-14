# Customer acquisition and onboarding: acceptance report

Spec: *Unified Customer Acquisition and Onboarding v1.0* (14 November 2026). Contract: `00-integration-contract.md`.
Status on 14 November 2026. "PASS (automated)" means proven by tests in CI on synthetic data; it is **not** live
acceptance with real email delivery or a real prospect. Live gates are listed separately.

| Area | Result | Evidence |
| --- | --- | --- |
| Website demo requests | PASS (automated); live pending | website#2: form, signed forward, retry-safe id, 4 tests; platform #86 signature, source, reference tests; cross-repo signature check |
| Administrator lead capture | PASS (automated) | `tests/security/leads.test.ts`, `tests/e2e/leads.test.ts` |
| Demo confirmation emails | PASS (automated); live pending | #87: queued with the lead in one transaction; content tests (reference, no promised time, no charge) |
| Internal alerts | PASS (automated); live pending | #87: team alert to `LEAD_ALERT_EMAIL` (set on Railway) |
| Follow-up suppression | PASS (automated) | #87/#88: held until due (23 h held, 25 h/49 h sent), skipped once contacted/qualified/closed, prospect opt-out |
| Lead-to-client conversion | PASS (automated) | #88: qualified only, explicit confirmation, duplicate stop, link-existing, 3-way race creates one client, draft-only subscription |
| Onboarding emails | PASS (automated); live pending | #88: exactly one per client, no secrets, survives email failure |
| Secure customer setup | PASS by reuse (unchanged) | Existing browser-workspace owner setup (owner chooses password; private, expiring, single-use links). No new auth system. |
| Business-type presets | PASS (automated) | PR-06: five versioned presets, categories only added if missing, idempotent, settings recommended not changed, auto on fresh activation only |
| Resend deliverability | **FAIL until configured** | PR-07 webhook built and tested; needs `RESEND_WEBHOOK_SECRET` + Resend webhook, verified sending domain on the app's Resend account, and a real inbox test |
| Existing workflow regressions | PASS (automated) | Full suite (480+ tests, browser tests included) and CI green on every PR |
| End-to-end staging journey (A22) | **Not yet run live** | Needs the items below, then one synthetic prospect from website to activated test workspace |

## Live gates (owner / operator)

1. Vercel: set `DEMO_INTAKE_SECRET` = the value on Railway (Railway → Variables). Then merge website#2.
2. Resend (app account): confirm the sending domain is verified (SPF/DKIM/DMARC), `RESEND_FROM_EMAIL` uses it and
   `RESEND_REPLY_TO` is the team inbox. Add a webhook to `https://app.mansora-consulting.com/api/v1/webhooks/resend`
   for delivered/bounced/complained/delayed and put its signing secret in Railway `RESEND_WEBHOOK_SECRET`.
3. Team-test mode emails only allow-listed addresses, so prospects' confirmations are held until the deployment
   leaves team-test mode (a go-live decision, Gate 5). Until then, test with an allow-listed address.
4. Run A22 with a synthetic prospect and record screenshots: website form → lead → emails received → contacted →
   qualified → converted → welcome email received → workspace prepared → owner sets password → test sale.

## Known limitations

- Customer replies arrive in the team inbox and are recorded by hand ("Email they sent"); inbox sync is out of scope.
- Presets add categories and guidance only; carton/unit and price levels are not features yet (C44/C45), so the
  wholesale preset does not claim them.
- Lead retention periods are proposals awaiting legal/owner decision (`docs/legal/retention-deletion.md`).

## Rollback

Each PR is additive (migrations 12–16 add columns/tables only). Revert the PR; the website PR reverts independently.
