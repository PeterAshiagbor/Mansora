> Release note (16 November 2026): this checklist is retained from PR #95 as planning guidance. The deployed implementation is `core/evat.ts` from PR #98; references to the earlier fiscal prototype/configuration are historical. No sandbox result or completed checklist item grants GRA certification. Confirm requirements with the assigned GRA officer.

# GRA onboarding checklist and integration blockers (draft)

These are the things only a person at Mansora (or a client) can do. Until each is done
the related fiscal feature must report itself **blocked**; nothing is silently
simulated. Same convention as [payment provider onboarding](../billing/provider-onboarding.md).

**Unverified:** the portal names, forms and process below come from general
knowledge, not from GRA documents Mansora holds. Treat every step as "confirm with
GRA". Engineering design: [gra-fiscalisation-design.md](gra-fiscalisation-design.md).

## Integration blockers

| # | Blocker | Who | Effect while open |
| --- | --- | --- | --- |
| G1 | ~~Decide the legal model~~ **Decided:** each client is the registered taxpayer; clients are in scope once the platform's turnover rules register them for VAT. Still to confirm with GRA: whether Mansora must itself be approved as a software/solution provider, and per-client credential issue | Mansora owner + tax adviser | Credentials must be applied for per client |
| G2 | **Registered taxpayer standing**: TIN, VAT registration status, tax clearance for the applicant entity | Applicant | GRA will not onboard a non-compliant taxpayer |
| G3 | **Formal contact with GRA's E-VAT / integration team** and application for solution-provider or taxpayer onboarding (route to be confirmed by GRA) | Mansora owner | No access to spec or sandbox |
| G4 | **Approved integration specification** (current version, in writing) | GRA | Adapter cannot be written; all `[GRA-TBC]` items stay open |
| G5 | **Sandbox / test environment access** and test taxpayer + device credentials | GRA | Real adapter cannot be exercised; only the fake server is used |
| G6 | **Written answers** to design decisions F-1, F-3, F-4 (offline submission, device identity, refunds) | GRA | Offline behaviour and restore design unconfirmed |
| G7 | **Production taxpayer and device credentials** per client/device, with issue and revocation process | GRA + each client | No live go-live |
| G8 | **Certification / acceptance testing** with GRA: agreed test script, evidence, defect handling | Mansora + GRA | No sign-off |
| G9 | **Written GRA sign-off for go-live**, scoped to named clients and version | GRA | Must not fiscalise live clients |
| G10 | **Reference hardware**: Windows laptop and receipt printer able to print the QR at the required size (see hardware test script) | Mansora | QR legibility unproven |
| G11 | **Code-signing certificate and production cloud** (already open for v0.1; a signed build is likely expected for a fiscal client) | Mansora | Cannot ship to clients |
| G12 | **Legal/privacy review** (Act 843 data-protection registration, taxpayer data in the cloud, retention periods for fiscal records) | Mansora + lawyer | Retention and hosting unconfirmed |
| G13 | **Support model** (design F-6): who handles rejections and credential re-issue | Mansora | Operational gap at go-live |

## Questions to put to GRA (copy into the first meeting/e-mail)

1. Which regime applies to our clients' POS software, and is there a solution-provider approval/listing process?
2. Please send the current integration specification, sandbox access and test credentials.
3. May an invoice be completed offline and submitted later? Maximum delay? Required wording on the interim receipt?
4. Is a local signing/fiscal device or component required, and who certifies it?
5. Credential model: per taxpayer, per branch, per device? Procedure when a laptop is lost, replaced or restored from backup?
6. How are refunds and cancellations reported, and what if the original is not yet acknowledged?
7. What identifies an invoice uniquely (so a retry cannot duplicate it)? Is there a status-query endpoint?
8. Signature and QR: who produces them, what algorithm/content, minimum print size?
9. Tax codes, levies and rounding rules to apply; how are rate changes handled?
10. Required clock accuracy and time source.
11. Rate limits, maintenance windows, and expected availability.
12. Record-retention requirements for the software vendor and the taxpayer.
13. What exactly does certification test, how long does it take, and what constitutes sign-off?
14. Do Mansora's own subscription invoices to clients need fiscalisation?

## What Mansora should collect and keep

| Item | Where it lives |
| --- | --- |
| Application reference numbers and correspondence | Mansora records (not in the repository) |
| Specification version and date | Referenced from the design doc once received |
| Credentials | **Never in the repository, tickets, chat or e-mail**; delivered into the environment/secrets store only |
| Test evidence and sign-off letter | Mansora records; summary linked from the readiness report |

## Environment variables (provisional names; real ones set when the spec is known)

| Variable | Purpose |
| --- | --- |
| `GRA_ENV` | `sandbox` or `production`; production refuses to start without sign-off flag |
| `GRA_BASE_URL` | Endpoint from the specification |
| `GRA_PROVIDER` | `sandbox` (fake) \| `gra` (real); default `sandbox` outside production |
| Credential variables / key files | Names and format from the specification; stored as secrets, never committed |

## Readiness gates

| Gate | Done when |
| --- | --- |
| **Gate 1 — Design agreed** | F-1..F-6 recorded in the decision log; this checklist reviewed |
| **Gate 2 — Build without GRA** | Phases F1–F3 pass the failure-mode tests against the fake server |
| **Gate 3 — Spec in hand** | G3, G4, G5, G6 closed; every `[GRA-TBC]` replaced or removed |
| **Gate 4 — Sandbox passes** | Real adapter passes the same tests against GRA sandbox; keys handled per design section 9 |
| **Gate 5 — Hardware proven** | QR and fiscal block verified on the real printer and laptop (G10) |
| **Gate 6 — GRA certification** | G8 closed with evidence |
| **Gate 7 — Go-live** | G9 sign-off received; G11–G13 closed; supervised pilot with one client; owner approves |

**Do not submit live invoices to GRA during development.** Use live credentials only
after Gate 6 and written sign-off.
