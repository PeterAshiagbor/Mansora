# End-to-end audit and proposed roadmap — 11 November 2026

Audited commit `7c7a977` (default branch). Written for the owner: what exists,
what is missing, what to build next and why. Engineering detail lives in the
linked files.

## 1. Bottom line

1. **The engineering is good. The product has never met a customer.** In three
   days two AI agents opened more than 40 pull requests. Money maths, stock integrity,
   tenant isolation and sync are careful and well tested. No real shop has made
   a real sale on it, no real payment has been collected, and no hardware has
   been touched.
2. **The repository holds two products and has not chosen between them.** The
   designed product is an offline Windows till. The thing people actually open
   at `app.mansora-consulting.com` is a browser version built as a *test
   environment*. Neither is ready for a paying client. This is the first
   decision to make (section 4).
3. **More polish will not move the business now.** The next unit of progress is
   a pilot with three to five real shops, and the short list of work that
   unblocks it (section 6, "Now").
4. **Most open blockers are yours, not engineering's**: a payment provider
   account, a hosting choice, legal review, hardware, pricing, and 35 defaults
   awaiting approval (section 7).

## 2. What was checked

| Check | Result |
| --- | --- |
| Type check, production build | Pass |
| Full test suite, run locally | 286 of 288 passed at first. The two failures were one real phone-layout bug; after the fix in section 9, 288 of 288 pass |
| Dependency audit | 0 known vulnerabilities |
| CI on the audited commit | All six workflows green |
| Code read | Domain rules, command engine, sync, API security, device and admin routes, hosted gateway, sales and report commands, billing surface, Electron shell |
| Interface | Reviewed from the 49 screenshots generated from the running build |

**Not checked:** the live site and `mansora-consulting.com` (both blocked from
this session's network, so the marketing site's promises were not compared with
the product); anything on Windows hardware; real Paystack, Hubtel or Resend
calls; load on production PostgreSQL. The 9-second annual report figure below is
taken from `docs/operations/performance.md`, not re-measured.

## 3. What is strong — keep it

- **Money and stock cannot drift.** Integer pesewas everywhere, exact discount
  allocation, refunds that can never exceed what was paid, stock balance always
  equal to the sum of movements, financial records protected from edits by
  database triggers.
- **One write path.** Every action passes one engine that checks sign-in,
  permission and input, then commits the change, its audit entry and its sync
  event together or not at all. A crash mid-sale leaves nothing behind.
- **Sync is idempotent.** Retries and duplicates cannot double a sale.
- **Mansora cannot read a client's data by accident.** Two database roles plus
  row-level security; support access needs the owner's time-limited consent and
  is logged where the owner can see it. This is a selling point.
- **Billing is built defensively.** Payment is trusted only after asking the
  provider; one in-flight attempt per invoice; append-only audit.
- **Honest documentation.** Nothing claims to be tested when it was not.

## 4. The central finding: choose the delivery model

| | Offline Windows till (designed) | Browser version (what is live) |
| --- | --- | --- |
| Works with no internet | Yes | No |
| Works on a phone or tablet | No | Yes |
| Install and support effort | High: installer, signing, updates, visits | None |
| Several staff at once | No, one laptop per shop | Yes |
| Owner can check from home | No | Yes |
| State today | Unsigned, no auto-update, never run by a person on Windows | Two fixed sample shops, labelled "team test"; adding a shop needs a redeploy |

Both run the same engine, so this is a packaging choice, not a rewrite.

**Recommendation: pilot on the browser version, keep the offline till as the
second tier.** Reasons: it reaches a real shop in weeks instead of months, needs
no site visit or certificate, gives the owner phone access (the feature
absentee owners value most), and every lesson transfers to the desktop app
because the engine is shared. The cost is honest: a shop cannot sell during an
internet outage. Pick pilot shops where that is tolerable, and offer the
offline till afterwards to shops where it is not.

What the browser version needs before a real shop uses it:

