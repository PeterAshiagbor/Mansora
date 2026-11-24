# Sign-in and account setup

There is **one sign-in page** for every account: `/signin/` (the root address redirects there). It asks for two things only, **username or email** and **password**. There is no account-type choice.

- A shop owner, manager or cashier lands in their own workspace at **`/app/`**. The shop is taken from the signed-in session, never from the address, so the address is the same for every business and cannot be edited to reach another one.
- A Mansora administrator lands in the console at `/admin/`. Administrator two-factor authentication is unchanged: a correct password is followed by the authenticator or recovery code.
- **Signing out, an idle lock, an expired session, the back button, or opening `/app/`, `/admin/` or an older shop address (`/client/<shop>/`) while signed out all go to `/signin/`.** Neither the shop application nor the console shows a sign-in form of its own when hosted. A signed-in person who opens an older shop address is taken to their own workspace at `/app/`.
- The packaged Windows application and local development still show their own offline sign-in screen, because there is no central page there.

No engine token is sent to JavaScript. The shop session cookie is HttpOnly, SameSite=Strict, Secure over HTTPS and holds one signed-in shop per browser; signing in again replaces it. Each loaded page names the shop it was opened for on every request; if another tab has since signed the browser in to a different business, the request is refused (nothing is saved) and the page reloads into the business now signed in. An administrator invitation link (`/admin/#admin-invite=…`) is accepted in the console, which then hands over to `/signin/` with the email filled in. Administrator tokens keep the existing tab-scoped sessionStorage transport. Passwords, codes and tokens never enter query strings; an `#email=` or `#username=` fragment only pre-fills the username box and is removed from the address straight away.

### How the account is found

