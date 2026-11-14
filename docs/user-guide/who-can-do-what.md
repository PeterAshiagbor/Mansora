# Who can do what

Generated from the permission table in `packages/domain/src/permissions.ts`; a test fails if this page and the code differ.
Run `npx tsx scripts/docs/roles.ts` after changing permissions.

These are the starting permissions for each role. The owner can give a manager or cashier more or fewer permissions,
person by person, on the Staff page, except the ones marked "Never", which only the owner can ever have.

| What | Owner | Manager | Cashier |
|---|---|---|---|
| Make sales | Yes | Yes | Yes |
| View all sales history | Yes | Yes | – |
| Apply discounts | Yes | Yes | – |
| Approve and process refunds | Yes | Yes | – |
| View products | Yes | Yes | Yes |
| Create and edit products and categories | Yes | Yes | – |
| View and edit cost prices | Yes | Yes | – |
| View stock levels and movements | Yes | Yes | – |
| Adjust stock, record damages and stock counts | Yes | Yes | – |
| Record purchases and suppliers | Yes | Yes | – |
| Manage customers | Yes | Yes | – |
| Sell on credit | Yes | Yes | – |
| Receive credit repayments | Yes | Yes | – |
| Record expenses | Yes | Yes | – |
| Open and close own shift | Yes | Yes | Yes |
| Review and sign off shifts | Yes | Yes | – |
| View sales and payment reports | Yes | Yes | – |
| View stock reports | Yes | Yes | – |
| View gross profit reports | Yes | Yes | – |
| Manage staff and permissions | Yes | Never | Never |
| Manage business settings | Yes | – | – |
| Import products and opening stock | Yes | Yes | – |
| Export business data | Yes | – | – |
| Create and restore backups | Yes | – | – |
| View audit history | Yes | – | – |
| Grant or revoke Mansora support access | Yes | Never | Never |
| View the Mansora subscription, invoices and receipts | Yes | – | – |
| Pay Mansora invoices and manage automatic payments | Yes | – | – |

## Logins and shifts

- Everyone signs in with their **own** username and password. There is no shared shop password: the records show who did each sale, refund, discount and cash movement.
- Each shop has its own web address. Staff open it and sign in with their own login.
- A person must **open a shift** (count the opening float) before selling, taking cash refunds or recording cash in or out.
- A shift belongs to the person who opened it. Nobody else can sell on it.
- At the end of the day, the person **closes their shift** by counting the cash. Mansora shows the expected cash and any difference.
- A shift still open from an earlier day is flagged to the person and to the owner and managers. Close it with a count before starting the next day.
- If someone goes home without closing their shift, an owner or manager closes it for them from **Cashier shifts → Shifts left open by others**, after counting the cash in that till. The difference is recorded with their name and reason.
- Cash in or out of the till that is not a sale needs a manager or owner to approve.
- The app locks after the idle time set in Settings. The same person signs back in and returns to where they were.
