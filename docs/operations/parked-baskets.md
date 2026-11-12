# C41 — parked baskets and quick keys

Park basket (F4) stores an unsubmitted draft for the current business/user in this browser process. F6 opens the parked list; F2 focuses the barcode/search field; F9 opens payment only when quantities, stock and the current basket are valid. Visible buttons provide the same actions on phones.

Parking never creates a sale, payment, stock reservation, ledger entry or engine command. The engine remains the sole financial/idempotency authority. Drafts keep the original sale identifier, item quantities and requested discounts, plus minimal product/customer display data. They never hold payment input, supervisor credentials or cost fields. Up to ten drafts are allowed per scope. Closing/reloading the tab loses these in-memory drafts; a before-unload warning is registered. Sign-out/session loss clears all parked data. They are not an offline backup or a cross-device hold/reservation system.

Resuming requires an empty current basket and consumes the draft only after current active products/prices/stock are fetched. If a product is renamed/unavailable beyond the current supported lookup, the draft stays parked with a clear message; no line is silently dropped. Quantities/discount requests remain subject to current validation and approval at payment. Old prices are not silently charged. A failed/unmounted resume cannot consume the draft. Barcode scans are serialized; parking/payment wait for pending scans, and resetting the basket invalidates late scan results.

A resumed draft is removed atomically from the parked store; duplicate resume cannot create a second active draft. Completing it sends its preserved identifier to the existing idempotent sale command. Explicit discard confirmation removes only that unfinished draft, with no stock effect.

Validation: meaningful browser checks cover no-write parking, navigation survival, changed-price refresh, one actual sale/stock decrement, unavailable-product resume preservation, confirmed discard and sign-out clearing. Unit checks cover user/business isolation, one-time consumption, copy isolation and the ten-draft bound. Existing retail-pricing and accessibility checks remain unchanged. Exact full-suite/CI and rollout results belong in the task-board handoff after observed completion.

Completion review (2026-11-12): checkout quick keys are inactive while a dialog is open, so F9 cannot open payment behind the parked-basket review. A real browser regression reproduces the previous nested payment and verifies the guard without a sale or stock movement.
