# Hosted interface preview

Live demo: https://mansora-saas-demo.bgtpk74dbt.chatgpt.site

Published through Sites as **version 4** (sharing changed to anyone-with-link at the owner’s request) on 2026-11-10.
It includes merged C14 and the C18 billing-aware refresh. Choose Client app or Mansora admin. The sharing policy is public/anyone-with-link,
so ChatGPT users and signed-out visitors can open it.
Hosting project: `appgprj_6af2c4565ff881919480f43aab9e56bb`.
Deployment `appgdep_6af30b443b508191a45fb8fccd789f87` returned `succeeded`; this is an interface demo URL, not
the production Mansora service.

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
and generated asset paths. The underlying combined application separately passed
220 browser/integration/security tests locally; current C14 CI is being verified, with Windows packaging, PostgreSQL 16 and the API container verified separately in CI. The managed Sites environment has no
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

Publication provenance: Site source `cf0a6bfe882d93f5c83d4319a5f7269ba677abb4`,
built from Mansora `09b3ab943972c2ce1469cbe5f91bb064c5ed3b47` (PR #27).
All 69 output assets were hashed and verified against the retained provenance
record before packaging; subsequent publication/handoff edits are documentation
only. The project identity was retained. The owner subsequently requested broader
sharing; native access policy revision 2 changed the audience to public/anyone-with-link.

## Version 5 publication

C19 UI revision published successfully as version 5, deployment
`appgdep_6af3116d83248191bea213833cc9ed5c`. Site source
`30d6920f906533a76a59ccac0a76fbbb22283e60`, built from Mansora
`6e59e7514afa4313e9c20814eb7c035227b32b5f` (merged PR #28). Public/anyone-with-link
access was confirmed after publication. A focus/draft follow-up is being verified
and will retain the same identity/audience.
