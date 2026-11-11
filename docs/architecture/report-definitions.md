# Report definitions

All amounts are in Ghana cedis, stored as whole pesewas. "In the period" means
the record's own date falls between the chosen dates, inclusive (UTC = Ghana time).

| Term | Definition |
| --- | --- |
| Sale total | Sum of line totals after line and basket discounts |
| Gross sales | Sum of sale totals for sales completed in the period |
| Discounts | Sum of discounts on sales completed in the period |
| Refunds | Sum of refund amounts for refunds **created** in the period (a refund can fall in a later period than its sale) |
| Net sales | Gross sales − refunds |
| Cost of goods sold (COGS) | Σ quantity × cost snapshot for items sold in the period, minus the same for refunded items that were **returned to stock** in the period |
| Cost snapshot | The product's moving-average cost at the moment of sale; later cost changes never alter it |
| Gross profit | Net sales − COGS |
| Gross margin | Gross profit ÷ net sales |
| Expenses | Sum of expenses dated in the period. Shown beside gross profit, **never subtracted**: the system does not report net profit |
| Payments by method | Amounts applied to sales, by method. Cash excludes change given. "Credit" is the amount sold on credit, not money received |
| Repayments | Credit repayments received in the period, by method. Never counted as sales |
| Stock on hand | Current balance per product = sum of all its stock movements |
| Stock value | Σ max(quantity, 0) × moving-average cost |
| Low stock | Quantity ≤ reorder level |
| Outstanding credit | Sum of unpaid balances on credit sales |
| Overdue | Outstanding balance on a credit sale whose due date has passed |
| Expected cash (shift) | Opening float + cash sales + cash repayments + cash paid in − cash refunds − cash expenses from the till − cash paid out |
| Variance | Cash counted − expected cash (negative = short) |
| Mobile money / card expected | Non-cash sale payments + credit repayments by that method − refunds paid out by that method, in the period. Staff without sales reports see only what they recorded. Transaction IDs used more than once (ignoring case and all spaces) and received payments with no ID are flagged. Amounts are as entered at the till, not confirmed by the provider |

A returned item that is not sellable is refunded to the customer but not
restocked; its cost stays in COGS.

Cloud summaries cover synced data only. The admin dashboard shows a warning when
the laptop has reported unsynced changes or has not synced in 24 hours.
