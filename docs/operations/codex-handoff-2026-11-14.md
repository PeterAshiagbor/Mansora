# Codex handoff, 2026-11-14

The owner asked for these tasks to go to the two Codex sessions. Claim each on the board (`docs/codex-tasks.md`)
before starting, work on the branch named there, and open a PR to `claude/relaxed-lovelace-0179ut`.
The engine (`apps/desktop/src/core/**`), sync contract and API modules belong to Claude: if you need a new command,
describe it in your PR instead of adding it.

Base your work on the default branch after PR #67 merges (it adds camera scanning, the Needs reordering tab, supplier
history and the guides you will link to).

## Codex session 2 (Client and sales surface)

### C61 Consistent colours across displays (start here)
Why: shops use bright laptops, cheap Android phones and screens in daylight. Colours must read the same way on all of them.
1. Collect every colour in use: `packages/ui/src/**`, `apps/desktop/src/renderer/**`, `apps/admin-web/src/**`,
   `apps/desktop/src/renderer/styles.css` (Tailwind classes such as `text-slate-500`, `bg-amber-500`, and any hex values).
2. Define one token set (text, muted text, surface, border, brand, and good / warn / bad / info, each with text and background)
   in one file in `packages/ui`, and use only those tokens in both apps.
3. Add a test that computes WCAG 2.2 contrast for every text/background pair the tokens allow, and fails below 4.5:1
   (3:1 for large text and icons). Muted text on white must pass too: `text-slate-500` on white is close to the limit.
4. Make sure no status depends on colour alone: badges carry a word, dots in the status bar carry a label.
5. Take screenshots of Dashboard, New sale, Stock and the admin Overview at: 1366×768 laptop, 360×800 phone, and with a
   simulated dim screen (CSS `filter: brightness(0.7) contrast(0.9)`). Attach them to the PR for the owner.
Done when: one token file, no stray colours (add a lint or test that finds them), the contrast test passes, screenshots in the PR.

### C57b Printable barcode labels
From **Products**, select products and press **Print labels**: an A4 sheet (3 columns × 8 rows) showing the product name,
price and an EAN-13 barcode. Products without a barcode: offer **Assign a barcode**, which saves an in-store EAN-13
(prefix `200`, check digit computed as in `apps/desktop/src/core/sample-shop.ts`) through the existing `product.save`.
Draw barcodes as SVG in the renderer (no new runtime service). Print through the existing `printHtml`.
Test: a label's barcode scans back to the product with `product.lookup` (unit test on the digits), and an e2e test prints a sheet.

### C60c Reorder list into a purchase
On **Purchases & suppliers → Needs reordering**, let the user tick rows for one supplier and press **Receive these items**,
which opens the existing Receive stock dialog prefilled with that supplier, those products and the suggested quantities
(all editable). Uses `stock.reorderList` and `purchase.receive` only. Add an e2e test.

## Codex session 1 (Platform)

### C66 In-app help
A **Help** page that lists and shows the user guides from `docs/user-guide/` (cashier, owner, who-can-do-what,
scanners-and-printers, moving-to-mansora, stock-purchases-expenses), bundled at build time so it works offline.
Link it from the shell's help entry and from empty states: Import (to moving-to-mansora), Suppliers (to stock-purchases-expenses),
Shifts (to who-can-do-what), New sale with no scanner (to scanners-and-printers). Keep Markdown rendering safe (no raw HTML).

### C67 Scanning acceptance on real devices
With a person who has the devices: open the live workspace over HTTPS and try the **Camera** button on New sale and Stock count
on an Android phone (Chrome) and an iPhone (Safari), and a USB scanner on a Windows laptop. Record device models, browser versions,
what worked, how fast, and any problem, in `docs/operations/scanning-acceptance.md`. Record only what was actually tried.