1. The username or email is looked up across the hosted shops (staff usernames, `username@shop` sign-ins, owner emails and staff members' recorded emails) and the administrators.
2. If it belongs to **one** account, that account's normal sign-in runs, including its own lockout after repeated failures.
3. If it belongs to **more than one** account (for example `owner` in two shops, or one email used for a shop and for administration), each account keeps its own password and **the password decides**. The stored hashes are compared without counting a failure against accounts the person was not trying to open.
4. Only if the same password opens more than one of those accounts does the person see a short list of **their own** accounts to choose from, after the password has been proved. Nothing is listed for a wrong password.

The legacy `admin:email` and shop-qualified `username@shop` sign-ins still work. Attempts stay rate-limited per address and per username.

### Forgotten passwords

**Forgot your password?** on the sign-in page sends a business owner a private reset link at the owner email recorded for their business. The answer is the same whatever email is typed, so it reveals no account. Staff ask their business owner to reset their password. Reset links and setup links finish on `/signin/` with the username filled in.

## Identities and uniqueness

Hosted staff creation/renaming rejects a case-insensitive username already held in another loaded shop, the same shop or a pending owner invitation: **This username is taken. Choose another username.** Disabled accounts retain their names. Requests require the normal staff-management permission; anonymous callers cannot use this as an account directory. Validation and saving occur without intervening asynchronous work after the authoritative check; concurrent claims are tested.

Existing local usernames are not destructively renamed. Every hosted account also has a distinct public sign-in `username@workspace-id`, shown on the authorised Staff page; it is never required, because a repeated name such as `owner` is told apart by its password (see above).

Passwords remain independent salted hashes. A password is compared only against the accounts that share the typed username or email; it is never used to search other accounts. Existing passwords remain unchanged. Native/offline usernames are unique within their local shop; public canonical usernames include the workspace so independently created offline accounts cannot make public routing ambiguous. This change does not create a global identity service for disconnected laptops.

Owner email aliases follow authorised username changes in the running gateway and are rebuilt from the actual owner account after restart. Registry/journal originals remain private recovery metadata, not the authoritative current password or username.

## Mansora-created owner accounts

1. A signed-in Mansora administrator creates the client with the recorded owner email.
2. Open **Browser workspace**, optionally assign an owner username, and select whether to email the private setup link.
3. Choose **Create owner setup link**. An assigned username is reserved and cannot be overridden through public setup. Leaving it blank lets the owner choose a unique username.
4. The owner follows the private, single-use link, chooses a password and completes setup. No administrator chooses or sees that password.
5. The owner signs in at the main address with their username or recorded email.

Setup links expire after 30 minutes. Email acceptance is reported as acceptance for delivery, not proof that a person received it. A failed email can be retried using the existing private setup operation; no account password is reset. A pending invitation with different assigned username choices needs review or expiry rather than silent replacement. Active devices and completed stores are not overwritten.

## Purchased-account self-service

The sign-in page links to **Set up a purchased account**. Enter the recorded owner email. `/v1/accounts/purchased-setup` sends an email proof only for one unambiguous client with a current active/trial subscription and a positive-value subscription invoice fully covered by net, non-sandbox payment allocations. Refunds, credits, write-offs, disputed/unpaid invoices, suspended/closed clients and existing active installations cannot be used to create a new workspace. The email proof is delivered only to the recorded owner, never to a public request's alternative address. Unknown/unpaid/ambiguous emails receive the same generic 202 response, without a business name, link or token. Requests are bounded per IP and email. Email configuration and an explicitly configured service issuer are required.

The purchaser follows the one-time email link and chooses a globally available hosted username and a password. Paid eligibility is rechecked at completion so refunding a purchase after requesting a link cannot activate it. Setup reserves the username before network activation and retries preserve the same account. Payment return pages/screenshots are not evidence of payment; the billing ledger is authoritative. Self-service requests are audited as system requests, not administrator clicks; activation-code issuance uses the explicitly configured service operator.

This is setup for a purchase already recorded in billing, not a new public product catalogue or unrestricted free signup. The existing payment-link checkout was exercised with the sandbox provider and its signed webhook. Production rejects sandbox-only or mixed sandbox funding as purchase entitlement; only an explicitly configured synthetic test host may accept simulated purchase proof. Live provider onboarding/settlement and public purchase distribution remain separate; never remove sandbox warnings or claim a real charge from that test.

## Team onboarding

The business owner uses **Staff → Add staff member**, assigns a unique username, records the email and selects **Email them a one-time code so they choose their own password**. Normal staff-management permissions still apply; platform access alone does not grant access to shop financial records or impersonate the shop owner.

The invitee opens the public sign-in page, chooses **I have a sign-in code**, enters the assigned username and emailed code, and chooses their password. Successful proof acceptance signs them into their assigned workspace; replay fails. A legacy username repeated in several shops needs its shop-qualified form here, because a new password cannot tell the accounts apart. Codes expire after 48 hours and the engine retains its failed-code limit. The owner can resend an expired code. Invitation emails link to the one sign-in page with the email filled in.

## Deployment and retained safeguards

Use `client` deployment mode on production and `team-test` on staging. Both roots use the same private sign-in page. Production administration/new real clients carry no blanket team-test notice. Explicit synthetic shops remain identified inside their authorised workspace using the private test-account manifest. Their financial records, synthetic labels and audit history remain unchanged. Switching mode does not enable real payments, installer signing, GRA certification or independent backups.

Validation and deployment evidence is recorded in the release PR and shared board. Browser coverage includes administrator → assigned owner/email proof → chosen password → owner sign-in → team invite → staff password setup → cashier workspace; a completed sandbox purchase → email proof → chosen username/password → owner workspace → team invite; duplicate names, assigned-username override, refund-before-activation, proof replay, isolation, mobile sign-in layout and accessibility. These are disposable local browser/API/store checks, not real mail delivery, real payment settlement or physical hardware acceptance.

Production request-driven account invitations, staff codes and owner recovery use the verified Resend sender with recorded client recipients. The separate billing/background notification adapter retains its existing recipient allowlist; this release does not flush previously blocked test mail. Staging cannot enable the client account adapter. Provider acceptance/delivery remains distinct from local mocked email tests.

For an authorised read-only live sign-in rehearsal, set the existing `MANSORA_TSB_ACCEPTANCE` operation selector to `signin-v1` for a deployment. It checks the public root and authenticates the six existing TSA/TSB roles, verifies each lands on `/app/` in its own shop with an HttpOnly cookie, and checks cross-shop isolation, and logs sanitised results. It does not reset accounts, write financial facts or send mail. Clear the selector without redeployment after observing the result. Other operation values retain the existing sale/refund acceptance behaviour.
