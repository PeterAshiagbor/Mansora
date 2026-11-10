# Desktop workflow browser checks

C9 adds `tests/e2e/desktop-workflows.test.ts`, using Chromium, the real built desktop interface, an encrypted local store and the localhost embedded PostgreSQL API. Application records are created through the interface; direct local database access in the test is read-only verification of accounting/permission invariants. Administrative API calls provision synthetic activation/recovery/re-link fixtures. Staff passwords and database keys are generated at runtime; no production clients or devices are used.

The eight ordered scenarios cover:

1. Activation, owner login, manager/cashier creation with explicit restricted/delegated permissions, product/customer creation and the owner-set discount limit. The limit value is a synthetic test fixture, not an approved default policy.
2. A physical-count entry from 10 to 8, receipt of four units at GHS 9 against eight at GHS 6 (resulting average cost GHS 7), and one damaged unit; movement quantities and costs are verified.
3. Real Excel preview with a bad price and an existing-product duplicate, blocking commit on errors, successful clean import with opening-stock confirmation, skipped existing stock, and an identical-file re-import refusal with no duplicate stock/batch.
4. A cashier credit sale requiring supervisor approval, partial cash repayment, mobile-money settlement, zero remaining debt and a settled record. Restricted staff cannot see cost columns or create products/manage staff; cashier-only settings controls are absent.
5. A 20% discount against a synthetic 10% owner ceiling: the manager's credentials are refused without creating a sale, and the owner's credentials complete it with the correct authoriser and amount.
6. Supervisor-approved cash in/out, a cash expense from the till, expected cash of GHS 122, a counted GHS 120 with required variance explanation, and sign-off by a different authorised staff member. A manager with delegated general settings permission still cannot edit owner-only discount/negative-stock controls.
7. Encrypted backup creation and successful passphrase/integrity verification through the interface, including the expected sale count.
8. Owner-password recovery through the recovery screen, refusal of another tenant's re-link code, and successful re-link with a replacement device identity. Sales, repayments, stock/cost and acknowledged outbox state are preserved.

The sequence intentionally shares one synthetic shop to verify that effects reconcile across workflows, following the existing cashier browser test style. Each scenario retains its assertions; focused development runs used fail-fast diagnostics to locate setup/selector errors, and final regression validation runs the complete suite. The new tests do not change permissions/defaults, host/static-server shims, the sync contract, released migrations or existing assertions.

The new scenario initially used an exact Barcode label that omitted the existing hint text; the locator was corrected to identify the actual field across both existing and linked-label interfaces. No application defect requiring a product-code fix was found in these scenarios. The test also accepts the explicit Request discount entry point from the separate retail-pricing PR while retaining the same approval and accounting assertions.

To run after building both interfaces with the normal browser dependencies installed:

```sh
npm run test:e2e
```

The main CI job installs Playwright/Chromium and executes these tests with `npm test`. Core-only jobs follow the repository's existing browser-test convention when Playwright/build artifacts are absent. Local validation executes all browser tests rather than relying on a skipped suite.

These checks do not validate physical cash counts, scanners/printers, payment-provider settlement, Windows screen readers or the native backup-restore file picker/restart. Mobile money/card entries are records only. The backup test verifies actual encrypted file creation/opening, but does not claim a packaged Windows restore or a lost-laptop hardware drill. Those remain separate acceptance checks.
