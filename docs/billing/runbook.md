# Billing operations runbook

## Every day
1. Open **Collections → Needs review**. Each item is a difference between Mansora's records and a provider's. Resolve it with a written note (kept in the audit log).
2. Open **Collections → Clients**, filter *Overdue* and *Failed collection*. Contact the client; use **Generate payment link** or **Record payment** for money received outside the provider.
3. Check **Collections → Messages** and its delivery state. Queued can mean normal worker delay, a scheduled retry, an allowlist/configuration problem or no connected email provider. Inspect the visible safe error/category and provider configuration before retrying. Provider acceptance is not proof of inbox delivery; do not resend an accepted message just because it has not been read.

## Common tasks
| Task | Where |
| --- | --- |
| Start a client on a plan | Subscriptions → New subscription → Create draft → **Submit for approval** (this issues the first invoice). Activation follows the chosen policy (first payment, or authorised automatic payments), or **Activate manually** |
| Change a client's price or plan | Subscription → **Change plan** (applies from the next invoice; issued invoices never change) |
| Client paid by bank/cash/direct Mobile Money | Invoice → **Record payment** (check the received date and enter the external reference/evidence when available; these are staff reconciliation checks, not a claim that every field is server-required) |
| Client disputes a charge | Invoice → **Mark disputed**; automatic collection stops and the non-payment policy does not escalate for that invoice until resolved |
| Client cannot pay on time | Collections → **Manage** → **Payment arrangement**: choose the last day and record what was agreed. Reports stay open until then; ending it early is also audited |
| See where a client stands | Collections → **Service** column: Normal, Reminded, Warned, or Reports paused |
| Wrong invoice | Unpaid: **Cancel invoice**. Paid or part-paid: **Credit note**. Never edit an issued invoice |
| Refund | Payments → **Refund** (tick *through provider* to send money back via Paystack) |
| Provider payout arrives | Payments → Provider payouts: record gross, fees and the payments it covers; differences open a review item |
| Client asks to cancel | They request on their Billing screen; you see it on the subscription; decide, then **Cancel** (at period end or now) |

## If something looks wrong
- **Client says they paid but invoice is open:** check *Collections → Payment attempts*. A "pending" attempt is re-checked with the provider every 15 minutes; use **Payment settings → Run now → Check pending payments with providers**. Never mark paid without the provider's confirmation or a recorded manual payment with a reference.
- **Webhook failures:** the provider dashboard shows delivery errors; the reconciliation job still settles confirmed payments.
- **Suspected duplicate invoice:** automatic subscription invoices use a unique period/idempotency key. Separately created manual invoices can still duplicate a business intention, so check the invoice list, references and audit trail before issuing another. If an action timed out, inspect saved records before retrying or creating a replacement.
- **Revenue differs from the provider:** compare *Cash collected* (net of refunds) with the payout report; fees are separate.

## Never
- Never type live provider keys into chat, tickets or the repository: set them as environment variables.
- Never suspend a client's account for non-payment. The non-payment policy (D-28) only pauses their management reports after the warning period, and never stops selling. To give a client time, use **Collections → Manage → Payment arrangement** (up to 60 days, reason required, audited).
- Never run live charges to test.


## First-client rehearsal (sandbox only)

Use a separate local fixture or explicitly isolated training business. Do not run these steps against real client data or live payment credentials.

1. Create the client and service plan, then create and submit the subscription. Confirm the issued invoice amount, due date and activation policy; a draft alone is not approval.
2. Open Collections and verify the same outstanding amount. Open the invoice and record a partial manual payment with its actual received date and a training reference. Confirm only the remaining amount is owed; do not treat the payment as a second sale.
3. Record the remaining payment. Confirm the invoice is paid and cash/revenue reporting distinguishes receipts from credit, fees and refunds. Do not mark a provider attempt successful by assumption.
4. In the fake/sandbox provider flow, rehearse a declined collection and a connection interruption. Check Payment attempts, wait the configured retry interval, and verify recovery records one confirmed payment rather than charging twice.
5. Rehearse a partial refund and credit note, then review the remaining receivable and a refund-only reporting period. Reconcile client/service breakdowns with the headline totals.
6. Mark a training invoice disputed, set and end an audited bounded payment arrangement, and verify service notices. The till and full business export must keep working; only management reports pause according to the approved policy.
7. Prepare a service message in the local fake-email fixture, force a failed submission, retry the preserved draft, and confirm one queued/accepted message. Never send a real test email as part of this rehearsal.
8. Review audit entries and close the disposable environment. Record source, test counts and verification limits in the handoff. Physical hardware, real provider settlement and actual inbox delivery remain separate acceptance exercises.

Evidence for the client/sales lane rehearsal is maintained in [First-client rehearsal](../operations/first-client-rehearsal.md).
