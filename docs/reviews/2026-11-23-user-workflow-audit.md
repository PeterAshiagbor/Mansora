# User workflow audit — 23 November 2026

## Scope

Review of the administration and client applications, with browser workflows against disposable shops and real local engines/APIs. The suite exercises onboarding, account setup and recovery, staff permissions, catalogue and imports, purchases and stock, sales and split payments, refunds, shifts, customer credit, reports and exports, Ghana VAT records, subscription billing, reconciliation, offline sync, backup and restore, accessibility and mobile navigation. Tests use synthetic data and sandbox providers; this audit creates no live client sales or GRA filings.

This review includes the concurrently merged [demo walkthrough fixes](2026-11-23-end-user-walkthrough.md) from PR #110 (`d37a850`), preserving payment keyboard handling, approval retry behavior, navigation visibility and additional required-field guidance. The combined source is rebuilt before final verification.

## Findings and changes

| Finding | Change and validation |
| --- | --- |
| Import could classify new products but skipped existing matches. | Add an optional default classification for blank cells and an explicit option to update matching existing products. VAT-only files need a unique Name, SKU or Barcode and classification; prices are optional for existing matches. Preview distinguishes new products, updates, skipped rows and errors. Import result, history and audit record update counts. |
| Users needed to open each product after import. | Products now offers selection, a “Needs VAT classification” filter and “Bulk update VAT”. Select all explicitly covers loaded matching products (maximum 1,000); use narrower searches or spreadsheet updates for larger catalogues. |
| A bulk operation could overwrite an intervening edit or match the wrong product. | Require product-management permission and a reason. Validate all selected product versions before updating. Bind spreadsheet confirmation to reviewed product versions and classifications. Reject conflicting identifiers and repeated existing targets. Transactions preserve atomicity; stale reviews require a fresh preview. |
| Reusing an original stock file for classification could risk duplicate stock. | Existing matches receive VAT classification changes only. A separate update-operation identity allows a previously imported file to classify existing records once; retries are refused. Original prices, stock and invoice tax snapshots are preserved. |
| A shared email for a business owner and a Mansora administrator was ambiguous. | Add an account-type selector to sign-in. Explicit business/admin selection resolves the intended identity before checking its password. Automatic ambiguity still fails closed. Existing scoped sessions, TOTP and passwords are preserved. |
| Conditional required inputs were harder to discover when sections changed visibility. | Refresh required-field feedback when sections open or change visibility. Mark GRA deregistration authority as required for a manual cancellation of registration. Existing subtle red outlines and completion summaries remain shared across forms. |
| Ordinary import confirmations changed unnecessarily with the new update counts. | Preserve the existing ordinary-import confirmation; show VAT-update counts when classifications actually change. Verify ordinary and VAT-only browser paths. |

Stock additions already require a classification while VAT collection is legally effective and enabled. The audit retains coverage for product opening stock, receipts, positive counts/adjustments and import opening stock; pre-effective/disabled collection and refunds against original records retain their supported behavior.

## How owners use bulk VAT

- During import: map the VAT classification column, or choose a default for blanks. To change existing products, enable the matching-products option, supply the reason and review the update count before confirming.
- After import: open Products, search/filter, select the appropriate products, choose Bulk update VAT, select the reviewed class and enter a reason. Different legal treatments require separate selections or row-specific spreadsheet values.
- Classes are `standard`, `zero`, `exempt` and `outside`. Applying a class is an owner decision based on the product's legal treatment; the software does not establish legal eligibility.

## Verification

Executed against the combined, completed production build:

- `npm run typecheck`: passed.
- `npm run build`: passed for desktop renderer/Electron, administration and API.
- `npm run test:verified`: **599/599 tests passed across 120 files**, zero failures/skips/todos, executed Chromium browser assertions and PDF text verification (494.02 seconds).
- `node --test infrastructure/*.test.mjs`: 3 passed.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.

The full run includes both ordinary imports and VAT-only updates, mobile bulk selection, concurrent-edit rejection, immutable original receipt snapshots, account-type routing and the existing stock-classification checks. The older product-cell browser locator now selects the exact product cell, distinguishing it from the newly labelled selection checkbox. Release CI repeats build and regression checks and separately verifies the packaged Windows shell; deployment status is checked after publication.

## Practical limits

This is a software workflow and regression audit. Sandbox payment tests do not establish real settlement, and automated tax tests do not establish GRA certification or correctness of a particular client's filing. Physical printers/scanners, real provider credentials, taxpayer evidence and external GRA approval/submission require their own operational checks. Local transaction tests do not alter production financial records. Hosted release checks verify availability and the shipped interface after deployment.
