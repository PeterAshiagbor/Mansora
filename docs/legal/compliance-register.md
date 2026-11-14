# DRAFT — not legal advice — for review by a Ghanaian lawyer

# Ghana compliance register

Prepared 2026-11-14 from the code as it stands and the facts recorded in the decision log. Each row says
which law applies, who it binds (**Mansora**, the platform provider, or the **shop**, Mansora's client), what
the product already does, and what is still open. Section numbers are not cited where they could not be checked;
the reviewing lawyer should add them.

Status words: **In place** (built or done), **Partly** (some of it), **Open** (owner or lawyer action needed).

## Facts this register relies on

| Fact | Source |
|---|---|
| Live cloud database and browser shop stores are hosted on Railway, region `sfo` (United States, West). | Railway project settings, read 2026-11-14 |
| Email is sent through Resend (United States). | `apps/api/src/billing/email`, `docs/billing/resend-email.md` |
| Card and Mobile Money payments to Mansora go through Paystack (licensed in Ghana; part of Stripe, United States). | `apps/api/src/billing/providers/paystack.ts` |
| Offline tills keep an encrypted copy of the shop's data on the shop's own laptop (SQLCipher, AES-256). | `apps/desktop/src/core/db.ts` |
| No server backups are configured yet (Railway backups need the Pro plan). | Board row C38 |
| Mansora staff can see a shop's reports only when the owner grants support access, for 1 hour to 3 days. | D-16, `support.grant` |

## 1. Data Protection Act, 2012 (Act 843)

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Register as a data controller with the Data Protection Commission (DPC) before processing, and renew when due | Mansora (for its own clients, administrators and billing data). Each shop, for its customers and staff | **Open** | Mansora to register. Shops told in the onboarding pack that they must register. See [dpc-registration.md](dpc-registration.md) |
| Process only for a specified, lawful purpose; collect no more than needed | Both | **Partly** | Data inventory lists every field ([data-inventory.md](data-inventory.md)). Customer phone and email are optional in the app. Free-text notes need guidance to staff |
| Tell people what is collected and why (openness) | Both | **Partly** | Drafts: [privacy-notice.md](privacy-notice.md) (shop customers), [staff-notice.md](staff-notice.md), [mansora-privacy-notice.md](mansora-privacy-notice.md) (Mansora's own). None is shown in the app yet: task in section 9 |
| Security safeguards appropriate to the risk | Both (Mansora as processor must give guarantees) | **Partly** | Encrypted laptop store, hashed passwords, MFA for administrators, row-level security in PostgreSQL, audit log. **No off-site backup yet.** No written access-review routine |
| Written contract with any processor | Shop → Mansora; Mansora → its subprocessors | **Open** | Draft: [data-processing-agreement.md](data-processing-agreement.md). Railway, Resend and Paystack standard terms to be accepted and filed |
| Notify the DPC and affected people of a security compromise, as soon as reasonably practicable | Controller (the shop for shop data; Mansora tells the shop without delay) | **Partly** | Draft plan: [breach-response.md](breach-response.md). Nobody named on call yet |
| Rights of access, correction, objection to direct marketing, and deletion where lawful | Both | **Partly** | Owner can export, correct and deactivate records. No one-person export or erasure tool: listed in [retention-deletion.md](retention-deletion.md) |
| Processing outside Ghana | Mansora | **Open** | Data is stored in the United States. Act 843 has no detailed transfer regime like the EU's, but the DPC expects transfers to be disclosed and protected. Decide: keep US region with contract safeguards and disclosure, or move to an EU region. Must be stated in notices and the agreement either way |
| Appoint a data protection supervisor (where required) and keep records | Mansora | **Open** | Name a person. Owner (Peter) by default until someone is trained |

## 2. Electronic Transactions Act, 2008 (Act 772)

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Contracts and signatures made electronically are valid | Both | **In place** | Clicking to accept terms and approving a payment authorisation online are valid ways to agree. Keep a record of who accepted which version and when: task in section 9 |
| Online supplier must give its identity, address, contact, prices, terms and how to complain before the customer is bound | Mansora (selling to shops online) | **Partly** | Mansora's registered name, address and Registrar number must appear on the website, invoices and the terms. Prices are on invoices; fees must be stated before the shop signs |
| Unsolicited commercial communications must let the person opt out | Both | **Partly** | Mansora sends only service emails (invoices, reminders, sign-in codes, daily summaries the owner chose). Any marketing email needs an opt-out link. Shop WhatsApp messages to customers are drafted by staff and sent by hand (C50) |
| Records kept electronically must be retrievable and intact | Both | **In place** | Audit log, immutable sales and payments, backups (laptop). Server backups open (C38) |

## 3. Cybersecurity Act, 2020 (Act 1038)

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Report cybersecurity incidents to the Cyber Security Authority (CSA) / CERT-GH where the Act or CSA directives require it | Mansora | **Partly** | Mansora is not likely to be designated critical information infrastructure, but serious incidents should be reported to CERT-GH voluntarily and when directed. Included in [breach-response.md](breach-response.md) |
| Licence to provide cybersecurity services | Mansora | **Not applicable**, if Mansora sells a sales and stock system and not security services. Confirm with lawyer |
| Accreditation of cybersecurity professionals and establishments | Mansora | **Not applicable** for the same reason |

## 4. Payment Systems and Services Act, 2019 (Act 987)

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Only licensed institutions may provide payment services or hold customers' money | Mansora | **In place** | Mansora never holds shop or customer money. Payments to Mansora go through Paystack. Shops' Mobile Money is received directly into the shop's own wallet |
| Recurring charges need the payer's clear authorisation, and a way to cancel | Mansora | **Partly** | The app records the authorisation (mandate), limit and approval time. Draft wording: [direct-debit-consent.md](direct-debit-consent.md). Must be shown before the client approves |
| C56 Mobile Money confirmation | Shops, through a licensed provider | **Open** | If built, money flows through a licensed provider (Paystack, Hubtel or similar) straight to the shop. Mansora must not sit in the flow of funds without a licence |

## 5. Tax: VAT Act, 2025 (Act 1151) and Revenue Administration Act, 2016 (Act 915)

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| VAT, NHIL and GETFund on taxable supplies by registered persons. From 1 January 2026: VAT 15%, NHIL 2.5%, GETFund 2.5%, COVID-19 levy removed, flat-rate scheme abolished, goods registration threshold GHS 750,000 | Shops that are VAT-registered. Mansora for its own fees | **Open** | Product cannot yet show tax lines (C46). Confirm figures and whether service providers like Mansora must register regardless of turnover. See [tax-vat.md](tax-vat.md) |
| Issue VAT invoices, including through GRA's E-VAT system when GRA requires it of the taxpayer | VAT-registered shops; Mansora if registered | **Open** | E-VAT integration planned after C46 |
| Keep business records for the period the tax law requires (commonly six years) | Both | **Partly** | Sales, payments and invoices are never deleted. The retention period in [retention-schedule.md](retention-schedule.md) assumes six years, to be confirmed |
| Withholding tax on payments by certain businesses | Shops paying Mansora | **Open** | Ask the accountant whether larger clients must withhold tax on Mansora's fees, and how the invoice shows it |

## 6. Companies Act, 2019 (Act 992) and business identity

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Show the registered name and number on business documents and websites | Mansora | **Open** | Add to invoices (issuer settings), website footer, terms and emails |
| Business name registered for the trading name "Mansora" | Mansora | **Open** | Confirm the registration covers "Mansora Sales & Stock" |

## 7. Labour Act, 2003 (Act 651) and staff

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Fair treatment of workers, including when records are used for discipline | Shops | **Partly** | Every sale, refund, discount, cash movement and sign-in is logged against a person. Staff must be told: [staff-notice.md](staff-notice.md). Personal logins only, no shared passwords |
| Keep employment records | Shops | **Not in product** | Mansora is not a payroll system. Staff records hold name, role, username and optional email only |

## 8. Customer credit and other sector rules

| Obligation | Applies to | State | What is open |
|---|---|---|---|
| Credit Reporting Act, 2007 (Act 726): only licensed bureaus collect and share credit information | Shops and Mansora | **In place** | Shop customer debts stay in that shop. Mansora never shares them between shops or with bureaus. Keep it that way in writing (agreement clause 4) |
| Debt collection must not harass or shame customers | Shops | **Partly** | Debt reminders are drafts the staff choose to send. Guidance to add: no posting debts publicly, no messages to third parties |
| Consumer protection: Act 772 consumer provisions; Protection Against Unfair Competition Act, 2000 (Act 589). A general consumer protection bill has been pending; check whether it has passed | Shops and Mansora | **Open** | Receipts already show business name, items, prices and totals. Refund rules are the shop's; the receipt footer can state them |
| Pharmacies: Health Professions Regulatory Bodies Act, 2013 (Act 857), Pharmacy Council rules; Public Health Act, 2012 (Act 851), FDA Ghana | Pharmacy clients | **Open** | Do not offer to pharmacies until batches and expiry (C63) exist and the lawyer lists the record-keeping duties |

## 9. Product tasks the legal pack creates

| Task | Why |
|---|---|
| L1 Show the right notice and record acceptance: terms and agreement accepted by the owner at activation, with version and time; staff notice shown at first sign-in; customer notice printable for the shop counter | Act 843 openness; Act 772 records of agreement |
| L2 Show Mansora's registered name, address, number and DPC registration number on invoices, website and emails | Act 772, Act 992 |
| L3 One-person data export and a reviewed erasure route that keeps financial totals | Act 843 rights |
| L4 Off-site server backups and a rehearsed restore (C38) | Act 843 security; Act 772 record integrity |
| L5 Decide the hosting region and list subprocessors in the agreement | Act 843, disclosure of processing outside Ghana |
| L6 Named breach lead, contact list, yearly breach drill | Act 843 notification; Act 1038 reporting |
| L7 Opt-out link on any marketing email | Act 772 |

## Owner actions, in order

1. Register Mansora with the DPC and name the data protection supervisor.
2. Decide the hosting region (stay in the US with safeguards, or move to the EU), and set up backups.
3. Have a Ghanaian lawyer review this pack: terms, data processing agreement, notices, retention schedule.
4. Ask the accountant to confirm Mansora's own VAT position and the six-year record period.
5. Add the company's registered details to invoices and the website.
