# Client UI and content readiness — work in progress

The owner requested a complete client-readiness pass, beyond a demonstration
or visual redesign. Work is on `codex/C14-client-readiness`, based on C13 so it
contains the combined hardening, retail features, interface preview and UX work.
The default branch does not yet contain these open review PRs.

## Current publication state

The hosted private interface preview currently shows C13 (Site version 3). The
C14 pass is being pushed for source review before publication. It is not yet
deployed or accepted. Claude should review this branch rather than assuming
that an older screenshot, default-branch checkout or previous CI result covers
this work. The hosted sample preview remains distinct from the actual desktop
application and its persistent encrypted records.

## Findings being addressed

| Finding | Change in this branch | Acceptance evidence |
| --- | --- | --- |
| New owners have no coherent setup journey | Owner Getting started page based on actual profile, stock, staff, backup and sync records; first-use dashboard prompt | Acceptance test pending |
| Old results can remain visible under a changed date/search | Request-keyed reads discard stale results and late responses on both interfaces | Failure/late-response test pending |
| Many failed reads have no recovery path | Query-specific loading/error/retry views for lists, details and reports | Failure/retry test pending |
| Invalid amounts can look blank and become zero | Native amount validity and primary-action checks; required cost and plan amounts | Invalid-money test pending |
| Fractional quantities silently round down | Explicit whole-unit validation in receiving, counts and checkout | Whole-unit test pending |
| Leaving a page or edited dialog loses work | In-memory draft registration, discard confirmation, unload protection and guarded sign-out | Draft/navigation test pending |
| Saved client creation can trigger an unsaved warning | Explicit post-save navigation bypass after the API confirms creation | Provider flow test pending |
| Long tables render every row; capped data appears complete | 50-row pagination, selected sortable columns and explicit loaded-result limits | Long-list test pending |
| Checkout cannot find a customer beyond the first matches | Customer search with selected-customer preservation | Checkout test pending |
| Out-of-stock tiles ignore the owner's existing negative-stock setting | UI follows the existing setting; ordinary overselling/invalid quantities block payment | Policy-alignment test pending |
| Failed writes vanish from view | Persistent dismissible errors and duplicate-click protection | Failure/retry test pending |
| Client and handover guidance contains outdated claims | Content reconciliation in progress; hardware/commercial/privacy checks remain human verification | Content review pending |

## Verification so far

Type checking passes. The existing eight desktop-workflow browser tests pass
after the test explicitly discards a finished import preview before signing
out, matching the new protection. The earlier baseline run exposed a false
unsaved warning after provider client creation; this is fixed and is being
retested. No old assertion or timeout is removed or weakened.

Full regression, accessibility, real client-journey evidence, preview generation
and updated publication are still pending. This report will be replaced with
verified results and remaining acceptance limits before handoff. No production,
hardware, legal or signing acceptance is implied.
