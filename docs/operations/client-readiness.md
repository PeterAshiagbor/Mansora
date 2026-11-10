# Client UI and content readiness

C14 is an acceptance pass against the real desktop engine and cloud API, including
Claude's merged subscription billing application. It adds owner setup, recoverable
read failures, safer forms, draft protection and useful report exports. It does not
constitute hardware, live-payment, legal or commercial acceptance.

## Publication and source

PR #26 merged into default as `86f4c03` after all PR checks passed. Merged-commit CI passed.
The shared sample preview now shows C14 and billing (Site version 6);
C18 and C19 source merges and publication are complete. The preview uses isolated synthetic fixtures and
is distinct from the persistent encrypted desktop application. The default branch and the refreshed hosted preview contain C14.

## Changes and acceptance evidence

| Finding | Implemented behavior | Evidence |
| --- | --- | --- |
| No coherent owner setup journey | Getting started reads actual stock, staff, backup and sync status; separates setup from human sign-off | Fresh-owner browser journey |
| Results can belong to an old date/search | Request-keyed reads clear previous results; ignore late responses | Failed read, retry and delayed response browser scenarios |
| Failed reads leave an empty or misleading screen | Loading, error and Retry views on lists, details and reports | Report failure/retry and existing workflow tests |
| Blank/invalid amounts become zero | Native money validity; product cost and plan amounts required; zero must be intentional | Invalid-cost and invalid mobile-money browser scenarios |
| Fractional item counts are silently rounded | Whole-item validation in receiving, stock counts and checkout | Reject 4.5 receiving, 7.5 count and 1.5 basket quantity |
| Leaving an edit loses work | Guarded page changes, dialog dismissal, sign-out and browser unload; explicit Keep working/Discard choices | Dirty product, basket, settings and import workflow scenarios |
| Read-only dialogs warn about unsaved business data | Receipt and backup verification do not register credential inputs as business drafts | Refund and encrypted-backup workflows |
| Saved client creation warns on navigation | Navigate after confirmed save without a false discard prompt | Existing real administrator workflow |
| Long tables obscure useful records and scope | 50-row pagination, selected sortable columns and explicit query caps | 61-product pagination and price sorting |
| Customers beyond initial results cannot be selected | Search reaches beyond the first 500; selected identity survives a new search | Sale saved to the correct customer from a 501-customer fixture |
| Failed checkout loses context | Persistent error, preserved tender and retry; blocked duplicate action while pending | One refused request then one saved sale; database verifies receipt/stock |
| Printing exports only the visible table page | Report Print/PDF includes every loaded row, heading, date/scope and repeated column headers | 61-row report unit check; HTML escape check |
| Handover content overstates readiness | Updated cashier, onboarding and handover guides; schema inventory includes billing migration 4 | Documentation review and executable inventory gate |

## Verification

The full regression passes: **220 tests in 31 files**. Typecheck and build pass.
The targeted 12 desktop-workflow/accessibility tests pass, including all 22 owner navigation
pages and 11 administrator navigation pages at normal and 200% equivalent viewport.
No test assertion or timeout has been removed. The keyboard test explicitly
confirms discarding its deliberately staged basket before changing page.

The nine new browser acceptance scenarios use the real engine/API and saved
records. They cover setup, receiving and average cost, payment failure/retry,
stock counts, report errors and late responses, draft protection, customer search,
and pagination/sorting. Local evidence is in
`/workspace/mansora-client-readiness`: five screenshots and `client-workflow.webm`.
These files contain synthetic records and are not client production evidence.

The walkthrough screenshots in `docs/screenshots` were regenerated from the
running application, including client billing and administrator collections,
invoices, payments, reconciliation and reports. Capture credentials are generated
per run. The separate legal inventory gate passes with 235 newly documented billing
columns. Production dependency audit reports zero vulnerabilities.

## Limits requiring client handover

- Draft protection is in memory; it does not recover work after app termination,
  forced logout, operating-system failure or session expiry.
- Exports contain all loaded results, not every historical record beyond a query
  cap. The interface identifies caps and date/search scope.
- Actual Windows hardware, receipt printer, scanner, cash drawer and replacement
  laptop restore need a witnessed rehearsal. CI packaging is unsigned.
- Provider keys, live webhook verification, hosting, outbound IP and email sender
  choices remain owner/operator work. Sandbox billing does not charge real money.
- Retention, privacy, tax, cancellation and non-payment policies remain draft or
  unapproved; inventory coverage does not establish legal approval.
- C14, C18 and C19 have green merged-commit CI. The shared Site deployment
  succeeded; exact source/version is in the interface-preview record.

The owner clarified that readiness means an interface ready for deployment.
[C19 interface acceptance](interface-deployment-readiness.md) tracks the focused
billing UI recovery, validation and draft refinements following this C14 record.
Hardware and legal release steps are separate from that interface acceptance.
