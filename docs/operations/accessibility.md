# Accessibility checks

C5 review, 2026-11-10. Automated and visual checks used Linux Chromium, the real encrypted desktop engine, and the local embedded PostgreSQL API. This is a scoped engineering check, not a WCAG certification or a hardware acceptance result.

## Coverage and results

`tests/e2e/accessibility.test.ts` runs axe-core and fails on every serious or critical violation without disabling any rule. The browser CI job installs Chromium and builds both interfaces; core-only jobs retain the existing browser-test convention of not running browser suites without Playwright/build artifacts. Local verification executed the browser suite, including existing browser tests.

The scan visits all 19 desktop navigation pages, every tab on those pages, the open-shift screen and sign-in screen; every administrator navigation page (Overview, Clients, Service plans, Audit log, Account security), administrator sign-in and client detail. It also scans product, category, customer, staff, stock-receipt, supplier, expense and payment dialogs, and administrator add/edit-client and add-plan dialogs. The fixture includes a long unbroken product name and SKU to force intrinsic table widths and a low-stock state. Test records and credentials are synthetic; credentials are generated at runtime.

Every navigation page is checked at a 1366 × 768 CSS viewport and a 683 × 384 CSS viewport, representing the layout viewport available at 200% desktop browser zoom on that display. This is viewport-equivalent responsive testing, not a claim that Chromium's native zoom UI, Windows display scaling or Electron zoom was exercised. Representative forms are also checked at the smaller viewport. The scan checks that the main content does not overflow horizontally; wide tables scroll inside labelled, keyboard-focusable regions.

Four new browser tests pass with zero serious/critical axe violations. Screenshots of Checkout, Products, the product dialog and administrator Overview were visually inspected at the smaller viewport. Checkout product selection and basket remain reachable by scrolling, navigation scrolls, and form footers remain reachable in the dialog overlay. Optional `MANSORA_A11Y_SCREENSHOTS=/path` saves those synthetic screenshots during the test.

## Fixes

- Modal focus keeps the React autofocus target, otherwise selects the first field; it captures the trigger before mounting fields and restores focus when the trigger remains connected. Tab/Shift+Tab wrap, including table rows with a nonnegative tabindex; disabled/hidden controls are excluded. Escape acts on the topmost modal and uses the current close handler.
- Interactive table rows support Space and Enter, with visible focus. Child controls do not trigger the row keyboard handler. Tables have screen-reader captions: explicit caption when supplied, otherwise their containing card title, otherwise their column names. Scroll regions have a short navigation label and keyboard focus; the table caption describes the contents.
- Tabs use a single tab stop, selected state, arrow keys, Home and End, and an accessible group name. Field labels, hints and validation errors are programmatically linked to controls; errors set `aria-invalid`.
- Unnamed onboarding progress bars now have a name. Muted text and step numbers were darkened to meet the scanned 4.5:1 text-contrast threshold, including on slate page backgrounds. Buttons, links, interactive rows and scroll regions have explicit keyboard focus outlines.
- Low/out-of-stock badges now include text rather than relying on colour. Variances retain signed numbers and labelled context; sync indicators retain state text alongside their coloured dot.
- Checkout stacks products and basket below the desktop breakpoint. Date controls wrap, card actions wrap, administrator navigation scrolls and long statistic labels wrap. Wide tables keep their own horizontal scrolling. Cards and statistics permit grid/flex shrinking, including stock-report cards whose table otherwise contributes an intrinsic minimum width on CI fonts.

Keyboard interaction checks exercise table Space activation, modal initial focus, Shift+Tab/Tab boundaries, Escape and return to the triggering row, plus tab arrow/Home navigation. The existing cashier test now explicitly waits for the login screen after activation before filling credentials: linked field labels make activation and login names identical, so this prevents filling the activation fields before the transition finishes. No existing assertion or timeout was removed or relaxed. Existing browser tests also exercise the main cashier, refund, administrator MFA and consent flows. These checks cover shared controls and representative workflows; they are not an exhaustive manual review of every conditional record/dialog state.

## Remaining checks

**Windows NVDA screen-reader testing: not done.** A person using NVDA should verify reading order, field descriptions, table captions and row actions, tab announcements, modal announcements and focus return in the packaged Windows app. Also pending: Windows high-contrast/forced-colour mode, native browser/Electron zoom and OS scaling, other screen readers, touch targets on physical devices, and representative shop data with unusually long names or very large tables. Those checks need the corresponding runtime or hardware and must not be inferred from a passing axe scan.

## Combined review branch

The integration review additionally scans the C6 client audit tab and laptop
deactivation dialog at both viewports, using the C11 purple/gold palette and
locally bundled fonts. It preserves all C5 keyboard and contrast checks.
