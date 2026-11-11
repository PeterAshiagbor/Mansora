# Hosted interface preview

Live demo: https://mansora-saas-demo.bgtpk74dbt.chatgpt.site

Published through Sites as **version 9** on 2026-11-11. It includes the C28
workflow redesign, billing-aware preview and C26 phone/walkthrough fixes.
Choose Client app or Mansora admin. Sharing is public/anyone-with-link, so
ChatGPT users and signed-out visitors can open it without an invitation.
Hosting project: `appgprj_6af2c4565ff881919480f43aab9e56bb`.
Deployment `appgdep_6af4c3adb8608191ae9faed7cb4d31cd` returned `succeeded`.
This is a synthetic interface preview, separate from the live production service.

The owner requested a hosted demo while the application remains in development.
The sample-only static preview uses the current, built desktop and administrator
interfaces. It does not expose the development host or connect a public browser
to real client data. It is separate from production hosting decisions.

Build both interfaces, then run:

```bash
npm run build
npx tsx scripts/build-interface-demo.ts /absolute/path/to/preview
node scripts/interface-demo/check-demo.mjs /absolute/path/to/preview/dist
```

The builder creates fresh, synthetic records through a temporary real API and
encrypted desktop engine. It captures an allowlist of display responses, checks
that generated credentials and credential fields are absent, then removes the
temporary stores. It never copies a user's existing data directory. The static
output contains no production endpoint or authentication credentials.

The landing page links to the client workspace and platform administration.
The client preview starts as the sample owner; its toolbar can switch to the
cashier view or re-enter after locking the screen. Inside the demo there is no
login requirement. The hosting audience is now public/anyone-with-link by explicit owner request;
hosting access is separate from the simulated application session.

Navigation, tables, forms, carton calculation and selling-price/margin display
use the actual application code. Product, category, customer, supplier and
business-setting edits are temporary browser-memory changes. Reload resets
them. Reports show the original fixture snapshot. Transactions, imports,
backups, sync, staff/account changes and administrator writes return an explicit
preview-only explanation; they never pretend to persist or submit live data.
Excel templates can be downloaded; Excel uploads are tested in the real desktop
suite and are not processed in this static preview.

`scripts/interface-demo/check-demo.mjs` verifies fixture identities, filtering,
temporary edits, blocked mutations, every provider read, zero backend requests
and generated asset paths. The actual application passes 231 tests and all C19 PR/merged workflows, including PostgreSQL 16 sync, audit, Windows packaging/smoke and API container/security checks. The managed Sites environment has no
`cua_repl.js` browser tool, so hosted browser QA is unverified; the sample adapter
and files are checked without claiming a browser run on the hosted Site.

The hosting project identity lives in the separate Site checkout's
`.openai/hosting.json`. The Site's own source repository contains the exact
static output, demo sources and a provenance record pointing to the Mansora
source commit. Updates rebuild from the desired Mansora branch, sync that Site
repository and deploy a new version while preserving the Site identity/access.

## C18 billing-aware refresh

Synthetic fixtures include actual subscription creation, issued invoices, a partial
payment and a fully paid invoice/receipt, all inside throwaway stores. No real
provider credentials are configured; only the sandbox registry and no-email
adapter are used. Billing owner reads, collections filters, subscriptions, invoice
search/status, payments, revenue and provider settings have captured responses.
The cashier adapter refuses owner billing reads. Every billing mutation remains
blocked, including payment initiation and recurring authority. Report periods
outside the captured range return an explanation instead of unrelated totals.

The landing page also links to a screenshot walkthrough generated from the real
application. These screenshots evidence interface behavior with sample records;
they are not evidence of live payment processing or client/hardware acceptance.

Previous version 4 provenance: Site source `cf0a6bfe882d93f5c83d4319a5f7269ba677abb4`,
built from Mansora `09b3ab943972c2ce1469cbe5f91bb064c5ed3b47` (PR #27).
All 69 output assets were hashed and verified against the retained provenance
record before packaging; subsequent publication/handoff edits are documentation
only. The project identity was retained. The owner subsequently requested broader
sharing; native access policy revision 2 changed the audience to public/anyone-with-link.

## Previous version 5 publication

C19 UI revision published successfully as version 5, deployment
`appgdep_6af3116d83248191bea213833cc9ed5c`. Site source
`30d6920f906533a76a59ccac0a76fbbb22283e60`, built from Mansora
`6e59e7514afa4313e9c20814eb7c035227b32b5f` (merged PR #28). Public/anyone-with-link
access was confirmed after publication. The focus/draft follow-up is included in current version 6 below.

## Current version 6 publication

Site source `55bd0a50810841064f90b7eadd4c2762577e6010`, built from Mansora `61716641409048737810e8814efbcd31323d65a2`
(PR #29, merged as `7537e616f9241ef94e60d6d92f98708b0643b733`). Native deployment `appgdep_6af4c3adb8608191ae9faed7cb4d31cd`
returned `succeeded`. All 69 output assets were verified against SHA-256 provenance
before packaging. The existing project identity and owner-requested public audience
were retained. See [interface acceptance](interface-deployment-readiness.md) for
verified behavior and the hosted-browser verification limit.