1. **Create a shop without a redeploy.** Shops are read from server settings at
   start-up (`scripts/staging/bootstrap.ts`). Provision a workspace when an
   administrator creates a client.
2. **Backups you have restored at least once.** All shop data and its
   encryption keys sit on one volume. Add scheduled off-site copies and
   rehearse a restore.
3. **Remove the test labelling and test limits**: the "TEAM TEST ENVIRONMENT"
   banner, the cap of 16 simultaneous requests, one spreadsheet import at a
   time for the whole server.
4. **Fix sign-in throttling.** It counts attempts per network address, but
   behind the hosting proxy every visitor shares one address
   (`scripts/staging/gateway.ts`), so one person mistyping can lock out all
   shops for a minute.
5. **Owner sign-in recovery** by email, since there is no activated laptop to
   anchor the current recovery-code flow.
6. **Uptime and error alerts** going to a person.

## 5. Findings

Severity: **High** blocks a paying client; **Medium** limits who you can sell to
or will hurt within months; **Low** is tidy-up.

### 5.1 Fit for Ghanaian retail

| # | Finding | Severity | Why it matters |
| --- | --- | --- | --- |
| F1 | **No tax on sales.** No VAT, NHIL or GETFund anywhere in checkout, receipts or reports | Medium | Shops selling goods under GHS 750,000 a year need not register for VAT since 1 January 2026, so the first pilot shops are probably unaffected. Supermarkets, pharmacies and wholesalers above that line cannot legally use the product, and the tax authority's electronic invoicing (E-VAT) is expanding. Confirm with an accountant |
| F2 | **Mobile money is typed in, not verified.** The cashier records an amount and optional reference | Medium | Mobile money is the main non-cash payment. Fake "payment sent" messages are a known fraud. No end-of-day list exists to tick against the wallet statement |
| F3 | **Whole units only** | Medium | Rules out anything sold by weight or length: provisions, fabric, hardware, agro-inputs |
| F4 | **One price per product, no override** | Medium | Wholesale and retail prices for the same item are standard practice |
| F5 | **Customer credit has no limit and no reminders** | Medium | Credit is where small shops lose money. Reminders that get debts paid are an easy return on the subscription |
| F6 | **No message to the owner.** No daily summary, no alert on large discount, refund or cash shortage | Medium | Theft control is the main reason owners buy a till system. A closing-time summary on the phone is the habit that keeps them subscribed |
| F7 | **Receipts are paper only**; printing opens a dialog on every sale; no cash-drawer signal | Medium | A print dialog per customer is unusable at a busy till. WhatsApp or SMS receipts remove the printer dependency |
| F8 | **No parked sale, no quick keys** | Low | A customer who steps away blocks the queue |
| F9 | **No expiry dates or batches; no supplier debts; no variants** | Low for now | Needed for pharmacies and for shops buying on credit. Do not build before a pilot asks |
| F10 | **One laptop, one branch per business** | Medium, desktop only | A second till or branch is impossible on the desktop app. The browser version already allows several staff |

### 5.2 Running it as a business

| # | Finding | Severity |
| --- | --- | --- |
| B1 | **No real payment has ever been collected.** No Paystack account or keys; Hubtel adapter is a stub; emails queue until Resend is configured | High |
| B2 | **No production environment.** The only live system is a single test server. No monitoring, no alerting, no rehearsed restore | High |
| B3 | **Nothing legal is signed off.** Data Protection Act registration, privacy notice, client terms and processing agreement are drafts awaiting a Ghanaian lawyer | High before real customer data |
| B4 | **No pricing.** Plans store a price but no features or limits, so tiers cannot differ | Medium |
| B5 | **No route from "interested" to "using it".** Every client is created by hand; no demo request, trial or sign-up | Medium. Hand-holding is right for the first 20 clients; a demo-request form is the cheap first step |
| B6 | **No decision on non-payment.** A late client is flagged and nothing else happens | Medium |
| B7 | **No usage data and no in-app support link.** You cannot see which shops are active, which features are used, or who is drifting away | Medium |
| B8 | **One administrator role; accounts created from the server command line** | Low until a second staff member needs access |

