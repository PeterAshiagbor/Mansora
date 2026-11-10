# Accounting-style workspace and practical help

C13 implements the owner's request for a more professional experience inspired
by familiar accounting applications, plus more useful reports and page help. It
retains Mansora's logo, purple/gold accents, offline fonts and separate provider
and client identities. It does not copy another vendor's branding or add
unimplemented accounting capabilities.

## Navigation and presentation

Both interfaces share a white company sidebar, grouped icon navigation, active
page state, workspace header, page finder (Ctrl/Cmd+K), user context, consistent
tables and restrained cards. The finder contains only permitted navigation
items. A skip link moves to page content. Company identity and sign-out remain
visible while the navigation scrolls. Application headings use DM Sans; the
Mansora wordmark retains Georgia. The canvas is a neutral accounting-workspace
gray, with purple primary actions and a small gold brand accent.

Dialogs keep their actions visible while their content scrolls. Their content
is keyboard focusable. Product entry is divided into product details, pricing
and cost, and stock settings, retaining the actual carton calculator and
permission-gated cost fields. Date controls have fixed, responsive widths and
report presets avoid duplicate shortcuts.

## Dashboard and reporting

Dashboard quick actions follow staff permissions. Sales activity uses actual
reported daily values, without invented trends, forecasts or prior-period
comparisons. The chart labels negative values and explicitly omits days without
activity. Cashier dashboards retain their own-sales scope.

Reports now have seven possible views, each still gated by the existing relevant
permission: Summary, Sales, Payments, Gross profit, Stock, Expenses and Customer
balances. Today, This week (Monday start), This month and Last month shortcuts
use UTC dates, including month/year/leap-day boundaries.

The summary separates net sales from collections. Collections on new sales
exclude new credit; repayments are added and actual refund payouts are
subtracted. Credit reductions on refunds are not cash payouts. Average completed
sale is sales after discounts but before subsequent refunds divided by sale
count, rounded to a pesewa; it is blank when there are no sales. Exports use the
same displayed source values and identify the selected period. Profitability
shows cost of goods sold, gross profit, gross margin and recorded expenses
separately. It does not present a statutory or complete net-profit statement.

Expense breakdowns use the existing authorised expense query. Customer balances
are current balances, clearly labelled as unaffected by a historical date
filter. The stock report similarly distinguishes current on-hand/valuation from
period-specific movements. No financial-engine, schema, tax, subscription or
permission policy changes are made.

## Help

Every client page and every provider page has How to use this page, with
screen-specific steps and cautions. The client Help & getting started centre
searches available guides and opens the corresponding permitted page. Guidance
covers carton costing, gross margin versus markup, discount approval, refunds,
credit, shift reconciliation, imports, backups, sync, support consent and admin
MFA. It does not request or expose passwords, recovery codes or passphrases.

## Verification

The report-definition unit tests cover exclusion of credit, repayments/refunds,
negative collections, empty periods and date boundaries. Browser tests cover
page finding, the new reports, contextual help and searchable guides. The axe
suite includes all 20 client pages, all report tabs, both interfaces' dialogs,
contextual help and the finder at standard and 200%-equivalent viewports.

The Site remains a sample-only interface preview. Live transaction/import and
account writes remain disabled there; production app behavior is unchanged.
Hosted browser QA remains unavailable in the managed Sites environment; local
repository browser checks exercise the actual interfaces and real engine/API.

Local verification passed: typecheck and all builds, 159 tests across 22 files
with Playwright enabled and zero skips, and a dependency audit with zero
vulnerabilities. The accessibility scans report zero serious/critical
violations. Product, dashboard, report-summary and help screenshots were
reviewed, including the smaller viewport's scrollable dialog and fixed footer.
