# Billing operations runbook

## Every day
1. Open **Collections → Needs review**. Each item is a difference between Mansora's records and a provider's. Resolve it with a written note (kept in the audit log).
2. Open **Collections → Clients**, filter *Overdue* and *Failed collection*. Contact the client; use **Generate payment link** or **Record payment** for money received outside the provider.
3. Check **Messages**: anything still "queued" means no email provider is connected (blocker B5).

## Common tasks
| Task | Where |
| --- | --- |
| Start a client on a plan | Subscriptions → New subscription → Create draft → **Submit for approval** (this issues the first invoice). Activation follows the chosen policy (first payment, or authorised automatic payments), or **Activate manually** |
| Change a client's price or plan | Subscription → **Change plan** (applies from the next invoice; issued invoices never change) |
| Client paid by bank/cash/direct Mobile Money | Invoice → **Record payment** (reference and date required for audit) |
| Client disputes a charge | Invoice → **Mark disputed**; automatic collection stops for that invoice until resolved |
| Wrong invoice | Unpaid: **Cancel invoice**. Paid or part-paid: **Credit note**. Never edit an issued invoice |
| Refund | Payments → **Refund** (tick *through provider* to send money back via Paystack) |
| Provider payout arrives | Payments → Provider payouts: record gross, fees and the payments it covers; differences open a review item |
| Client asks to cancel | They request on their Billing screen; you see it on the subscription; decide, then **Cancel** (at period end or now) |

## If something looks wrong
- **Client says they paid but invoice is open:** check *Collections → Payment attempts*. A "pending" attempt is re-checked with the provider every 15 minutes; use **Run now → Check pending payments with providers**. Never mark paid without the provider's confirmation or a recorded manual payment with a reference.
- **Webhook failures:** the provider dashboard shows delivery errors; the reconciliation job still settles confirmed payments.
- **Duplicate invoice:** impossible per period (idempotency key); a second one for the same period is rejected.
- **Revenue differs from the provider:** compare *Cash collected* (net of refunds) with the payout report; fees are separate.

## Never
- Never type live provider keys into chat, tickets or the repository: set them as environment variables.
- Never suspend a client automatically for non-payment; escalate to a person.
- Never run live charges to test.
