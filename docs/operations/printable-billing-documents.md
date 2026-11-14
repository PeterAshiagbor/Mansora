# C17 — printable invoices and receipts

Invoice and receipt documents use the existing authenticated billing endpoints. The client already offers **Save PDF** and **Print**: packaged Electron uses its existing native PDF/print bridge, while the browser opens its print facility. Administrators open the printable document and use the browser's Print menu to print or save a PDF. The original C17 scope allows keeping HTML printing when server-side PDF would need a heavy dependency; this change adds no production PDF dependency, server renderer or new endpoint.

Documents now declare A4 with print margins, repeat item-table headings across pages, avoid splitting ordinary rows and keep the totals block together. Long notes, references and payment URLs wrap within the page. The existing Mansora purple/gold palette is used with a white print background. A short screen-only print hint is omitted from printed/PDF output. Issuer details, including a configured TIN, appear on invoices and receipts. Draft and sandbox context remain visible without repeating a draft badge.

Document numbers, calculations, allocations, payment/refund amounts and issuer configuration are unchanged. Existing authentication and client tenant checks remain. Missing invoice/receipt records now return 404 instead of causing an internal server error. HTML remains script-free, uses no external resources and escapes supplied text.

## Verification

The new real-API/Chromium test creates a synthetic 100-line issued invoice and a provider-sandbox receipt. It verifies A4 PDF media boxes, multiple pages, repeated headings, all lines including the last, issuer/TIN/document identifiers, figures and a totals block that stays on one page. Poppler extracts the actual PDF text; source invoice/payment data is compared before and after document reads. Tests also cover escaping, no external requests, unauthenticated/cross-tenant access and missing records.

The dedicated **Printable billing documents** workflow requires PDF text extraction and runs these tests against provisioned Chromium. Full-suite runs also generate PDFs; when Poppler is unavailable there, the dedicated job remains the required text-content evidence. No real payment, customer data or outgoing email is used. Test PDFs are synthetic and are not published as CI artifacts.

Before the change, the tests reproduced Letter-sized PDFs and 500 responses for missing records. Local fixed tests pass, with a five-page A4 invoice and one-page sandbox receipt visually inspected. Final regression/CI evidence is recorded in the PR and collaboration log.

This verifies Chromium output. It does not certify legal invoice requirements, paper/printer hardware, user-selected print settings or a newly tested Windows save dialog. The Electron bridge itself is unchanged.
