# Interface deployment readiness

The owner's acceptance target is a deployable interface: complete navigation,
accurate content, usable forms, clear states and reliable user journeys. Hardware,
provider onboarding, signing and legal release decisions are separate operational
work; they do not stand in for interface acceptance.

C19 completes the billing UI gaps identified after C14. The engine, provider
adapters, financial calculations and permission policies are unchanged.

## Interface acceptance

| Area | Behavior and verification |
| --- | --- |
| Navigation and help | All 22 owner and 11 administrator navigation pages remain available; contextual task guides explain actual actions and permissions. Accessibility scans cover normal and 200% equivalent viewport. |
| Retail/setup journeys | Existing real-engine tests cover setup, product/carton cost, receiving, whole-item sales/counts, payment recovery, stock, customer credit, refunds, shifts, Excel import, backup and relinking. C14 added actual-record acceptance and scoped report exports. |
| Billing reads | Collections, messages, exceptions, attempts, subscriptions, invoices, payments, settlements, provider settings and lookup lists distinguish loading, empty and error states and expose Retry. Failed revenue reads retain date controls and disable exports. |
| Billing forms | Invalid money cannot silently become the default plan fee. Collection intervals require whole days within server-supported bounds. Invoice quantities require positive whole numbers. Field lengths and issuer email validation match the visible workflow. |
| Unsaved work | Settings, settlement-account drafts and editable billing dialogs warn before discard. Read-only invoice/subscription views do not falsely warn after a successful save. Separate account drafts survive a settings refresh. |
| Failed billing actions | Cancellation, payment setup and subscription edits retain their inputs and show the error in the active context. Closing a failed request is an explicit discard choice. Pending actions reject duplicate clicks. |
| Printable documents | Real invoice HTML opens in a separate window with no opener access; blocked popups produce an actionable message. Document-read failures close the temporary blank window. |
| Honest financial copy | Unknown provider capability remains visibly blocked. Invoice revenue is not called profit. For an uncertain manual-payment response, the form advises checking payment history before recording the money again. |
| Shared review | The preview is now anyone-with-link, as requested. ChatGPT users and signed-out visitors can review the synthetic interface. App sessions and demo edits do not grant production access. |

## Evidence

Eleven new real-API/browser acceptance scenarios verify failed reads and saves,
invalid fields, discard protection, preserved input, separate drafts, report
recovery printable invoice behavior and focus-safe billing drafts. They supplement the existing billing,
retail, security, role and accessibility regression tests; no previous assertion
or timeout was removed. The walkthrough screenshots are regenerated from the
running application.

Initial C19 full regression passes: **230 tests in 32 files**, plus typecheck/build
and all PR/merged workflows. A final-review focus/draft fix passes 13 targeted
billing tests; its new full CI includes 231 tests. This
record will identify the verified source and publication at handoff. The last
published preview is version 5; the focus follow-up is published separately.

## Meaning of the preview

The shared preview uses the real interface with synthetic read fixtures and
browser-memory sample edits. It demonstrates screens and content for review;
transactions, uploads, provider/account changes and live collections require the
actual application and backend. That boundary is explicit in the landing page
and toolbar. Hosted browser QA is unavailable in this session because the required
Sites browser tool is absent; repository application browser tests and generated
asset checks are separate verification.

Interface acceptance does not claim a live production backend, live provider
verification, a signed installer, mobile POS certification or human/legal sign-off.
