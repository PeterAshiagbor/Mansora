# Client and sales lane — ownership and execution handoff

The owner asked this workflow/review session to take the outstanding Codex lane and implement the four C30 corrections. This session owns **Codex session 2**. The Platform session retains scripts/staging, scripts/railway, C36–C38 and C48/C49. Claude retains financial engine/sync/billing contracts. Keep the current visual system.

| Order | Task | Implementation and acceptance |
| --- | --- | --- |
| 1 | C40 support contact and recovery guidance | Administrator-managed public contact; Help, Settings and sign-in use it. Staff/owner guidance stays separate; no reset without existing identity proof. Anonymous users cannot change contact; unsafe links refused; offline state is explicit. |
| 2 | C41 parked baskets and quick keys | Renderer-only, business/user-scoped drafts; preserve sale ID across parking/resuming, recheck current product/stock data, never store entered payment or approver credentials. Existing engine remains the commit/idempotency authority. |
| 3 | C39 demo requests and Leads | Bounded, rate-limited public intake; platform-only admin list/status, escaped UI, no automatic outgoing mail. Separate from the corporate website repository. |
| 4 | C50 customer WhatsApp sharing | Explicit user action opens wa.me; receipts, debt reminders and statements use authorised existing reads. Do not send automatically, guess a recipient or add a provider. |
| 5 | C35 first-client billing walkthrough | Execute existing runbook against disposable sandbox and fix documentation/interface gaps; no real charge/email. |
| 6 | C51 interface for new quantity/pack/price/tax/credit contracts | Start each slice only after Claude's engine contract merges; never simulate unsupported financial behaviour. |
| Last | C42 board housekeeping | Preserve active claims and owner questions, move completed historical evidence to docs/archive, retain links. |

## Four review fixes

F01/F02 were implemented by Claude in #47; F03/F04 by Platform in #46. Both are now merged. The local C30 reproduction was rerun on the integrated code: November/December client and service amounts reconcile; impossible and reversed report ranges both return 400. Runtime wiring shares `apiRuntimeOptions`, including sanitized logging, configured metrics/webhook/trusted proxies and the existing S3 factory with `/data` fallback. Independent remote-storage provisioning and recovery drills remain C38, not completed by changing an option.

## C40 implementation

Support contact settings live under the separate `public_contact` key in the existing platform settings store. This changes no invoice/non-payment settings and requires no released migration edit. Only an active administrator session can edit them. Changes are audited without copying contact values into audit metadata. The read endpoint deliberately publishes these business contact fields to everyone, including native clients; never place private contacts or credentials there.

Client browser builds use the same-origin `/api` endpoint. A packaged native renderer may use a build-time `VITE_PUBLIC_API_URL` pointing to the public API base; absent configuration or connection, it tells users to use their invitation/service agreement. It does not silently invent an email or phone number. Native public contact GET permits cross-origin reads; admin changes still require authenticated routes. No bridge or password policy changes.

The operator finds **Support contact** under Administration. Help and Settings expose Contact Mansora; sign-in exposes recovery guidance. Existing owner recovery remains available. Staff ask their business owner; owners follow the verified Mansora recovery process. No email is sent by these contact buttons; opening mail/phone/WhatsApp remains the user's action.

## Mobile scanner request

The owner additionally asked for a real mobile scanner for purchases/stock, sales and expense receipts. Add a separate mobile-capture slice after the committed lane work: HTTPS camera barcode decoding plus manual/HID fallback; review product identity, quantities and purchase cost before existing commands; attach original expense receipt images with scoped durable storage; optionally extract text into a review form. No automatic posting or payment confirmation from a barcode/image. Camera permission, denied/unsupported states, repeated-frame duplicate handling and actual Android/iPhone acceptance are required. OCR/provider choice, receipt retention and storage capacity must be explicit; do not claim OCR or physical-phone reliability from desktop browser mocks. This is a mobile web feature, not a new native-app redesign.
