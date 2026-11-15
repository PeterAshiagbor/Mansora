# GRA fiscalisation — design (draft)

**Status: draft for Mansora review. Nothing here is implemented.**

> **Read this first.** Mansora has not yet obtained the Ghana Revenue Authority (GRA)
> approved integration specification. Everything GRA-specific in this document —
> endpoint behaviour, field names, signature algorithm, QR content, timing rules,
> offline allowances — is an **assumption, marked `[GRA-TBC]`**, and must be replaced
> with the approved specification before any code that talks to GRA is written.
> The parts that do **not** depend on GRA (state machine, storage, retry, key
> handling, receipts, test harness) can be built now and are designed so that the
> GRA-specific part is one replaceable adapter.

The onboarding steps, credentials and sign-off gates are in
[the onboarding checklist](gra-onboarding-checklist.md).

## 1. Goal

Every qualifying sale and refund made on a Mansora shop laptop is reported to GRA,
receives a GRA acknowledgement, and the customer receipt carries the fiscal proof
(acknowledgement reference, signature and QR code), without breaking the
properties the platform already guarantees: **the laptop works with no internet,
never double-records a sale, and never loses a record.**

## 2. The central tension: offline-first vs. fiscal acknowledgement

Mansora's laptop is the system of record and sells with no internet. Fiscal regimes
usually want an invoice acknowledged by the authority (or its device) *as the
receipt is issued*. These conflict unless GRA permits one of:

| Option | Behaviour | Needs from GRA |
| --- | --- | --- |
| **A. Deferred submission** | Sale completes offline; receipt prints marked *"fiscal confirmation pending"*; invoice is submitted when online; confirmation is attached later (reprint / SMS / e-mail) | Written confirmation that deferred submission is allowed, and the maximum delay |
| **B. Local fiscal device / VSDC-style component** | A certified local component signs invoices offline and forwards them later | Spec and certification of the local component; whether Mansora may build it or must use an approved one `[GRA-TBC]` |
| **C. Online-only fiscal** | Sale cannot complete without GRA acknowledgement | None, but **breaks the offline guarantee** and is unsuitable for small shops with poor connectivity |

**Recommendation:** design for A and B behind the same interface; do not commit to
C. Which one is legally available is **decision F-1** and is answered only by GRA.
The design below works for A and B unchanged; C would be a configuration flag that
blocks `sale.complete` until the adapter returns an acknowledgement.

## 3. Design principles (reuse what already exists)

1. **Insert-only fiscal facts.** Like sales and payments, fiscal records are
   immutable. A retry, rejection or acknowledgement is a *new row*, never an update
   (`docs/architecture/overview.md`, "Records that cannot be changed").
2. **Same transaction.** The fiscal document is created inside the `sale.complete`
   / `refund.*` transaction together with the sale, so a crash cannot leave a sale
   with no fiscal record, or the reverse.
3. **Idempotent by construction.** Each fiscal document has a stable local ID and
   an idempotency key derived from it. Resubmitting after a lost response must be
   safe, either because GRA dedupes on that key `[GRA-TBC]` or because Mansora
   queries status before resubmitting.
4. **Adapter boundary.** All GRA specifics live in one `FiscalProvider` adapter,
   the same pattern as the Paystack/Hubtel payment adapters, with a **sandbox
   provider** and a **fake GRA server** for tests. Until credentials exist the real
   adapter reports itself **blocked** (never silently simulated), as the billing
   module does.
5. **Printing never affects the sale.** As today, print happens after commit and
   can be repeated; a fiscal block must not block cash handling unless Option C is
   chosen.

## 4. Data model (proposed)

New insert-only tables on the laptop, synced to the cloud tenant plane with row-level
security like every other business table.

**`fiscal_documents`** — one per sale or refund that must be reported.

| Column | Notes |
| --- | --- |
| `id` | UUID, created once per sale/refund |
| `kind` | `invoice` \| `credit_note` (refunds) \| `debit_note`/`cancellation` `[GRA-TBC]` |
| `sale_id` / `refund_id` | foreign reference to the source record |
| `fiscal_number` | local sequential number, gap-free per device; separate from the receipt number unless GRA requires one sequence `[GRA-TBC]` |
| `payload_hash` | SHA-256 of the canonical payload actually submitted |
| `payload` | canonical JSON/XML as defined by GRA `[GRA-TBC]`, frozen at creation |
| `created_at` | UTC |

**`fiscal_events`** — append-only history for each document.

