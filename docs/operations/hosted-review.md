# Hosted review and custom domain — 11 November 2026

Baseline `b253cfd`: all 265 tests in 38 files passed with Chromium, no skips;
type checking, builds and dependency audit passed (zero known vulnerabilities).
Live exploration covered 46 page/navigation states across the public sample and
Railway sign-in pages, without uncaught JavaScript exceptions or HTTP failures
during the completed browser pass. Authenticated business journeys used local
throwaway stores, not live customer data.

The custom address is https://app.mansora-consulting.com. Railway domain ownership
and certificate are verified, targeting the existing Mansora service on port 8080.
Vercel holds an explicit `app` CNAME to the target supplied by Railway and the
Railway ownership TXT. Existing apex, wildcard, mail and verification records
were preserved. `STAGING_ORIGIN` uses the custom HTTPS origin; deployment
`94ce4d1b-544b-4ff0-9894-bc60b6b5d886` succeeded. Chromium opened the landing page,
both shop sign-in screens and administrator sign-in without page/HTTP errors.
Custom-origin app-state requests succeed; an unrelated origin receives 403.
The former Railway address remains for diagnostics; use the custom address for
interactive work because request-origin checks use that canonical address.

The review found missing language/viewport metadata in the walkthrough and a
forced 600px minimum width in the phone preview. The C26 change adds a compact
expandable navigation control below 600px, removes the preview minimum width,
and supplies complete walkthrough document metadata. A generated-preview browser
test covers navigation, Escape/focus return, desktop resizing, horizontal
overflow, accessibility and screenshot dismissal.

Remaining acceptance: real Resend/Paystack provider verification, physical
Windows/scanner/printer/cash-drawer checks, legal/business decisions, and large
report performance. The existing performance report records annual sales p95
around 9.1 seconds; that benchmark was not rerun in this review. No full
penetration-test or production-readiness claim is made.
