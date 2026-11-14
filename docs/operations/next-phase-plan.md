# Next phase plan: what shops will expect (owner request 2026-11-14)

The owner asked for a plan covering the gaps below. **Browser version first.** Everything that needs the
Windows till, a real printer, a cash drawer or more than one till is grouped at the end as the
**offline phase**, to be built and tested on a later date the owner sets.

Order of work: finish the code review fixes and the Ghana legal pack first (Phase 0), so new features start
from a solid base. Then the phases below, one engine PR at a time, each with its screen work and guide
updates in the same PR. Task numbers continue the board in `docs/codex-tasks.md`.

## Phase 0: solid base (in progress)

| What | State |
|---|---|
| End-to-end code review: engine, API, billing | Engine fixes merged (#66 line). API and billing fixes pushed on `claude/elegant-bohr-mjeotl` |
| Review of the staging gateway, the shop screens and the admin dashboard | Next |
| Ghana legal pack (Act 843 data protection and DPC registration, Act 772 electronic transactions, Act 1038 cybersecurity, Act 1151 VAT, Act 987 payments, consumer protection, labour) | After the reviews. Drafts only, for a Ghanaian lawyer to review |
| **C62 rename the test shops** to Mansora TSA and Mansora TSB | **Done** in this branch. Live shops are renamed on the next deploy. Their web addresses (`/client/shop-a/`, `/client/shop-b/`) stay the same, so saved links and logins keep working |

## Phase 1: pilot essentials (browser)

### C59 Shifts, owner and shop logins: explained and made firm
Today: owner, manager and cashier roles, personal logins, shifts with opening float and cash-up exist.
What is missing is one clear rule set and the checks that enforce it.
- One page, "Who can do what", for owners and cashiers: each role's permissions, generated from the
  permission table in code so the page can never drift from what the app does.
- Rules made firm: a cash sale needs an open shift for the person selling. A shift belongs to one person
  and cannot be used by another login. A shift left open overnight is flagged to the owner and must be
  closed with a count before that person opens a new one. The owner sees open and unbalanced shifts on the dashboard.
- "Store login" explained. Each shop has a web address; everyone signs in with their own name. No shared
  shop password exists or will be added, because the audit log must show who did what.
- Tests: role permission matrix test, shift ownership test, overnight shift test.

### C60 Expenses, restocking, purchases and suppliers: clear and documented
Today: expenses, purchase receiving with moving-average cost, and a basic supplier list (name, phone, notes) exist.
- Supplier list made complete: Mobile Money number, location, what they supply, and each supplier's
  purchase history and total bought.
- Restocking: a "Needs reordering" list from reorder levels, grouped by usual supplier, that can be
  turned into a purchase in one step.
- Guides: a step-by-step section in the owner guide for expenses, receiving stock, counting stock and
  suppliers, with screenshots from Mansora TSA.
- Supplier debts (what the shop owes suppliers) are part of C63, not this task.

### C58 Sample shop Excel file
- A realistic Ghanaian provisions-shop workbook (about 150 products: drinks, provisions, toiletries,
  household; cartons and units; cost and selling prices in cedis; opening stock; reorder levels) that
  imports cleanly with the existing importer.
- Shipped as the downloadable template's "full example", and loaded into Mansora TSA so testers see a real shop.
- Test: the workbook imports with zero errors and the stock value matches the sheet.

### C57 Barcode scanning
Today: a USB or Bluetooth scanner that types like a keyboard already works in New sale.
- Phone and tablet camera scanning on New sale, Products and Stock count (browser barcode detection, with
  a fallback library where the browser has none).
- Scan to find on Products and Stock count; scan an unknown barcode to create the product.
- Print barcode labels for products that have none (A4 sheet of labels, from the browser).
- Tested in the browser phase with a USB scanner and an Android phone camera. Scanner testing on the
  Windows till is in the offline phase.

### C61 Consistent colours on every screen
- One colour token set shared by the shop app and the admin dashboard; remove one-off colours.
- Every text and status colour meets WCAG AA contrast, checked automatically in tests.
- Status colours (paid, owed, low stock, restricted) never rely on colour alone: each has an icon or word,
  for colour-blind staff and washed-out screens.
- Checked on three display profiles: a bright laptop, a low-cost Android phone, and a dim screen in
  daylight (screenshots at each, reviewed by the owner).

### C44 Selling by weight and length (decimal quantities)
- Products can be sold in kilograms, litres, metres or yards, with up to three decimal places
  (e.g. 1.25 kg of rice, 2.5 yards of fabric). Stock and costs stay exact (stored in thousandths, money in pesewas).
- Saved pack sizes (e.g. bag of 50 kg, half bag, olonka) so cashiers tap rather than type.
- Sync contract and server columns updated; the laptop and server agree on totals to the pesewa.

### C45 Wholesale and retail prices, supervised price override
- Each product can have more than one price level (retail, wholesale, and optionally a custom level),
  with a minimum quantity for wholesale.
- A customer can be set to a price level.
- A cashier can change a price on a sale only with a manager or owner approving, recorded in the audit log.
  A price below cost always needs the owner.

### C47 Customer credit limits
- Each credit customer has a limit. A sale on credit over the limit needs a manager or owner to approve,
  recorded in the audit log.
- Customer list shows who is near or over their limit.

## Phase 2: tax and money confirmation (browser)

### C46 VAT, NHIL and GETFund
- Tax settings per shop: not registered, or registered for VAT, with the shop's TIN.
- Rates are settings, not hard-coded, because they change. Under the VAT Act 2025 (Act 1151), from
  1 January 2026 the standard rate is VAT 15% plus NHIL 2.5% plus GETFund 2.5% (20% in total), the COVID-19
  levy is gone and the flat-rate scheme is abolished. **Confirm these figures with a tax adviser before release.**
- Prices can be entered tax-inclusive; receipts show each tax line and the TIN; a tax report gives the
  figures for the monthly VAT return. Exempt products (for example some basic foods) can be marked.
- Note: GRA's E-VAT certified invoicing is a separate integration with GRA, planned after the pilot once
  GRA's API access requirements are confirmed.

### C56 Mobile Money confirmed, not just typed in
Today: the cashier types the Mobile Money reference, and the end-of-day wallet check compares it with the wallet statement.
- Option A (recommended): a payment request sent to the customer's phone through a licensed payment
  provider (Paystack, Hubtel or similar). The sale completes when the provider confirms the money arrived.
- Option B: keep typed references and match them automatically against a statement file the owner uploads.
- Needs from the owner: a merchant account with the chosen provider for each shop, and its fees agreed.
- Offline fallback: when the connection is down, the typed reference is kept and checked later, as today.

## Phase 3: pharmacies and wholesalers

### C63 Expiry dates, batches and supplier debts
- Batches with expiry dates on receiving; selling takes the earliest-expiring batch first; expiry report
  and warnings 30, 60 and 90 days ahead; expired stock blocked from sale.
- Supplier debts: purchases on credit, payments to suppliers, what is owed to each supplier, and ageing.
- Pharmacies: note that Pharmacy Council and FDA Ghana rules may require records (prescription items,
  batch traceability) the legal pack should list before this is offered to pharmacies.

## Offline phase (later date, to be tested together)

These need the Windows till and real devices, so they are built and tested together on a date the owner sets.

| Task | What |
|---|---|
| C48 | Signed Windows installer and automatic updates |
| C49 | Silent receipt printing (no dialog on each sale) and cash-drawer opening |
| C64 | Hardware test day: the till with a real 80 mm thermal printer, a cash drawer and a USB scanner, in a shop, with a power cut and internet cut during selling |
| C65 | More than one till per shop, then branches. Design first; build only when a client needs it |

## What the owner needs to decide or provide

1. A date for the offline phase test day, and which printer and scanner models shops will use.
2. Mobile Money: which provider to use for payment requests (C56), and a merchant account.
3. A tax adviser to confirm the VAT figures and exempt items before C46 is released.
4. Backups: Railway Pro or an S3-compatible bucket (still open from C38).
