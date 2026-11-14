# Customer acquisition and onboarding: discovery and integration contract (PR-00)

Specification: *Mansora — Unified Customer Acquisition and Onboarding, v1.0, 14 November 2026* (owner preferences
approved; owner said "go on the acquisition spec" the same day). This document is PR-00: inventory, contracts, data
model, security design, prerequisites and test baseline. **It changes no behaviour.** Work packages follow as
PR-01 to PR-07, each small and reviewed on its own.

## 1. What exists today (inspected 14 November 2026)

### Application (`PeterAshiagbor/Mansora`, default branch at `910f07f`)

| Area | Where | State |
| --- | --- | --- |
| Public demo intake | `apps/api/src/modules/leads.ts` `POST /v1/public/demo-requests` (gateway path `/api/v1/public/demo-requests`) | Validates name, business, email, phone, message, consent; honeypot `website`; optional client `id` (uuid) with `ON CONFLICT (id) DO NOTHING`; JSON 202 or HTML 303. Rate limits per process: 30/hour per IP, 3/day per email hash. **Sends no email. No reference number. No source.** |
| Lead table | migration 6 `demo_requests` | id, name, business, email, phone, message, status (`new`/`contacted`/`qualified`/`closed`), consent_at, created_at, updated_at. Platform plane only (`mansora_platform`). |
| Admin Leads | `apps/admin-web/src/leads.tsx` (13 lines) + `GET/PUT /v1/admin/leads` | List with status filter; status change audited (`lead.status_updated`). No detail view, notes, assignment, follow-up dates or conversion. |
| Clients | `apps/api/src/modules/admin.ts` | Manual client creation (`tenants`, `business_type` default `retail`), twelve-step `onboarding_steps`, activation codes. |
| Browser workspaces | `apps/api/src/browser-workspaces.ts`, `docs/operations/browser-workspaces.md` | Administrator prepares a tenant-bound, expiring, single-use owner link; owner chooses the password; capacity and approval rules. |
| Email | `apps/api/src/email.ts` (Resend), `apps/api/src/brand.ts` (`brandEmailHtml`), `billing/core.ts` (`queueEmail`, `deliverQueued`) | Durable `notifications` queue: lease before send, Resend idempotency key, retries with back-off, statuses `queued`/`sent`/`failed`/`skipped`. `sent` today means **accepted by Resend**, not delivered. Recipient allow-list `RESEND_ALLOWED_RECIPIENTS` in team-test mode. |
| Pricing | `docs/billing/pricing.md` | Starter/Business/Plus, yearly, setup fee waiver, pilot price (live since #83). A converted client gets a **draft** subscription only. |

### Corporate website (`priscillafm03-afk/mansora-website`, `main` at `7d05ff8`)

| Area | Where | State |
| --- | --- | --- |
| Hosting | Vercel, `vercel.json` | Static `public/`, functions in `api/`, rewrites `/contact` and `/subscribe`. CSP `form-action 'self'`, `connect-src 'self'` plus Google Translate. |
| Contact Us | `api/contact.js`, `api/_mail.js`, `api/_templates.js` | Consulting enquiries: Google Sheet log, team alert, client confirmation, 24 h team reminder and 2-day client follow-up **scheduled in Resend**, WhatsApp alert. Reference `MCB-YYMMDD-XXXX`. **Must not change (D01, A02).** |
| Newsletter | `api/subscribe.js` | Resend Contacts and sheet. Untouched. |
| Mail | `api/_mail.js` | Resend key from the **mansora-consulting** Resend team (domain verified there); sender `hello@mansora-consulting.com`; replies to `CONTACT_TO_EMAIL` (default `priscilla@mansora-consulting.com`); 5 requests / 10 min per IP per instance. |
| Software demo entry | — | **None.** No demo CTA or form. |

## 2. Decisions this contract makes (within the approved D01–D05)

1. **The application sends all demo-request email** (acknowledgement, team alert, reminders, follow-up) through its
   durable queue, so state can be rechecked at send time (A07). The website's demo handler sends **no** email. The
   website's scheduled-in-Resend pattern is not reused for demos: a scheduled Resend email cannot be cancelled when a
   lead is contacted.
2. **One verified sender for both**: the application uses the same verified domain as the website
   (`… <hello@mansora-consulting.com>` or a `demos@` alias), `RESEND_REPLY_TO` = the team inbox. Confirm which Resend
   team holds the application's key before live sends (Gate 3).
3. **Website → application is server to server**: the browser posts to the website's own `/api/demo` (same origin,
   so CSP and CORS stay as they are); that function forwards to the application over HTTPS. Browser-to-API CORS is
   not opened.
