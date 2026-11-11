# Progressive interface plan

The owner wants the breadth of the platform without showing every tool at once.
This is a presentation change; no feature, role permission or financial rule is removed.

1. **Daily work first.** Owners/managers start with Dashboard, New sale, Products,
   Customers and Reports. Cashiers start with Dashboard, New sale, Sales history,
   Cashier shifts and Products. Administrators start with Overview, Clients,
   Collections, Invoices and Payments. Only permitted pages appear.
2. **More tools when needed.** Less frequent tools sit in expandable groups under
   More tools. One group opens at a time. Selecting a secondary page reveals its
   location; returning to a daily page closes the extra navigation. Find a page
   and Ctrl/Cmd K still search every permitted feature.
3. **Summary before breakdown.** The client dashboard shows its headline figures
   and five recent transactions. Sales charts, payment mix and low-stock lists
   appear on request under Daily breakdown. The platform overview similarly
   separates attention items from onboarding/plan detail.
4. **Essential product entry.** Name, barcode, selling/unit cost and opening stock
   remain visible. Carton calculation and optional identifiers/category/reorder
   settings expand when needed. Collapsing a section retains entered values;
   invalid hidden fields are revealed before validation focuses them.
5. **Contextual secondary actions.** Export/print controls share one menu rather
   than competing with Add product and other primary actions. Escape and outside
   clicks dismiss the menu; full exports keep their existing loaded-row scope.

Verification uses actual expansion/search/navigation actions, not hidden or forced
clicks. Role tests inspect the complete permitted page set (including collapsed
sections) so hiding a feature cannot masquerade as permission enforcement.
Dedicated browser checks cover discoverability, lazy dashboard breakdowns, retained
form values, hidden-field validation, exports and cashier visibility. Existing
workflow and accessibility assertions remain intact.

Implementation passes typecheck/build and **237 tests in 33 files**, including
six new progressive-interface acceptance scenarios and accessibility scans at
normal and 200% equivalent viewports. Walkthrough screenshots were regenerated
from the running application. PR #30 merged as `c07b25e`; all four workflows on that merged commit passed.
Public sample version 7 is live at the existing shared URL. Hosted-browser QA remains
unverified because the managed browser helper is unavailable; the real application
was exercised locally.
Persistent team staging is separate task C20; the shared Site remains an isolated
sample preview until a real server-backed environment is deployed.