### 5.3 Engineering and operations

| # | Finding | Severity |
| --- | --- | --- |
| E1 | Desktop installer is unsigned, has no automatic update, and has never been used by a person on Windows | High for the desktop tier |
| E2 | Cloud copy of a desktop shop is write-only. The owner cannot view it remotely; the data is there but nothing reads it | Medium |
| E3 | Large reports are slow: about 9 seconds for a year of sales at 200,000 sales (repository's own measurement) | Medium, years away for a small shop |
| E4 | Password checks block the whole server for a moment. Harmless on one laptop; on a shared server every sign-in pauses every shop | Medium at scale |
| E5 | Ghana is hard-coded: UTC day boundaries, GHS only | Low. Correct for now; a cost if you expand to Nigeria |
| E6 | Unsaved form protection does not survive a crash or closed tab | Low |
| E7 | An error message on a phone covered the Menu button until dismissed | Fixed here |

### 5.4 How the work is being run

| # | Finding | Severity |
| --- | --- | --- |
| P1 | **Activity is outrunning direction.** The interface has been restyled or redesigned four times in two days (tasks C13, C21, C24, C28) without a shop user in front of it | High. This is the pattern to stop |
| P2 | Several agent sessions edit one 80 KB coordination file; ownership rules are growing faster than the product | Medium. Trim the board to open work only; move history to an archive |
| P3 | The default branch is named `claude/relaxed-lovelace-0179ut` and is pushed to directly | Low. Rename to `main` and require green CI to merge |
| P4 | Fifty documents, one stale by its own admission (`docs/phase-report.md`). You cannot be expected to read them | Low. This page is meant to be the one to read |

## 6. Proposed roadmap

Each item says why it earns its place. Order within a stage is priority order.

### Now — get to a real shop (about 2 to 3 weeks of build)

| # | Work | Why |
| --- | --- | --- |
| N1 | Make the browser version client-ready: the six items in section 4 | Nothing else matters until a shop can be created and its data is safe |
| N2 | Owner's closing summary by email, then WhatsApp or SMS: sales, cash difference, refunds, discounts, low stock, debts due | The feature owners will talk about. Uses data and email plumbing that already exist |
| N3 | Mobile money end-of-day list: every mobile money sale with its reference, to tick against the wallet | Cheap fraud control with no provider integration |
| N4 | Bill the first clients by invoice and recorded payment (already built) | Do not let the Paystack account delay the pilot |
| N5 | Usage view for you: last sale, sales per day, active staff per shop; plus a "WhatsApp Mansora support" link in the app | You need to see whether pilots are actually used |
| N6 | Demo-request form on the marketing site feeding the client list | First step of a sales pipeline |

**Exit test:** three shops have each recorded real sales on ten separate days,
and one data restore has been rehearsed.

### Next — make it worth paying for (weeks 4 to 10, steered by the pilot)

| # | Work | Why |
| --- | --- | --- |
| X1 | Debt reminders and customer statements by SMS or WhatsApp; optional credit limit | Recovers money for the owner. Easiest feature to justify the fee |
| X2 | Digital receipts; silent printing and cash-drawer signal on desktop | Removes the worst till friction |
| X3 | Decimal quantities and saved pack sizes (carton to piece) | Opens provisions, fabric, hardware. Touches the engine and sync format, so do it once, carefully |
| X4 | Wholesale and retail price levels; supervised price override | Standard practice the product currently forbids |
| X5 | Tax-inclusive pricing with VAT, NHIL and GETFund lines; tax report | Opens VAT-registered shops. Precondition for E-VAT |
| X6 | Plans with real limits (staff, products, features) and the non-payment policy enforced gently | Lets you price in tiers |
| X7 | Live Paystack for subscriptions: card and one-off mobile money | Removes manual collection once there are more than about ten clients |
| X8 | Parked sales and quick keys | Small, visible, asked for early by every busy shop |

### Later — scale and widen

| # | Work | Why wait |
| --- | --- | --- |
| L1 | Offline desktop tier done properly: signing, automatic updates, hardware-tested, owner's remote view from the cloud copy | Needs hardware, a certificate and a pilot shop that requires it |
| L2 | Verified mobile money at the till | Needs a provider contract and legal review; this is the undesigned "System B" |
| L3 | Several tills and branches on desktop; stock transfers | A new sync protocol. Only when a client is waiting for it |
| L4 | E-VAT certified invoicing | Needs GRA onboarding per client and X5 first |
| L5 | Expiry and batches, supplier debts, variants | Sector features. Build for the first pharmacy or wholesaler that signs |
| L6 | Self-service sign-up and trial | After the hand-held process is proven and repeatable |
| L7 | Accounting export | After shops ask their accountants what they need |

### 6a. Who builds what

Rebalanced on 11 November 2026 after the owner's decisions: pilot on the browser
version, then the offline till; build the features; keep data on the existing
Railway hosting; non-payment policy approved and hardened. The split follows
the repository's file-ownership lines, so no two sessions edit the same files.
Task numbers continue the board in `docs/codex-tasks.md`; C32 is Codex's own
task for C30 findings F03/F04.

| Lane | Tasks | Done when |
| --- | --- | --- |
| **Claude** (engine, sync, billing) | Done in PR #47: C31 mobile money check · C30 F01/F02 · C52 non-payment policy. Next: C33 owner's closing summary (opt-in) · C34 activity signals (counts only) · C44 decimal quantities and pack sizes · C45 price levels and supervised override · C46 VAT, NHIL and GETFund · C47 customer credit limit | Each engine change ships with tests, a documented command contract for the interface, and green CI |
| **Codex session 1** (Platform and offline tier) | C32 runtime and backup-storage wiring (C30 F03/F04, already claimed) · C36 create a shop without a redeploy · C37 gateway client mode and sign-in throttling · C38 off-site backups, rehearsed restore, alerts · C48 signed installer and automatic updates · C49 silent printing and cash drawer | Third shop created and isolated with no restart · one person's wrong passwords cannot lock out another shop · restore rehearsed and recorded · an update installs itself on a test machine · a receipt prints without a dialog in the packaged app |
| **Codex session 2** (Client and sales surface) | C40 Contact Mansora panel · C41 parked sales and quick keys · C39 demo-request intake · C50 WhatsApp receipts, debt reminders and statements · C35 first-client billing walkthrough · C51 interface for C44–C47 · C42 board housekeeping | Contact comes from settings · parked basket resumes once only · test request appears in Leads · a statement opens in WhatsApp with the right balance · runbook followed without help · each new engine feature usable from the till |

Rough effort, counting small = 1, medium = 2, large = 3: Claude about 15
(including the 6 already delivered), Codex session 1 about 14, Codex session 2
about 12.

**Platform lane claimed (2026-11-11):** the existing Codex review/domain/email session owns C36–C38, then C48/C49. Execution order, file boundaries, dependencies and acceptance evidence are maintained in [Platform lane handoff](platform-lane-handoff.md). Codex session 2 retains its separate client/sales lane.

Start prompt for Codex session 1:

> Read docs/codex-tasks.md (status board and newest handoff) and
> docs/operations/product-audit-and-roadmap.md sections 4 and 6. You own tasks
> C36, C37, C38, C48 and C49 in the "Platform" lane: make the browser version safe for a
> real shop, then the offline tier (C48, C49). Finish your C32 (C30 F03/F04
> runtime wiring) first; C38 builds on it. Follow the board's rules: claim on the board, one
> branch and PR per task, tests with every change, never weaken a test, do not
> edit Claude-owned engine, sync or billing files. Do not start an interface
> redesign. Record exact verification results in the handoff log.

Start prompt for Codex session 2:

> Read docs/codex-tasks.md (status board and newest handoff) and
> docs/operations/product-audit-and-roadmap.md sections 5 and 6. You own tasks
> C35, C39, C40, C41, C42, C50 and C51 in the "Client and sales surface" lane.
> Start with C40, then C41, C39, C50 and C35. Take each part of C51 only after
> Claude's engine PR for that feature merges. Do C42 last. Follow the board's rules: claim on the board, one
> branch and PR per task, tests with every change, never weaken a test, do not
> edit Claude-owned engine, sync or billing files, and do not change
> scripts/staging (Codex session 1 owns it). Keep to the existing visual
> system; no redesign. Record exact verification results in the handoff log.

### Do not build yet

Another interface redesign; more languages; a native mobile app; AI features;
multi-currency; more administrator screens. None is blocking a sale.

## 7. Decisions only you can make

Ranked by how much they block.

1. ~~Delivery model for the pilot~~ **Decided 2026-11-11:** browser version first, then the offline till (D-36).
2. **Who are the first three to five shops**, and what do they sell? This sets
   whether F3, F4 or F1 jumps the queue.
3. **Hosting decided 2026-11-11:** the existing Railway project (D-12). Still open: confirm the Railway region, and have a lawyer clear Act 843 registration and any cross-border transfer before real client data.
4. **Pricing.** A starting point to react to: one plan, monthly, with a setup
   and training fee; add tiers after the pilot.
5. ~~What happens when a client does not pay?~~ **Decided and built 2026-11-11** (D-28, task C52): the till never stops; reminder, then a dated warning, then management reports and report exports pause from 30 days late until paid. Hardened as described in the decision log.
6. **Paystack business account.** Start the paperwork now; approval takes time.
7. **Approve the decision log in one sitting.** Of the 35 defaults in
   `docs/decisions/decision-log.md`, most can be accepted as written. The ones
   that deserve thought: D-10 and D-28 (non-payment), D-12 (hosting), D-14
   (whole units), D-15 (price override), D-30 (clients' own payment
   collection), D-35 (tax on Mansora's invoices).
8. **Hardware for the desktop tier**: one Windows laptop, scanner, receipt
   printer and cash drawer; and a code-signing certificate.
9. **Repository settings**: rename the default branch to `main` and require
   green checks before merging.

## 8. Facts used about Ghanaian tax

From the 2026 reforms, effective 1 January 2026: the VAT registration threshold
for suppliers of goods rose from GHS 200,000 to GHS 750,000; the COVID-19 levy
was abolished; the retailers' flat-rate scheme was abolished; the effective
combined rate is about 20%. A November 2026 extension of mandatory E-VAT to
medium businesses has been reported but not confirmed by GRA. Treat this as
background for a conversation with an accountant, not as advice.

Sources: [GRA E-VAT](https://gra.gov.gh/e-vat/) ·
[KPMG, Ghana 2026 budget tax measures](https://kpmg.com/us/en/taxnewsflash/news/2025/11/ghana-tax-measures-2026-budget.html) ·
[MyJoyOnline, threshold and rate](https://www.myjoyonline.com/vat-reforms-gra-raises-registration-threshold-to-gh%C2%A2750000-cuts-rate-to-20-from-jan-2026/) ·
[Crowe, VAT reform 2026](https://www.crowe.com/gh/news/ghana-vat-reform-2026) ·
[Fiscal Requirements, E-VAT expansion report](https://www.fiscal-requirements.com/news/6142-ghana-clarifies-digital-vat-collection-rules-as-further-e-vat-expansion-is-reported-for-november-2026)

## 9. Small fixes made during this audit

- **Phone: error messages no longer cover the Menu button.** A failed action
  left a red message over the top bar until dismissed, blocking navigation on a
  390-pixel-wide phone. Messages now sit below the top bar on small screens and
  never exceed the screen width (`apps/desktop/src/renderer/lib.tsx`). This also
  makes two phone tests pass outside CI.
- **Dashboard wording.** "1 products" and "9 transaction(s)" now read
  "1 product" and "9 transactions" (`apps/desktop/src/renderer/pages/Dashboard.tsx`).