| Column | Notes |
| --- | --- |
| `document_id` | |
| `type` | `queued`, `submitted`, `acknowledged`, `rejected`, `retry_scheduled`, `failed_permanent`, `manual_resolution` |
| `attempt_no`, `at` | |
| `gra_reference`, `gra_signature`, `qr_data`, `gra_timestamp` | filled on `acknowledged` `[GRA-TBC]` |
| `error_code`, `error_detail` | on `rejected` / failure; must not contain secrets |

Current state of a document is *derived* from its latest event (a view), not stored
by mutating the document. The Sync status screen gains a "Fiscal" count: pending,
retrying, rejected, needs attention.

## 5. Document lifecycle

```
queued ──▶ submitted ──▶ acknowledged            (receipt gets proof)
   ▲           │
   │           ├──▶ retry_scheduled ──▶ submitted   (timeout / 5xx / network)
   │           │
   │           └──▶ rejected ──▶ manual_resolution   (validation / business error)
   └─────────────────── offline: stays queued
```

- **Transient failures** (no network, timeout, HTTP 5xx, rate-limit) → retry with
  exponential backoff and jitter; cap per-attempt delay (proposed 15 min) but retry
  indefinitely while the document is unacknowledged; escalate visibly after a
  configurable age (proposed 24 h, or GRA's maximum if shorter `[GRA-TBC]`).
- **Permanent rejections** (4xx validation, unknown tax code, wrong TIN) → never
  auto-retried; surface to the owner with the GRA reason; fix produces a *corrected
  new document* per GRA rules, not an edit `[GRA-TBC]`.
- **Ambiguous outcome** (request sent, response lost): before any resubmit, query
  GRA by idempotency key / fiscal number if the spec offers it `[GRA-TBC]`;
  otherwise rely on GRA-side dedupe. If neither exists this is a blocker to raise
  with GRA, because it is the one case that can produce a duplicate fiscal invoice.
- **Ordering:** submit in fiscal-number order unless GRA says otherwise `[GRA-TBC]`.

## 6. Where it hooks in

| Existing command | Change |
| --- | --- |
| `sale.complete` | Same transaction also inserts `fiscal_documents` + `queued` event; builds payload from the sale snapshot (price, tax, customer TIN if given) |
| refund commands | Insert a `credit_note` document that references the original document's GRA reference; refuse a refund of a sale whose original is `rejected`/unknown until resolved, or queue it dependent on the original `[GRA-TBC]` |
| Receipt print / reprint / PDF | Render fiscal block from the latest event: acknowledged → reference, signature, QR; pending → clear "fiscal confirmation pending" text; **reprints must be marked as copies** `[GRA-TBC]` |
| Sync outbox | Fiscal rows are ordinary outbox rows, so cloud copy and tenant isolation come for free |
| Admin dashboard | Per-client fiscal health: oldest unacknowledged document, rejected count, last success. No client financial data (existing consent rules apply) |

A background **fiscal worker** in the Electron main process drains the queue when
online. It is separate from the sync worker so a GRA outage never delays inventory
sync, and vice versa.

## 7. Tax calculation

The platform currently adds no tax unless configured (billing decision B8). Fiscal
reporting needs, per line: tax category/code, rate, taxable amount, tax amount, and
levies, with rounding rules defined by GRA `[GRA-TBC]`. This needs:

- a **tax-category per product** (default from business settings; VAT-flat-rate vs
  standard-rated vs exempt, plus levies such as NHIL/GETFund/COVID levy, **to be
  confirmed against current law, not assumed**);
- tax computed in integer pesewas with the GRA rounding rule, stored in the sale
  snapshot so a later rate change never alters a past invoice;
- a decision (**F-2**) on whether Mansora's clients are all VAT-registered or some
  are below the threshold / use a flat-rate scheme, since that changes which
  clients need fiscalisation at all (a per-business `fiscal_enabled` setting).

## 8. Signatures and QR codes

Two different things; do not conflate:

- **GRA's signature / QR**: produced or returned by GRA (or its approved device)
  and printed verbatim. Mansora stores and prints them; it does not invent them.
  Format and verification steps `[GRA-TBC]`.
- **Mansora's own request signing** (if the spec requires signing requests with the
  taxpayer/device key): algorithm, canonicalisation and clock rules `[GRA-TBC]`.

QR rendering: generated locally from `qr_data` returned by GRA, error-correction
level and minimum printed size per spec `[GRA-TBC]`; verified on the **actual
receipt printer** (hardware is currently untested, see phase report limitation 1).

## 9. Secure key and credential handling

- **What is secret:** taxpayer/device credentials, any private signing key, API
  tokens. Names and formats `[GRA-TBC]`.
- **At rest on the laptop:** stored in the existing SQLCipher database or, for
  private keys, encrypted with the DPAPI-protected key via Electron `safeStorage`,
  the same mechanism that protects the database key. Never in the renderer, logs,
  backups-in-the-clear, exports, or error reports.
