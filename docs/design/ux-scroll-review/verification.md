# Verification — scrolling and subpages

14 November 2026. All data synthetic. Linux Chromium, real laptop command engine/encrypted SQLite, embedded PostgreSQL and local API. No production accounts, email delivery or payment providers used.

| Check | Observed result |
| --- | --- |
| Baseline build | Passed |
| Baseline real browser workflows | 4 files, 29 tests passed |
| Implementation browser workflows + accessibility | 7 files, 44 tests passed |
| New scrolling/subpage/offline regressions | 4 tests passed |
| Final typecheck and build | Passed |
| Corrected-build cashier → admin journey | 1 file, 6 tests passed |
| Final focused accessibility + scrolling | 2 files, 8 tests passed |
| Full npm test -- --maxWorkers=4 | 78 files / 408 tests: 77 files and 406 tests passed; 2 accessibility scans hit the unchanged 60s timeout under concurrency. No assertion failures. |
| Isolated accessibility rerun | 4/4 passed in 40.44s; same assertions and original 60s timeout |
| Final axe/layout sweep | 108 states, zero serious/critical violations, zero main-content horizontal overflow |
| Sweep runtime | Zero uncaught page exceptions and HTTP responses >=400 |
| Console/network follow-up | 54 states at laptop width: zero console errors, page exceptions, failed requests or HTTP errors |
| Remaining axe findings | 54 state occurrences of moderate heading-order findings and 23 minor empty-table-header findings in the final 108-state sweep. Action headers have aria-labels; visible/hidden header text and assistive-technology confirmation remain follow-up work. |

All 408 unique tests were verified across the full run and the isolated accessibility rerun. The concurrent full command itself had the two recorded timeouts; it is not represented as a single green run. Run the long axe suite separately when this machine is under contention. Raw output: `full-suite.log` and `accessibility-isolated.log`. Typecheck/build logs are included.

## Viewports and keyboard

- 1366 × 768 and 1440 × 900: long catalogue, 12-line basket, independent keyboard scrolling, visible total/Pay and payment opening.
- 390 × 844 and 683 × 384: compact header, readable breadcrumb, client detail sections, local table overflow and modal footer; focusable modal body, Ctrl+End, Escape and background wheel containment.
- Existing accessibility scenarios: all shop pages/report tabs; admin inventory plus details and create/edit dialogs; Space/Enter row activation; modal focus trap/return; tab arrows/Home/End; cashier keyboard checkout and change.
- 683 × 384 represents the layout space available at 200% zoom on a 1366 × 768 screen. Native browser/Electron zoom UI and Windows scaling were not tested.

## Accessibility mapping

This is engineering evidence against relevant WCAG 2.2 criteria, not certification. Automated tools do not establish complete conformance.

| Concern | Related criterion | Fix/check |
| --- | --- | --- |
| Destination focus and context | 2.4.3 Focus Order; 2.4.6 Headings and Labels | Labelled main; committed navigation focus; explicit client detail label |
| Basket/table keyboard scrolling | 2.1.1 Keyboard; 2.4.7 Focus Visible | Named focusable regions and visible focus; real keyboard task tests |
| Compact layout and file input | 1.4.10 Reflow | Header, checklist and input bounds; tables scroll locally |
| Table semantics | 1.3.1 Info and Relationships | Contextual region names and Actions heading |
| Colours/status/forms | 1.4.3 Contrast; 1.4.1 Use of Color; 3.3.1 Error Identification | Existing semantic text/badges, labels and error/retry handling retained; serious/critical axe threshold passes |
| Heading hierarchy, remaining | 1.3.1 Info and Relationships | Top-level/nested Card heading follow-up; moderate axe findings retained |

## Verification limits

No packaged Electron/Windows acceptance, NVDA or other screen-reader acceptance, physical printer/scanner, native zoom/scaling, real PostgreSQL service, real payment settlement or email delivery was performed. Existing Windows/hardware/provider acceptance gates remain. Browser development-host offline behavior is distinct from the hosted browser product.

Figma tools became available during the follow-up. Session creation and metadata reads of the existing file both failed with an edit-access error; whoami confirmed a View seat on a Starter team. No native read/edit succeeded. UI UX Designer dashboard/accessibility/handoff skills were applied. The saved design source was read as repository context.
