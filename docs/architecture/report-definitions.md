# Report definitions

All amounts are in Ghana cedis, stored as whole pesewas. "In the period" means
the record's own date falls between the chosen dates, inclusive (UTC = Ghana time).

| Term | Definition |
| --- | --- |
| Sale total | Sum of line totals after line and basket discounts |
| Gross sales | Sum of sale totals for sales completed in the period |
| Discounts | Sum of discounts on sales completed in the period |
| Refunds | Sum of refund amounts for refunds **created** in the period (a refund can fall in a later period than its sale) |
| Net sales | Gross sales − refunds. Includes VAT, NHIL and GETFund collected (customer-facing takings) |
| Tax collected | VAT + NHIL + GETFund on sales in the period − the same on refunds in the period, from the immutable snapshots |
| Net sales excluding tax | Net sales − tax collected. This is the revenue basis for gross profit |
| Cost of goods sold (COGS) | Σ quantity × cost snapshot for items sold in the period, minus the same for **all** refunded items in the period. Refunded items not put back in stock are shown as a loss instead |
| Cost snapshot | The product's moving-average cost at the moment of sale; later cost changes never alter it |
| Gross profit | Net sales excluding tax − COGS |
| Gross margin | Gross profit ÷ net sales excluding tax |
| Losses | Damaged stock, stock-count differences and manual corrections (−quantity × the movement's average cost), unsellable returns (quantity × cost snapshot), cash short (−variance of shifts closed in the period) and customer debt written off. A negative line is a gain |
| Gross profit after losses | Gross profit − losses. Still not net profit: expenses are not subtracted |
| Expenses | Sum of expenses dated in the period. Shown beside gross profit, **never subtracted**: the system does not report net profit |
| Payments by method | Amounts applied to sales, by method. Cash excludes change given. "Credit" is the amount sold on credit, not money received |
| Repayments | Credit repayments received in the period, by method. Never counted as sales |
| Stock on hand | Current balance per product = sum of all its stock movements |
| Stock value | Σ max(quantity, 0) × moving-average cost |
| Stock value at end of period | The same, rebuilt by replaying every stock movement up to the end of the chosen day with the moving-average rule |
| Low stock | Quantity ≤ reorder level |
| Outstanding credit | Sum of unpaid balances on credit sales |
| Overdue | Outstanding balance on a credit sale whose due date has passed |
| Expected cash (shift) | Opening float + cash sales + cash repayments + cash paid in − cash refunds − cash expenses from the till − cash paid out |
| Variance | Cash counted − expected cash (negative = short) |
| Mobile money / card expected | Non-cash sale payments + credit repayments by that method − refunds paid out by that method, in the period. Staff without sales reports see only what they recorded. Transaction IDs used more than once (ignoring case and all spaces) and received payments with no ID are flagged. Amounts are as entered at the till, not confirmed by the provider |

A returned item that is not sellable is refunded to the customer but not
restocked; its cost leaves COGS and appears under losses as "Returns not put back in stock".

Accounting periods: once the owner closes a month (Settings → Accounting periods), no sale, refund, expense,
purchase, stock change, repayment, write-off or tax record can be dated in it or earlier. Reopening is a separate,
recorded action with a reason. Reports for a closed month therefore do not change.

Cloud summaries cover synced data only. The admin dashboard shows a warning when
the laptop has reported unsynced changes or has not synced in 24 hours.
