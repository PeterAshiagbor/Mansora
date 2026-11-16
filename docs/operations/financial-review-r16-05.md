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

## R16-09 follow-up: VAT return performance (Codex finding on PR #100)

`vatReport` used to load and JSON-parse every sale and refund line ever recorded, reparse each snapshot up to five times, and reload the tax settings for every line. It also sent every line to the Tax screen, which displays none of them. Changes:

- **Less history loaded:** only the reported month's lines are read, plus lines sold while collection was switched off (needed for exposure). Earlier months reach the carry-forward as per-month sums computed in SQLite.
- **Less repeated work:** each snapshot is parsed once, and the tax settings are looked up once per date.
- **Smaller response:** `tax.report` returns line counts instead of line rows unless `includeRows: true` is passed. The Excel export still contains every line.

Equivalence was checked against a mixed four-month history: purchases, input credits, carry-forward, collection switched off and on, refunds of switched-off sales in later months, and an external sale. The old and new reports for each month were identical byte for byte once random IDs were masked.

Codex's benchmark (`tests/performance/vat-benchmark.ts`, PR #100) was run on the same machine, 50,000 sales, 150,000 lines, 10% collection suppressed:

| Measure | Before | After |
| --- | --- | --- |
| Report for the busy month, median of 5 | 3,705 ms | 2,223–2,813 ms |
| Data sent to the Tax screen | 98.5 MB | 2.6 MB |
| Report for the following, quiet month | 1,907 ms | 1,423 ms |

The busy month still processes all 150,000 lines of that month. A further step would aggregate the month's output and classifications in SQLite when rows are not requested. This duplicates the calculation path, so it should follow only if Codex's thresholds still fail on production hardware.

### Memory, measured per operation (Codex follow-up on PR #102)

Codex measured 1,342 MiB of process RSS after its benchmark. That process also built the 150,000-row fixture, so the figure is not the report's own cost. To isolate it, the fixture was built and closed, then each operation was run alone in a fresh process. The figure below is the peak RSS of that process (`process.resourceUsage().maxRSS`), including about 105 MB of baseline.

| Operation, 50,000 sales / 150,000 lines | Peak RSS | Time |
| --- | --- | --- |
| `tax.report` (Tax screen, no rows) | 417 MB | 3.2 s |
| `tax.report` with `includeRows` | 415 MB | 3.5 s |
| `tax.export` (Excel), before | **2,067 MB** | 17.2 s |
| `tax.export` (Excel), after the streaming writer | **582 MB** | 12.3 s |

The export was the operation over the 1 GB allocation. `toXlsx`, which every Mansora spreadsheet export uses, now streams rows into the file instead of building the whole workbook in memory. `tests/integration/xlsx-stream.test.ts` checks the written content: sheets, values, formula-looking text kept as text, and the bold header.

Two side effects:

- The old writer crashed on a sheet with no rows; the new one writes it.
- An empty-string cell is now a blank cell. Excel and `readTable` show both as empty.

The file is about a third larger (7.5 MB against 5.6 MB) because repeated text is no longer shared.

A constrained, production-like run is still Codex's acceptance step.

### Summary path aggregated in SQLite (Codex follow-up on PR #102)

The Tax screen's `tax.report` without rows no longer loads the month's ordinary lines. SQLite returns one grouped stand-in row per day and VAT treatment, made up of these fields:

- classification
- registered flag
- verified flag
- whether the snapshot is missing
- summed base, VAT, NHIL, GETFund, total and line amount

These are the only fields the return calculation reads.

Some lines are still loaded one by one, because they need individual treatment:

- lines sold while collection was switched off
- lines reconciled by an adjustment
- refunds of either kind

Export and filing (`tax.file`) still use the full line-by-line path.

`tests/integration/vat-summary-equivalence.test.ts` compares the summary with the full return for every month of a mixed history and requires every figure, blocker and warning to be equal. The history covers:

- a legacy line with no snapshot
- unclassified lines
- a backdated registration that leaves a sale without VAT, and its refund
- zero-rated and exempt sales
- collection switched off and back on, with later refunds
- a reconciled line and its refund
- an input credit and an external sale

Three deliberate mistakes in the grouping (a wrong registered flag, a wrong verified flag, legacy lines treated as snapshots) each made the test fail.

Each path was measured in a fresh process against the pre-built 150,000-line fixture with 10% of collection switched off:

| Path | Peak RSS | Time |
| --- | --- | --- |
| Tax screen summary | 380 MB | 2.2 s |
| `includeRows` (four runs in one process) | 1,129 MB | 2.2–2.3 s each |
| Excel export (streamed) | 579 MB | 10.1 s |

The summary's remaining cost is mainly the 15,000 switched-off lines, which have to be handled one by one for exposure. A real shop has almost none.

The full-row path is used only on request and by filing. A single run measured 415 MB earlier; repeated runs in one process build up uncollected memory.