4. **Source attestation**: the website function signs each forward with HMAC-SHA256 using a shared secret
   (`DEMO_INTAKE_SECRET`, set on Vercel and Railway, never in code or the browser). The application records
   `source = 'website'` and trusts the forwarded client IP **only** when the signature is valid and fresh; an unsigned
   request is still accepted from the existing public form but recorded `source = 'app_form'` and rate-limited by its
   own IP. A forged or stale signature is refused (403), not silently downgraded.
5. **Idempotency**: the website generates `submissionId` (uuid v4) once per form fill and resends it on retry; it is
   the lead `id`. Same id → same lead, no second notification (A03). A later enquiry from the same address with a
   new id is a new lead.
6. **Reference numbers**: application leads get `MSD-YYMMDD-XXXX` (software demo), distinct from consulting `MCB-…`.

## 3. API contract (PR-01)

`POST /v1/public/demo-requests` — unchanged fields stay compatible; new optional fields added.

Request (JSON or form):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Optional today; **the website always sends it** (`submissionId`). |
| `name`, `business`, `email`, `phone`, `message`, `consent` | as today | `consent` must be `true`/`yes`. |
| `businessType` | `retail` \| `mini_mart` \| `general_merchandise` \| `wholesale` \| `other` | Optional, discovery only. |
| `website` | string | Honeypot, as today. |

Headers from the website function only: `x-mansora-source: website`, `x-mansora-timestamp: <unix seconds>`,
`x-mansora-client-ip: <ip>`, `x-mansora-signature: hex(HMAC_SHA256(secret, timestamp + "\n" + client_ip + "\n" + sha256(body)))`.
Accepted within ±5 minutes.

Response `202`: `{ ok: true, reference: "MSD-…", duplicate: boolean, message }`. The lead is committed **before** the
response; acknowledgement and alert rows are inserted **in the same transaction** (outbox), so a saved lead always
has its emails queued and an email failure never loses the lead. `4xx` with `{ code, message }` for validation,
`403 BAD_SOURCE_SIGNATURE`, `429` with `Retry-After`; `5xx` means not saved: the website shows an error and lets the
person resubmit the same `submissionId`.

## 4. Data model (one additive migration per PR; no released migration rewritten)

`demo_requests` (PR-01/03): `reference text UNIQUE`, `source text CHECK (source IN ('website','app_form','admin'))`,
`business_type text`, `assigned_admin_id uuid REFERENCES admins(id)`, `last_contacted_at timestamptz`,
`next_follow_up_at timestamptz`, `qualification jsonb NOT NULL DEFAULT '{}'`, `follow_up_opt_out_at timestamptz`,
`tenant_id uuid UNIQUE REFERENCES tenants(id)`, `converted_at timestamptz`, `converted_by uuid REFERENCES admins(id)`.
Status values unchanged; "converted" is `tenant_id IS NOT NULL`, not a status.

`lead_events` (PR-03): `id uuid PK, lead_id uuid REFERENCES demo_requests(id), kind text CHECK (kind IN
('note','call','meeting','email_out','email_in_logged','status','assignment','conversion','system')), body text,
actor_admin_id uuid, notification_id uuid REFERENCES notifications(id), occurred_at timestamptz, created_at
timestamptz`. Append-only (no UPDATE/DELETE grant).

`notifications` (PR-02): `lead_id uuid REFERENCES demo_requests(id)`; scheduled sends use the existing
`next_attempt_at`. `deliverQueued` gains a **pre-send guard** for lead kinds (`lead_ack`, `lead_alert`,
`lead_team_reminder`, `lead_customer_followup`, `client_onboarding`) that re-reads the lead and marks the row
`skipped` with a reason when contacted / converted / closed / opted out (A07). New delivery states for PR-07 are
added in a separate column (`delivery_status`: `accepted`, `delivered`, `bounced`, `complained`) so `sent` keeps
its meaning (accepted by the provider).

`tenants` (PR-04/06): `lead_id uuid UNIQUE REFERENCES demo_requests(id)` (back-link), `preset_id text`,
`preset_version integer`. Business types already on tenants stay.

