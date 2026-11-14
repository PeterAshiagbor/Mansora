# Mansora pricing (approved by the owner, 14 November 2026)

| Plan | Monthly | Yearly (two months free) | Setup fee (first invoice) | For |
| --- | --- | --- | --- | --- |
| Mansora Starter | GHS 129 | GHS 1,290 | GHS 400 | Sales, stock, receipts and basic reports, one till |
| Mansora Business | GHS 229 | GHS 2,290 | GHS 400 | Starter plus staff and permissions, customer credit, suppliers and reordering, profit reports, daily summary, bank and MoMo statements |
| Mansora Plus | GHS 399 | GHS 3,990 | GHS 400 | Business plus priority support and new features first |

The three plans are added when the server starts, if they are not there yet (`apps/api/src/billing/plans.ts`); migration 11 adds the columns. Prices can be changed under **Service plans**;
invoices already issued never change.

## Setting up a client (Billing → Subscriptions → New subscription)

- **Billed**: monthly, or yearly at the yearly price. Quarterly is not offered on these plans.
- **Setup fee**: on the first invoice only. Tick **Waive the setup fee** for a pilot shop: the invoice still lists it,
  at no charge, with the reason, so the client sees what they were given.
- **Pilot price**: a discount for the first months, then the full price. Enter the discount and the date the full
  price starts. Each billing period that starts before that date gets the discount; periods starting on or after it
  are full price, with no further action. An automatic-payment authorisation covers the full price, so charges after
  the pilot still go through.
- A discount can also be added, changed or given an end date later (**Set discount** on the subscription).

## Not yet built

Feature limits per plan (for example, staff accounts only on Business) are not enforced: every shop has every
feature whatever its plan. When they are built, shops without a tiered plan will keep everything.
