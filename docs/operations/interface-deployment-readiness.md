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

## Verified interface acceptance

The deployment-interface pass is complete. **231 tests in 32 files pass**, plus
typecheck/build and all PR/merged workflows: PostgreSQL 16 sync, production audit,
Windows packaging/smoke, API container, security/core and generated preview.
Eleven new real-API/browser scenarios verify failed reads and saves, invalid
fields, discard protection, preserved entries, separate drafts, report recovery,
actual printable invoices and focus-safe billing forms. Existing billing,
retail, security, role and accessibility assertions/timeouts were not weakened.
Walkthrough screenshots were regenerated from the running application.

C19 merged through PR #28 (`0ffff1c`) and the final focus fix in PR #29
(`7537e616f9241ef94e60d6d92f98708b0643b733`). The shared preview is **version 6**, deployment
`appgdep_6af3146636d4819188165e39628a84b4` (`succeeded`), built from pushed Mansora
`61716641409048737810e8814efbcd31323d65a2`. Site source: `55bd0a50810841064f90b7eadd4c2762577e6010`.
All 69 output assets were verified before packaging. Sharing is confirmed
public/anyone-with-link; no ChatGPT sign-in is required. This completion handoff
changes documentation only; the verified application and published assets are
unchanged.

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
