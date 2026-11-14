# DRAFT — not legal advice — for review by a Ghanaian lawyer

# Data processing agreement (Mansora and the client)

Version: draft 0.1, 2026-11-14. Part of the [terms of service](terms-of-service.md). The questions this answers
are listed in [controller-processor-outline.md](controller-processor-outline.md).

## 1. Roles

1.1 For **client data** (the client's sales, stock, customers, credit, staff, suppliers, expenses and audit records),
the client is the **data controller** and Mansora is the **data processor** under the Data Protection Act, 2012 (Act 843).

1.2 For its **own records** Mansora is the controller: the client's business contact details, the owner's contact
details, Mansora's invoices and payments, administrator accounts, and security logs about the service. These are
described in [mansora-privacy-notice.md](mansora-privacy-notice.md).

## 2. What Mansora processes, and why

| | |
|---|---|
| People | The client's customers, staff, suppliers and owner |
| Data | Names, usernames, roles, optional phone numbers and emails, purchases, payments, credit balances and repayments, notes, staff actions (audit log), device and sign-in records. Details in [data-inventory.md](data-inventory.md) |
| Purposes | Hosting the browser version; syncing and backing up the offline version; restoring a shop to a new laptop; sending emails the client asks for (staff sign-in codes, daily summary); support when the owner grants it |
| Duration | While the terms are in force, then as in clause 9 |

Mansora processes client data only on the client's documented instructions. Using the service as designed, and
settings the owner chooses, count as instructions. Mansora will tell the client if it thinks an instruction breaks the law.

## 3. What Mansora will not do

Mansora will not sell client data, use it for advertising or for training AI models, combine it with other clients'
data except as anonymous counts, or share customer debts with other shops or credit bureaus.

## 4. Confidentiality and access

4.1 Only Mansora staff who need access to run the service have it, and they are bound by confidentiality.

4.2 The administration dashboard does not show the client's customer or sales records. Mansora sees the client's
reports only when the owner grants **support access** in the app, for 1 hour to 3 days. The owner can end it at any time.

4.3 Direct access to the database or servers is limited to [named people], used only to fix faults, restore data or
respond to a security incident, and recorded. [Set up a written log of such access and review it every quarter.]

4.4 Before issuing an owner recovery code or moving a shop to a new laptop, Mansora checks the request comes from the
owner by [calling the owner on the phone number on record, and checking two account details].

## 5. Security

Mansora keeps these measures in place and will not reduce them without telling the client:
- Each person signs in with their own account. Passwords are stored only as salted hashes.
- Administrators use two-factor authentication.
- Each client's cloud records are separated by database row-level security.
- Data travels over encrypted connections (HTTPS/TLS).
- The offline laptop store is encrypted (AES-256, SQLCipher). Laptop backups are encrypted with a passphrase only the client knows.
- An audit log records sign-ins, refunds, discounts, price and stock changes, cash movements and support access.
- [Off-site, encrypted server backups with a restore tested at least twice a year. **Not yet in place**: task C38.]
- [Software updates and security patches applied within 14 days, or 48 hours for serious issues.]

## 6. Subprocessors

The client agrees Mansora may use these subprocessors. Mansora will give 30 days' notice before adding or replacing one;
the client may object and, if Mansora cannot meet the objection, cancel without penalty.

| Subprocessor | What it does | Where |
|---|---|---|
| Railway Corporation | Hosts the servers, database and browser shop stores | United States (region `sfo`) |
| Resend | Sends emails (sign-in codes, invoices, reminders, daily summaries) | United States |
| Paystack Payments Limited | Takes card and Mobile Money payments of Mansora's fees. Sees only billing contact and payment details, not shop records | Ghana / Nigeria; parent company in the United States |
| [Backup storage provider, once chosen] | Off-site encrypted backups | [Country] |

## 7. Processing outside Ghana

7.1 At the date of this agreement, client data is stored in the **United States**.

7.2 Mansora protects it there by: encryption in transit; access limited as in clause 4; subprocessors bound by written
terms that require security and confidentiality; and not allowing subprocessors to use the data for their own purposes.

7.3 Mansora will follow any direction or guidance of the Data Protection Commission on transfers, and will move the data
to another region if the law or the Commission requires it. [Decision open: whether to move to an EU region, where
providers give stronger data protection commitments.]

## 8. Helping the client

8.1 **Requests from people.** If a customer or staff member asks Mansora about their data, Mansora passes the request to
the client within 3 working days and does not answer it itself. Mansora helps the client find and export the records.

8.2 **Security incidents.** Mansora tells the client without undue delay, and within 48 hours of becoming aware, of any
breach affecting client data, with what is known, and keeps the client updated. The client decides whether to notify
the Data Protection Commission and the people affected; Mansora helps. See [breach-response.md](breach-response.md).

8.3 **Checks.** Mansora answers reasonable written security questions from the client once a year, and when an incident happens.

## 9. When the agreement ends

9.1 The client can export all its data at any time from the app, including after cancellation.

9.2 Mansora keeps the client's cloud data for [90] days after the end, then deletes it from live systems. Copies in
backups are deleted as the backups expire, within [35] further days.

9.3 Mansora keeps only what the law requires it to keep for its own purposes (its invoices and payments), as set out in
the [retention schedule](retention-schedule.md).

9.4 Data on the client's own laptops, and exports and backups the client made, are under the client's control.
Mansora cannot erase them remotely.

## 10. Liability

The limits in clause 8 of the terms of service apply to this agreement.