- **Backups:** the encrypted backup (owner passphrase) includes fiscal state so a
  restored laptop continues the sequence; whether credentials may be restored or
  must be **re-issued per device** is a GRA question (**F-3**). A restore must never
  create two live devices sharing one fiscal identity.
- **Cloud:** Mansora's cloud stores no GRA private keys unless GRA requires
  server-side signing; if so they go in a secrets manager with the same `BILLING_`-style
  encryption-key discipline and are never visible to the admin dashboard.
- **Revocation and rotation:** deactivating a laptop (existing admin flow) also
  revokes its fiscal credential `[GRA-TBC]`; rotation procedure documented in the
  runbook before go-live.
- **Logging rule:** a lint/test asserts credentials and full payloads never reach
  logs or the audit trail; audit records contain document IDs and hashes only.

## 10. One device per store, and device identity

Version 1 allows one active laptop per store, which suits a fiscal device model.
GRA may require a distinct device/CU identifier per till `[GRA-TBC]`; if so, device
registration with GRA happens during activation and the identifier is stored with the
device record. A rebuilt or replaced laptop is a **new fiscal device** unless GRA
allows transfer (**F-3**).

## 11. Failure modes and tests

Every row below becomes an automated test against the fake GRA server before the
real adapter is trusted.

| Scenario | Expected |
| --- | --- |
| Sale while offline | Sale commits, document `queued`, receipt marked pending, no error |
| Lost response after GRA accepted | One fiscal invoice at GRA, one acknowledged event locally |
| Same document submitted twice concurrently | One submission wins; no duplicate |
| GRA down for days | Queue grows, banner escalates, nothing lost, sales unaffected |
| Validation rejection | `rejected`, no auto-retry, visible reason, manual resolution path |
| Crash (SIGKILL) mid-sale | Sale and fiscal document both absent or both present |
| Refund of acknowledged sale | Credit note references original reference |
| Refund of unacknowledged sale | Follows the dependency rule chosen in F-4 |
| Clock skew on the laptop | Rejection or warning per spec; clock check surfaced to owner |
| Restore onto new laptop | Sequence continues per F-3 or device re-registers; never two identities |
| Credential in logs | Test fails the build |
| Reprint | Marked as copy, same proof |

These extend the existing suites (`tests/integration`, `tests/sync`,
`tests/security`, `tests/e2e`).

## 12. Delivery phases

| Phase | Contents | Depends on GRA? |
| --- | --- | --- |
| F0 | This design + checklist reviewed and decisions F-1..F-6 taken | No |
| F1 | Tables, state machine, fiscal worker, retry/backoff, sandbox provider, fake GRA server, tests, Sync-status fiscal counters | No |
| F2 | Receipt fiscal block, pending marking, reprint rules, QR rendering (placeholder format) | Layout only |
| F3 | Tax categories and calculation | Partly (rates/rounding) |
| F4 | Real adapter against GRA **sandbox**: auth, signing, payload, acknowledgements, error map | **Yes — needs spec + credentials** |
| F5 | Key handling for real credentials, rotation, revocation, runbook | **Yes** |
| F6 | Physical-printer QR check, hardware pilot, GRA certification/testing | **Yes** |
| F7 | GRA sign-off, supervised pilot at one client, go-live | **Yes** |

F1–F3 can proceed now and are throw-away-safe: if GRA's model differs, only the
adapter and payload builder change.

## 13. Decisions needed

| # | Decision | Owner |
| --- | --- | --- |
| F-1 | Is deferred submission (Option A) or a local fiscal component (B) permitted? What is the maximum delay? | GRA, via Mansora |
| F-2 | Which clients must fiscalise (VAT status, thresholds)? Who is the registered taxpayer — each client, or Mansora? | Mansora + advisor |
| F-3 | Credential/device model: per business, per laptop? Can a restored/replaced laptop reuse an identity? | GRA |
| F-4 | Refund of a not-yet-acknowledged sale: block, queue dependent, or cancel the original? | GRA + Mansora |
| F-5 | Behaviour on persistent rejection: allow trading to continue with a warning, or block new sales after N rejections? | Mansora |
| F-6 | Who operates fiscal support (rejections, resubmission, credential re-issue) and how fast | Mansora |

## 14. Out of scope here

GRA's rules on e-invoicing for **Mansora's own subscription invoices** (billing
System A) are a separate question: those invoices may also need fiscalisation.
Raise it with GRA at the same time (see checklist) but design it separately.

This document is engineering design, not legal or tax advice. Confirm obligations
with GRA and a qualified Ghanaian tax adviser.
