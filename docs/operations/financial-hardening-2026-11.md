# Financial hardening, November 2026

This change responds to the independent financial, accounting and Ghana VAT audit of commit `d56c013`
(15–16 November 2026). Each row names the audit finding, what changed and the test that proves it. Expected values
in the tests are worked out by hand, not read back from the application's reports.

| Finding | Change | Evidence |
| --- | --- | --- |
| F02 Losses hidden from profit | `report.profit` adds loss lines: damaged stock, stock-count differences, manual corrections, returns not put back in stock, cash short or over at shift close, and debt written off, then "gross profit after losses". Unsellable returns leave COGS and appear as a loss. | `tests/integration/financial-hardening.test.ts` (F02), `engine.test.ts` TEST 06 |
| F03 Large stock counts rejected by the cloud | Audit detail is capped and summarised with a SHA-256 fingerprint. Large commands are split into events of at most 1,000 rows. Every event is validated against the sync contract before commit. **Repair and resend** rebuilds events already refused. | F03 tests |
| F04 Restore from an older backup | A restored laptop must catch up from the cloud before issuing numbers. The catch-up merges missing facts, takes newer state rows, rebuilds stock and credit balances above both sides' versions and continues numbering. The owner can continue offline with a new numbering block. | `tests/sync/restore-reconcile.test.ts` |
| F05 VAT payments in the wrong month | Payments carry the return month they settle. VAT report, page and workbook show filed returns, payments and arrears. | F05 test, `tax.test.ts` |
| F06 Registration trigger suppressed | Unclassified products no longer block the trigger; it records classification review. | F06 test |
| F07 Backdating and clock changes | New immutable, synced `ledger_records` table. The owner closes or reopens months (Settings → Accounting periods). Every dated financial command refuses closed months. Expenses cannot be future-dated, and till expenses must be dated today. A clock moved back more than 5 minutes behind the last transaction blocks financial commands until the owner confirms the clock. | F07 tests |
| F09 Input VAT counted in stock cost | `purchase.receive` can record the input claim with the receipt (owner, VAT registered, supplier TIN and invoice date). The VAT papers list purchases with no claim. | F09 test |
| F10 Duplicate supplier invoices | The same supplier and invoice number is refused unless a reason is given. | F10 test |
| F11 Reused Mobile Money references | A reference already used on a payment or repayment needs a manager's approval, which is recorded. | F11 test, `wallet-check.test.ts` |
| F12 Non-blind cash count | Staff without shift review rights do not see expected cash while their shift is open; it is shown after closing. | F12 test, `engine.test.ts` |
| F13 Mixed revenue bases | The sales report adds tax collected and net sales excluding tax. The profit report labels its tax-exclusive basis. `report-definitions.md` is corrected. | F13 test |
| F14 No closing-stock valuation | The stock report adds the value at the end of the chosen period, rebuilt from the movement ledger. | F02 as-at test |
| F16 VAT report scans all history | Not changed. The VAT report merged from PR #96/#97 reads the full history to detect historical exposure from disabled collection, which correctness requires. Revisit with stored monthly totals if large shops report slow VAT pages. | n/a |
| F08 No accountant-ready output | `accounting.journal` and **Journal for your accountant** (Import & export): balanced daily double-entry journals on a default chart of accounts, period totals, and a review sheet for items needing judgement (withholding certificates, adjustments, opening credits). Every journal is checked to balance. Not financial statements. | F08 test: ties to the profit, credit, till and VAT figures |
| F15 Invoice content | Optional business TIN on customers, printed on VAT receipts. Printable credit note per refund, with the original receipt and the tax reversed. VAT receipts state they are not issued through GRA E-VAT. | F08 test |
| F18 Mansora's own invoice VAT | Billing setting "Mansora is VAT registered": new invoices carry VAT 15%, NHIL 2.5% and GETFund 2.5% as separate lines with Mansora's VAT number. Off by default; manual invoices with an explicit rate keep it. | `tests/billing/mansora-vat.test.ts` |
| F21 Counting while selling | The count sheet's start time is sent with the count. Movements since then are allowed for, so sales during counting are not recorded as missing stock. | F21 test |
| F01 E-VAT readiness | Submission pipeline: queued atomically with each VAT sale or refund, ordered submission with retries, 24-hour downtime flag, immutable accepted identifiers, receipts stamped, synced to the cloud. Test simulator only; live mode refused until GRA onboarding. | F01 tests, `restore-reconcile.test.ts` |
| F08 Supplier payables | "Bought on credit" when receiving stock, with a due date. **Owed to suppliers** shows each unpaid invoice (cost plus input tax), aging and part payments; paying from the till reduces expected cash. Supplier payments are journalised. | F08 payables test |
| F08 Xero connector | Owner connects their own Xero organisation (OAuth 2.0 with PKCE; no client secret on the laptop) and maps each Mansora account to a Xero account code. Each day's balanced journal is sent once as a DRAFT manual journal for the accountant to post. Refused days are recorded and can be sent again; tokens refresh automatically and are kept out of portable backups. | `tests/integration/xero.test.ts` (simulated Xero API) |
| F19 Restore rehearsal | `npm run drill:recovery`: a scripted laptop-loss drill with measured recovery point and time. Result recorded in `docs/disaster-recovery/rehearsal-2026-11-16.md` (pass). | drill output |
| F17 Receivables aging and write-off | `credit.list` returns 0, 1–30, 31–60, 61–90 and 90+ day buckets. `credit.writeOff` (owner, immutable record, shown as a loss). | F17 test |

## Deployment order

1. Deploy the API with migration 20 (`ledger_records`, `evat_submissions`, `purchases.due_date`, `invoices.tax_breakdown`) **before** upgrading laptops or browser shops. An older server refuses events containing the new table. If that happens, the events can be sent again with **Repair and resend** after the server is upgraded.
2. Then upgrade laptops. Local migration 7 adds `ledger_records`, `evat_submissions`, `purchases.due_date` and two lookup indexes. Customer TIN and address come from migrations 6 (laptop) and 18 (cloud), merged from PR #96.

## Not changed here (still open)

- **F01 live GRA connection.** The pipeline is built and tested. The live connector needs the GRA-issued API specification, taxpayer credentials, GRA testing and sign-off. Until then receipts say they are not issued through GRA E-VAT. Do not market or onboard VAT-registered clients as E-VAT compliant.
- **F18 legal decision.** Whether and from when Mansora itself must register for VAT is a tax-adviser decision; the setting stays off until then.
- **F19 witnessed rehearsals.** The scripted drill passes. Still to do: a witnessed restore on a physical laptop and into an isolated Railway environment (procedure in the rehearsal record).
- **F08 beyond the journal and payables.** By design there is no general ledger or balance sheet: Mansora is the operational sub-ledger and the accountant keeps the books from the journal export. The Xero connector posts the journals directly; a QuickBooks connector would follow the same pattern if clients need it.
- **F22 Act 1177.** The service-provider threshold amendment's commencement still needs a Ghanaian tax practitioner's confirmation.
