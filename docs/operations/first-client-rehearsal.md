# C35 — first-client billing rehearsal

This client/sales session follows the roadmap's explicit C35 assignment. Changes are limited to the operational runbook and this evidence; no protected financial engine/provider implementation is changed.

The existing automated browser/API suites were used as a repeatable local procedural rehearsal against disposable PostgreSQL, encrypted retail stores, a sandbox provider and fake/no-email adapters. This is an automated interface rehearsal, not a claim that a shop operator, real bank, inbox or physical device completed training.

| Runbook step | Executed evidence |
| --- | --- |
| Client/plan/invoice and actual UI manual payment, then revenue | tests/e2e/billing.test.ts |
| Partial/full payments, overpayment refusal, allocations, refunds/credit notes, provider payouts/reconciliation | tests/billing/receivables.test.ts |
| Declined collection, bounded retries and lost-provider-response recovery | tests/billing/failed-collections.test.ts |
| Reminders/warnings/report-only restrictions, continued till operation, disputes and bounded audited arrangements | tests/billing/non-payment.test.ts |
| Preserved failed communication draft, single retry queue and provider acceptance in the real interface | tests/e2e/communications.test.ts |

The local rehearsal found documentation gaps rather than a new billing-code failure: queued mail does not uniquely mean an absent provider; the Run now action is under Payment settings; automatic period deduplication must not be described as making all manually created duplicate invoices impossible; and reference/date reconciliation guidance must not misrepresent optional API fields as universally required. The runbook now describes those distinctions and gives a concrete sandbox sequence.

No live client invoice, real charge, refund, WhatsApp message or external email was created. The C30 local reproduction separately confirms cross-period refund reconciliation and invalid/reversed date refusal after the integrated fixes. Exact test counts/results are appended when the selected rehearsal finishes; full release checks are recorded in the shared handoff.

Executed result: **21/21 tests in 5/5 files passed, with no skips**, on application `0991c7883bdcf20056a2f820df7665f0528a391e`. The same unchanged application had a 325/325 full local regression pass and all six C39 feature/PR workflows green. The documentation PR has its own CI checks; do not confuse those with a new provider/hardware acceptance.
