# C28 — workflow design implemented in the real application

The owner authorised implementing the completed work from the C27 Figma/design draft. The implementation reuses the real React UI kit, engine commands and API; no sample prototype response or illustrative amount is used in application logic.

## Design source

The source is the authored layout scripts, native Figma screenshots and workflow specification retained in `docs/design/mansora-workflows`. The native file contains 27 editable client screens. A fresh Figma-to-code request, including a screenshot request, is still rejected by the account's Starter MCP limit. This release does not claim a new high-fidelity extraction or completion of the remaining native Figma canvas. The owner's instruction authorises proceeding from the saved work.

## Implemented journeys

| Area | Real behaviour |
| --- | --- |
| Shared workspace | Deep plum rail, neutral task surfaces, readable DM Sans, restrained purple/gold identity, preserved local logo/fonts and contextual guides. Both business and operator interfaces share the system. |
| Phone access | A focus-trapped menu replaces the squeezed desktop sidebar. Four permitted quick tasks remain available; selection closes the menu. Search, secondary tools, sign-out and keyboard escape remain available. |
| Dashboard | Headline sales/credit stay visible; actionable stock, repayment and report links sit beside the recent-sales list. Detailed reports remain opt-in, avoiding an unnecessary heavy read at entry. |
| Checkout | Dedicated product finder and basket, guided payment/receipt progress, focused cash/mobile/card/credit/split entry. Positive entered amounts remain visible across method changes; no hidden tender is discarded. Existing settlement, idempotency, unsaved-basket and approval checks remain. |
| Product pricing | Cost, selling price and the real gross-margin calculation stay together. A separate context panel explains carton conversion and auditable stock changes. |
| Receiving cartons | Optional calculator converts received cartons into whole selling units and rounded per-unit pesewas. It previews the recorded cost and rounding difference before applying values to the actual purchase form. Only Receive into stock records a movement. |
| Excel import | Choose/check/import progress, optional column matching, busy state, invalid-replacement preview clearing, retry and a completion result taken from the actual commit response. Duplicate and physical-opening-stock checks remain. |
| Customers | Direct access between the directory and repayments; repayment review shows the remaining balance without changing it before confirmation. |
| Reporting | Entry starts with a business question and fetches no financial report until selected. Existing summaries, date presets, tables, definitions and exports remain, with an All reports route back. |
| Setup and settings | A selectable checklist opens one setup task at a time; status comes from actual records. Related staff, subscription, backup and audit tools are permission-filtered. |
| Operator workflows | The shared shell/sign-in and compact overview apply to existing client, consent, collections, invoice, payment and security functionality. Billing logic is preserved. |

The 64 design-review frames represent tasks, variants and outcomes, not 64 independent production routes. Real dialogs, guarded navigation, progress states and toasts implement the corresponding journeys. Prototype-only Hold sale is not introduced; the actual basket-clear confirmation remains. Financial defaults, approval policy, billing providers, database schema, sync durability and protected engine files are unchanged.

## Validation and rollout

The PR/task-board handoff records exact test counts, sources, screenshots and rollout checks. Meaningful new browser scenarios exercise question-led report loading against real records; method switching with split-payment amounts; failed Excel preview replacement followed by a real commit; phone drawer/permission/viewport behaviour; and carton receiving with an actual persisted stock movement.

Existing financial, browser, accessibility, tenant-isolation and provider tests remain. Browser fixtures now follow the new visible task choices before asserting the same financial results. Accessibility still visits every report tab and additionally checks all payment-entry modes.

Native Figma completion still requires more tool access. Real payment/email activation, legal/policy decisions and hardware/signing remain independently tracked; this UI release does not imply those gates are complete. C15 communications and C25/C26 domain/preview work belong to the other active session.
