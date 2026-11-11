# Workflow and interaction specification

| Journey | Entry and progression | Main boundary |
| --- | --- | --- |
| Daily selling | Product finder → basket → payment → receipt → next sale | One clear amount due; preserve refused payment and basket; prevent duplicate submissions |
| Discounts | Request amount/reason → authorised approval → updated amount → payment | Staff request is not permission to grant; retain ceilings, authorisation and audit |
| Carton costing | Carton purchase cost / units → unit-cost preview → confirmed cost → selling price/margin | Sell and track individual whole units; money remains integer pesewas |
| Excel import | Choose file → row issues → corrected preview → explicit import → outcome | Preview never writes; duplicates/errors stay clear; real backend owns validation and ZIP limits |
| Stock receipt/count | Enter delivery or observed count → before/after review → confirmation | Keep purchases, stock movements and counts auditable |
| Customer credit | Customer ledger → repayment amount/method → remaining balance → receipt | Repayment is money against existing debt, not another sale |
| Reporting | Choose a question → select dates → defined results → contextual export | Separate net sales, collections, COGS, gross profit and final profit; never show stale results as current |
| Staff access | Choose person/role → effective permissions → reviewed changes | Hide unavailable tools; owner-only grants remain protected; sensitive actions still require approval |
| Client onboarding | Business details → products → team → test sale | One step at a time; explain what is optional and how to resume |
| Provider operations | Client record → agreed plan → activation → health → invoice → verified payment | SaaS billing stays separate from client retail data; support consent remains explicit |
| Recovery | Specific failure → preserved context → safe retry/cancel | Browser internet requirement differs from installed desktop offline capability |

## Visual contract

- DM Sans, readable body copy and precise, consistent spacing.
- Deep plum navigation; warm neutral canvas; white task surfaces; purple actions and restrained gold identity.
- A compact daily navigation and separate secondary settings/help. Never expose the full feature list at once.
- A dedicated checkout basket, stepwise payment/import tasks and question-led reporting.
- Financial explanations sit next to the figure or decision they explain.
- Mobile prioritises the current task and uses product cards rather than compressing a desktop table.
- Focus, disabled/loading, success, warning, error and empty states are distinct in implementation.

## Fidelity and implementation limits

The Figma canvas currently contains 27 editable screens. The local prototype contains the full staged draft, not a live backend. Financial amounts are illustrative, and sample screen transitions reset to fixed records. Native interactions and final Figma QA remain blocked by the account’s Starter MCP limit. Production implementation, testing and deployment have not been performed for this new direction.
