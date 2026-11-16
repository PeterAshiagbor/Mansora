# R16-05 combined-release financial review — 16 November 2026

Reviewer: Claude (R16-05 in `docs/codex-tasks.md`). Scope: the released code at `ef07fba` plus this branch, covering:

- journals
- supplier payables
- stock valuation and losses
- customer credit and write-offs
- shop VAT
- Mansora's own billing VAT
- E-VAT queue integrity

Method: each area was exercised with synthetic transactions. Every expected figure was worked out by hand and asserted in `tests/integration/financial-review-r16.test.ts` and `tests/integration/vat-registration-boundary.test.ts`. Each defect below was shown failing on the old code before it was fixed.

## Defects found and fixed

| # | Area | Defect | Effect | Fix |
| --- | --- | --- | --- | --- |
| 1 | VAT arrears | After a GRA-authorised amended return, arrears counted both the superseded filing and the amended one for that month | The shop was shown owing GHS 18.00 when it owed GHS 11.00 | Only the latest filing for each month is owed (`core/tax.ts`) |
| 2 | Journal | Goods paid for on delivery were credited to trade payables (2000) and never cleared | The accountant's payables were overstated and disagreed with `payable.list` | Credit purchases go to 2000. Paid-on-delivery goods and their input tax go to a new 2010 clearing account |
| 3 | Journal | Cash expenses and supplier payments not paid from the till were credited to cash in till (1000) | The journal's till drifted from shift counts (GHS 100.00 against the true GHS 155.00 in the test) | These now post to a new 1050 "cash paid outside the till" account |
| 4 | Journal / stock | Moving-average cost is rounded per unit, so inventory postings drifted from the valuation | Inventory account 1200 was GHS 0.30 off the stock report after one ordinary day, and the gap keeps growing | A daily "stock valuation rounding" entry (1200 against 5100) keeps 1200 equal to quantity × average cost |
| 5 | Refunds / credit | Returned goods on a written-off debt were paid out in cash | The shop paid a customer money they never paid (GHS 80.00 in the test) | Refunds now apply in order: unpaid debt, then written-off debt (recorded as a write-off reversal), then a payout of what was actually paid. The restore rebuild stays consistent |
| 6 | E-VAT | Overlapping queue runs (background sync and "Submit now") could submit the same document twice | Duplicate fiscal submissions | One run per laptop; an overlapping caller shares the result |

## Verified without change

- **Sale journals:** they balance with change, split tenders and credit. Payments store the applied amount, not the cash tendered.
- **Supplier payments:** capped at the amount still owed, including after part payments.
- **Credit:** write-offs are capped at the outstanding balance. Repayments are refused when larger than the outstanding balance.
- **Automatic VAT registration:** happens only above GHS 750,000.00, with month-end commencement, exempt sales excluded, zero-rated sales included and refunds netted. Filed months are locked, prior-period netting is refused, and amendment with GRA authority works. Admin-off exposure stays in its original period (see the R16-04 test).
- **E-VAT documents:** built only from the immutable sale and refund snapshots and queued in the same transaction. Live mode is still refused.

## Open findings (not fixed here)

1. **Credit notes on Mansora's own invoices carry no VAT, NHIL and GETFund split.** This matters once Mansora is VAT-registered (F18, which waits on a tax adviser). The fix needs a cloud migration.
2. **No VAT bad-debt relief.** Writing off a VAT-inclusive debt does not adjust output tax. Relief has statutory conditions, so the accountant or tax adviser must decide; Mansora should not guess.
3. **No fiscal document for a corrected sale.** A sale made while Mansora had VAT switched off gets no E-VAT invoice when it is later reconciled by adjustment. GRA's guidance is needed on how a corrected supply is fiscalised.
4. **New chart accounts need Xero mapping.** Accounts 1050 and 2010 are new, so existing Xero users must map them before the next push. The push already refuses with `XERO_MAPPING_REQUIRED` and names the accounts, so nothing is posted wrongly.
5. **Stock with negative quantities is valued at zero** (as the stock report already does). The rounding entry absorbs the difference into 5100. Shops that allow negative stock should count and correct it.

## Evidence

- Full suite: 110 files and 555 tests pass. The typecheck is clean.
- CI on PR #99.
