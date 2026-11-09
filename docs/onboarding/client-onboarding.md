# Client onboarding guide (Mansora staff)

The admin dashboard tracks these twelve steps per client. "Activate licensed
laptop" ticks itself; the rest are ticked by you.

| # | Step | How |
| --- | --- | --- |
| 1 | Create client account | Dashboard → Clients → Add client |
| 2 | Configure business profile | On the laptop after activation: Settings (name, phone, address, receipt footer) |
| 3 | Activate licensed laptop | Dashboard → client → Create activation code. On the laptop enter the server address and code. Needs internet once. Codes work once and expire after 72 hours |
| 4 | Import products | Laptop → Import & export → download the template, fill it, preview, import |
| 5 | Import opening stock | Same file, "Opening stock" column. The owner ticks the confirmation after a physical count |
| 6 | Create owner login | Done on the activation screen. The owner chooses the password; do not keep it |
| 7 | Configure staff | Laptop → Staff. One login per person. Start from the Cashier or Manager defaults |
| 8 | Test scanner | Follow `hardware-test-script.md` |
| 9 | Test printer | Follow `hardware-test-script.md` |
| 10 | Complete test transaction | One cash sale, one refund, close the shift, check the till balances |
| 11 | Deliver training | Cashier guide and owner guide |
| 12 | Confirm go-live | Ticking this sets the client to "active" |

## Before you leave the shop

- [ ] The owner has made a backup, written the passphrase down and stored it away from the laptop
- [ ] Sync status shows "Online" and nothing waiting
- [ ] The owner knows that Mansora cannot see their sales unless they grant access
- [ ] The owner knows what is lost if the laptop is destroyed before syncing
- [ ] Test sales are understood to be part of the record (they cannot be deleted; refund them)

## Replacing a laptop

1. If the old laptop is lost or stolen: Dashboard → client → Deactivate laptop.
2. Install on the new laptop. On the activation screen choose "Restore from a backup instead".
3. If there is no backup, activate with a new code. Synced history remains in the
   cloud, but loading it back onto a new laptop is **not yet built** — see the
   backup and recovery guide.
