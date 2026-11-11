# Mansora workflow redesign — review draft

Open `index.html` in a browser. It is self-contained, including its font, and works without a server. Start with one of the nine journeys or use the screen selector. Sample transitions do not save records, upload files, send emails or move money. This is a proposed design, not the deployed application.

Figma file: https://www.figma.com/design/v272eth6TmpQslxG10r8Cf?node-id=5-21

## What exists

- **27 editable client screens in Figma**, backed by scoped colour variables, DM Sans text styles, reusable navigation/metric/row components and imported Simple Design System button/field instances.
- **64-screen local review draft**, including administration, responsive layouts, onboarding, operational tools and recovery/confirmation states. The local renderer uses the same authored layout scripts; it is a review counterpart, not an export from or proof of the remaining Figma canvas.
- The local prototype has 592 resolved destination references. Browser acceptance passes all 64 screen selections and nine complete sample journeys, with no uncaught browser exceptions. These are design-prototype checks, not tests of real financial processing.

## Figma completion blocker

Figma rejected the next mutation with: “You've reached the Figma MCP tool call limit on the Starter plan.” `whoami` confirmed the connected Starter plan. No further edits were attempted. Administration/responsive/additional-state scripts and prototype wiring remain staged locally; they are **not yet in Figma**. More MCP access must be enabled before that work can finish. Do not describe the file as a complete or fully linked prototype.

## Remaining native work

1. Resume the same file/session from `source/figma-state-ledger.json`; inspect current pages before any retry.
2. Apply the pending screen scripts with the Figma skills and correct page context. The ledger distinguishes actual Figma IDs from local prototype IDs.
3. Update the initial client-screen actions: Clear basket instead of unsupported Hold sale; dedicated add-customer/staff forms; sales report separately from gross-profit report; admin settings/help stay in their own plane.
4. Wire the actual native destinations after creating their frames. Keep same-page prototype navigation within the page; use explicit prototype links for cross-page entry points if Figma requires it.
5. Visually verify the table alignment correction, mobile geometry and remaining screens; inspect the final native prototype. Local review is not a substitute for native final QA.

## Design intent

The owner rejected the deployed C24 layout as cluttered/basic and its workflows as difficult to use. This proposal changes the information architecture: five task areas, one primary action, purpose-specific checkout/inventory/reporting layouts, stepwise file validation and payments, nearby cost/margin context, explicit permissions and clear outcomes. Purple/gold branding remains, with a dark plum rail, warm neutral surfaces and restrained depth.

Financial definitions, authorisation rules and production APIs have not been changed. Implementation follows design review and must retain the actual engine’s validation, audit and permission boundaries. Some interactions are deliberately fixed examples; a self-link in a secondary control does not imply that every control or calculation is implemented.

The `source` files are resumable design-generation material for the existing workspace. The browser prototype and images are portable. The renderer/check scripts retain workspace paths and are not advertised as a standalone application build.

Font: DM Sans, SIL Open Font License 1.1; licence is in `assets/OFL-DM-Sans.txt`. Native Figma button and field discovery uses Figma’s Simple Design System library; no flattened screenshots were inserted into the editable design.
