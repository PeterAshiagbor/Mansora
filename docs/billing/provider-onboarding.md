# Payment providers — onboarding checklist and integration blockers

These are the things only a person at Mansora can do. Until each is done the related feature reports itself as **blocked** in *Payment settings*; nothing is silently simulated.

## Integration blockers

| # | Blocker | Who | Effect while open |
| --- | --- | --- | --- |
| B1 | **Paystack business account** for Mansora (business verification, settlement bank account) | Mansora owner | No card or one-off online payments. Manual recording and pay-by-link pages work only against the sandbox |
| B2 | **Paystack test keys** (then live keys after approval) → `PAYSTACK_SECRET_KEY` | Mansora | Adapter cannot be exercised against Paystack's real test environment. It is currently verified **only against a local fake** that follows Paystack's documented API |
| B3 | **Webhook URL** `https://<public host>/v1/webhooks/paystack` registered in the Paystack dashboard | Mansora + hosting | Payments confirmed only by the reconciliation job (every 15 min), not instantly |
| B4 | **Hubtel merchant account**, written confirmation of the recurring Mobile Money API, mandate rules, limits and fees, plus sandbox credentials | Mansora ↔ Hubtel | Automatic Mobile Money debit is unavailable. The Hubtel adapter is a stub that refuses to charge |
| B5 | **Email provider** (SMTP or API) and a verified sending domain | Mansora | Invoices, reminders and receipts stay "queued" in *Collections → Messages*. Nothing is delivered |
| B6 | **Public HTTPS base URL** → `PUBLIC_BASE_URL`; hosting | Mansora | Payment links and provider return pages cannot work outside local development |
| B7 | **Secrets** `PAY_LINK_SECRET` (random) and `BILLING_ENCRYPTION_KEY` (32 random bytes, base64) | Mansora ops | Server refuses to start in production without them |
| B8 | **Legal review** of subscription terms, direct-debit consent wording, refund policy, tax (VAT/levies) treatment and invoice content | Mansora + lawyer | Defaults are drafts (decision log D-24 to D-35); no tax is added unless configured |
| B9 | **Settlement report process**: how Paystack/Hubtel payout reports reach the finance team to record under *Payments → Provider payouts* | Mansora finance | Payout reconciliation is manual |

## What was confirmed about the providers (and what was not)

- **Paystack:** supports cards with a reusable authorisation and one-off checkout including Mobile Money. Paystack's [Pay with Mobile Money](https://support.paystack.com/hc/en-us/articles/360012174020-Pay-with-Mobile-Money) support article was reported to say that **recurring payments are not currently possible on the Mobile Money channel in Ghana**, so Mansora does not offer automatic Mobile Money through Paystack. This was read through a search summary rather than directly from the live page: **re-confirm with Paystack in writing** before relying on it either way.
- **Hubtel:** publishes a payments API and developer portal ([developers.hubtel.com](https://developers.hubtel.com/)). A **recurring/direct-debit Mobile Money API was not confirmed** from public documentation, so none is assumed.
- Fees, limits and settlement times for both must be confirmed with each provider in writing before any pricing is promised to clients.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Paystack secret key. Test key first. Never in the front end |
| `PAYSTACK_BASE_URL` | Optional override (tests point it at a local fake) |
| `BILLING_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts saved payment tokens |
| `PAY_LINK_SECRET` | Signs payment links |
| `PUBLIC_BASE_URL` | Public HTTPS address of the API (links, return pages) |
| `BILLING_ADMIN_EMAIL` | Receives escalations |
| `BILLING_SANDBOX` | `0` disables the sandbox provider |
| `BILLING_ALLOW_SANDBOX` | `1` allows the sandbox provider in production (never use for real clients) |

## Acceptance script for the first provider connection (sandbox/test keys only)

1. Set the test key and webhook; open *Payment settings*: Paystack shows **connected**.
2. Create a plan, a client with an email, a subscription; submit; confirm an invoice exists.
3. Open the pay link; pay with a Paystack **test** card; confirm the invoice turns **paid** and a receipt exists.
4. Re-send the same webhook: nothing duplicates. Send a webhook with a bad signature: refused.
5. Pay with a declined test card: the attempt is **failed**, the invoice stays open, reminders continue, the service is not suspended.
6. Set up a card authorisation; run *Create due invoices and collect*: one charge, one receipt.
7. Cancel the authorisation: no further automatic charge.
8. Refund the payment through the provider; confirm the invoice outstanding returns.
9. Check *Revenue reports* matches the sandbox/test figures you expect, and that sandbox payments are excluded.

**Do not run live charges during development.** Move to live keys only after B1–B9 are closed and Mansora approves a supervised pilot.