Indexes: `demo_requests(status, created_at)`, `demo_requests(next_follow_up_at) WHERE tenant_id IS NULL`,
`lead_events(lead_id, occurred_at)`, `notifications(lead_id)`.

## 5. Conversion (PR-04) — transaction design

One `db.platform` transaction:
1. `SELECT … FROM demo_requests WHERE id = $1 FOR UPDATE`; refuse unless `status = 'qualified'` and
   `tenant_id IS NULL` (a repeat with the same idempotency key returns the earlier result).
2. Duplicate check: existing tenants with the same normalised email or phone (last nine digits) or a close business
   name; any match → `409 POSSIBLE_DUPLICATE` with the matches; linking to an existing client is a separate,
   audited `link-existing` action.
3. Reuse the existing client-creation function (tenant, billing account, twelve onboarding steps) and, if a plan was
   agreed, `createSubscription` (draft only, never submitted or charged — A11).
4. `UPDATE demo_requests SET tenant_id, converted_at, converted_by`; `UNIQUE(tenant_id)` and `UNIQUE(lead_id)` make a
   second conversion impossible even if two administrators race (A10).
5. Insert `lead_events(conversion)`, admin audit row, and the `client_onboarding` notification (outbox, idempotency
   key `onboarding:<tenant_id>`) — all in the same commit. Email failure later never rolls back the client (A13).

## 6. Security design

- All lead and conversion endpoints: platform administrators only (existing session check); no tenant role can
  reach `demo_requests` or `lead_events` (platform plane, RLS untouched).
- Public intake: fixed templates only; the public cannot set subject, HTML, recipients or template; all lead text
  is escaped in HTML emails; caps per IP, per email and per day; honeypot kept.
- Admin links in team emails point to `/admin/#lead/<id>` and require sign-in; never a token.
- Owner setup links are only ever created by the existing browser-workspace process and sent in a separate message
  after they exist (PR-05); the onboarding email contains no password, code or secret.
- `DEMO_INTAKE_SECRET`: 32+ random bytes, on Vercel and Railway only; rotation by setting a second accepted secret
  for a day.
- Logs: lead ids and references only; never names, emails, phone numbers or message text.
- Retention proposal: unconverted leads deleted 24 months after last activity; events with them; recorded in
  `docs/legal/retention-deletion.md` and the data inventory in the PR that adds each column (the legal inventory
  test enforces this).

## 7. Prerequisites (owner / operator)

| Needed for | Item | Status |
| --- | --- | --- |
| PR-01 website | Claude GitHub App with **write** on `priscillafm03-afk/mansora-website` | **Missing**: pushes refused. Install at github.com/apps/claude/installations/select_target (account priscillafm03-afk), or move the repo under PeterAshiagbor |
| PR-01 | `DEMO_INTAKE_SECRET` on Vercel and Railway (same value) | To set; I can set Railway, Vercel needs the site owner |
| PR-02 | Application `RESEND_FROM_EMAIL` on the verified mansora-consulting.com domain, `RESEND_REPLY_TO` = team inbox, `LEAD_ALERT_EMAIL` = team inbox | Confirm the application's Resend team (Gate 3) |
| PR-02 | Team-test allow-list includes the team inbox | Railway variable |
| PR-07 | Resend webhook endpoint + signing secret | Later |

## 8. Test baseline (default branch `910f07f`)

`vitest run`: 467 tests in 95 files pass, including browser tests; typecheck, legal inventory check and CI (20
checks) green. Existing lead coverage: demo intake validation, honeypot, idempotent id, admin status change
(`tests/e2e/*` and API tests). Website: `npm run test:live` (sends real `[TEST]` email; not run here),
`npm run dev` mock mail. PR-01 adds a website unit test runner (Node's built-in `node --test`, no new dependency).

## 9. Acceptance mapping

| Spec test | PR |
| --- | --- |
| A01–A03 website submission, consulting form unchanged, duplicates | PR-01 |
| A04–A07, A20 emails, timing, suppression, provider vs delivered | PR-02, PR-07 |
| A08 notes/status/assignment | PR-03 |
| A09–A11 conversion, race, draft-only subscription | PR-04 |
| A12–A14 onboarding email, failure/retry, owner chooses password | PR-05 |
| A15–A16 presets, existing clients unchanged | PR-06 |
| A17–A19, A21–A22 regressions, isolation, rendering, config, staging rehearsal | PR-07 |
