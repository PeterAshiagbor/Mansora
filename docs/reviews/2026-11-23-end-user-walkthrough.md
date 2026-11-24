# End-user walkthrough — 23 November 2026

A click-through of the seeded demo (`npm run demo -- --seed`) in a real browser (Chromium,
1366×768 and 1280×720), as a cashier, the shop owner and a Mansora administrator. All
pages were opened and checked for console errors, broken layout and horizontal scrolling.
None were found. What follows is what a real user would trip over, and what was changed.

## Journeys covered

| Who | Journey | Result |
| --- | --- | --- |
| Cashier | Sign in, open shift, scan and tap products, oversell attempt, pay cash, change, print receipt | Works. Fixed: F9 pressed straight after a scan was ignored |
| Cashier | Refund with manager approval, including a mistyped manager password | Works. Fixed: a wrong password closed the approval and lost the manager's username |
| Cashier | Blind close of shift with a shortage | Works as designed: expected cash shown only after the count |
| Cashier | Till on a 1280×720 / 1366×768 laptop | Fixed: only one or two basket lines were visible |
| Owner | Every page in the menu, add product, staff list | Works. Fixed: a page deep in More tools was half hidden in the menu |
| Administrator | Sign in (wrong then right password), every page, Add client | Works. Fixed: Add client's disabled button gave no reason; raw lowercase statuses |

## Changes made

1. **Pay (F9) no longer drops a key press.** Pressing F9 while a scan or the total is still
   being worked out now opens payment as soon as the total is ready. The Pay button shows
   "Working out total…" meanwhile. The red "Calculating total…" alert that flashed after
   every scan is gone; only a real failure to price the basket is shown.
2. **Manager approval survives a mistyped password.** Refunds, cash in/out and discounted or
   credit sales keep the approval dialog open with the error, keep the username and focus
   the password. "Discounts above the limit need the owner" also stays there, so the owner
   can sign without restarting payment.
3. **More basket lines visible at the till.** "Request discount" moved to the basket header;
   the credit hint shows only before the first item (payment asks for a customer when
   credit is chosen); "Subtotal" shows only when a discount or tax sits between it and the
   total.
4. **Every disabled Save explains itself.** Required fields that were not marked `required`
   now are, so the existing "To continue, complete or correct" summary appears. This covers
   Add/Edit client, two-step sign-in codes, billing notes, lead conversion,
   cash in/out, expenses, closing a shift (including "explain the difference" when the till
   is out) and the Mobile Money number for automatic payments.
5. **Menu keeps the current page in view** when it sits in a More tools section.
6. **Admin wording:** client, subscription and invoice statuses read "Onboarding",
   "Payment due" and so on instead of raw values; business types are capitalised; the
   repeated subtitle on Billing is removed; an empty billing list says no client has a
   subscription yet instead of "no clients match this filter".
7. **Sign-in help:** "Forgot password? Get help" sat next to "Owner forgot their
   password?". The first is now "Need help signing in?", which is what it opens.

## Seen but deliberately left alone

- The purple outline around the page after keyboard navigation is intentional focus
  handling for keyboard and screen-reader users; mouse users do not see it.
- Out-of-stock items cannot be sold unless the owner allows negative stock (decision D-04,
  awaiting approval). A cashier whose stock count is wrong is told to ask the owner.
- An unfinished basket is lost if the window is reloaded. Parking is per session by design.

## Still outside what software testing can show

Physical scanner, printer and cash drawer; the packaged Windows app used by a person; live
payment providers; real users at a busy till. See [phase report](../phase-report.md).
