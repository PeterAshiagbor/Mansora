# DRAFT — not legal advice — for review by a Ghanaian lawyer

## Legal pack (Ghana)

**Status (2026-11-14):** engineering drafts, written from the code and the decision log, for a Ghanaian lawyer and tax
adviser to review. Nothing here is approved, and none of it is shown in the product yet.

### Start here
- [Compliance register](compliance-register.md): every Ghanaian law that applies (Act 843 data protection, Act 772 electronic
  transactions, Act 1038 cybersecurity, Act 987 payments, Act 1151 VAT, Act 915 revenue administration, Act 992 companies,
  Act 651 labour, Act 726 credit reporting, consumer and pharmacy rules), who it binds, what the product does, and what is open.

### Agreements and notices
- [Terms of service](terms-of-service.md): Mansora and the client, including the non-payment policy (D-28).
- [Data processing agreement](data-processing-agreement.md): Mansora as processor of shop data, subprocessors, transfers.
  Questions behind it: [controller-processor-outline.md](controller-processor-outline.md).
- [Customer privacy notice](privacy-notice.md): short counter version and full notice, for each shop.
- [Staff notice](staff-notice.md): logins and what is recorded about staff.
- [Mansora privacy notice](mansora-privacy-notice.md): Mansora's own records.
- [Automatic payment wording](direct-debit-consent.md).

### Procedures
- [DPC registration](dpc-registration.md): for Mansora and for each shop.
- [Breach response plan](breach-response.md).
- [Retention schedule](retention-schedule.md) (proposed periods) and [retention questions per table](retention-deletion.md).
- [Tax and VAT notes](tax-vat.md).
- [Ghana review checklist](ghana-review-checklist.md): the lawyer's questions.

### Key facts
- Cloud data is hosted by Railway in the **United States** (region `sfo`). Email: Resend (United States). Payments: Paystack.
  This is processing outside Ghana and must be disclosed and protected (compliance register, section 1).
- No server backups exist yet (C38).

### Schema coverage check

From the repository root:

```sh
npx tsx --test docs/legal/inventory.test.ts
```

The test migrates fresh in-memory SQLite and embedded PostgreSQL databases, reads schema metadata only, and checks every
column against the [data inventory](data-inventory.md) ([machine-readable](data-inventory.json)), every sync field on both
sides, and that every table has a retention entry. A new column missing from the inventory fails it. Review each new field
for purpose, access and copies; do not regenerate the inventory just to make the test pass.
