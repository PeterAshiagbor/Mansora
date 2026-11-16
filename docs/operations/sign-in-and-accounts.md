# Sign-in and account setup

The root address redirects to `/signin/`. The branded page contains no public shop directory, test navigation or team-test signature. A successful sign-in routes an authenticated owner, manager or cashier to their own browser workspace, or an administrator to `/admin/`. Administrator TOTP/recovery-code enforcement remains in the existing API. No client engine token is sent to JavaScript; cookies remain HttpOnly, SameSite=Strict, Secure over HTTPS and restricted to the selected workspace path. Administrator tokens retain the existing tab-scoped sessionStorage transport. Passwords, codes and tokens never enter query strings.

## Identities and uniqueness

Hosted staff creation/renaming rejects a case-insensitive username already held in another loaded shop, the same shop or a pending owner invitation: **This username is taken. Choose another username.** Disabled accounts retain their names. Requests require the normal staff-management permission; anonymous callers cannot use this as an account directory. Validation and saving occur without intervening asynchronous work after the authoritative check; concurrent claims are tested.

Existing local usernames are not destructively renamed. Every hosted account has a distinct canonical public sign-in `username@workspace-id`, displayed in the authorised Staff page. Existing repeated local names such as `manager` use these qualified sign-ins. A bare username or recorded owner email works only when it identifies exactly one account across the hosted shops and platform. Ambiguous names fail before testing a password; the service never tries passwords against multiple accounts to choose a shop. An administrator who shares a recorded owner email can use `admin:email`; the owner uses their canonical shop-qualified username.

Passwords remain independent salted hashes. Global password equality is not checked or used as an identity rule. Existing passwords remain unchanged. Native/offline usernames are unique within their local shop; public canonical usernames include the workspace so independently created offline accounts cannot make public routing ambiguous. This change does not create a global identity service for disconnected laptops.

Owner email aliases follow authorised username changes in the running gateway and are rebuilt from the actual owner account after restart. Registry/journal originals remain private recovery metadata, not the authoritative current password or username.

## Mansora-created owner accounts

1. A signed-in Mansora administrator creates the client with the recorded owner email.
2. Open **Browser workspace**, optionally assign an owner username, and select whether to email the private setup link.
3. Choose **Create owner setup link**. An assigned username is reserved and cannot be overridden through public setup. Leaving it blank lets the owner choose a unique username.
4. The owner follows the private, single-use link, chooses a password and completes setup. No administrator chooses or sees that password.
5. The owner signs in at the main address with their unique username or unambiguous recorded email.

Setup links expire after 30 minutes. Email acceptance is reported as acceptance for delivery, not proof that a person received it. A failed email can be retried using the existing private setup operation; no account password is reset. A pending invitation with different assigned username choices needs review or expiry rather than silent replacement. Active devices and completed stores are not overwritten.

## Purchased-account self-service

The sign-in page links to **Set up a purchased account**. Enter the recorded owner email. `/v1/accounts/purchased-setup` sends an email proof only for one unambiguous client with a current active/trial subscription and a fully cash/provider-paid, positive-value subscription invoice. Refunds, credits, write-offs, disputed/unpaid invoices, suspended/closed clients and existing active installations cannot be used to create a new workspace. The email proof is delivered only to the recorded owner, never to a public request's alternative address. Unknown/unpaid/ambiguous emails receive the same generic 202 response, without a business name, link or token. Requests are bounded per IP and email. Email configuration and an explicitly configured service issuer are required.

The purchaser follows the one-time email link and chooses a globally available hosted username and a password. Paid eligibility is rechecked at completion so refunding a purchase after requesting a link cannot activate it. Setup reserves the username before network activation and retries preserve the same account. Payment return pages/screenshots are not evidence of payment; the billing ledger is authoritative. Self-service requests are audited as system requests, not administrator clicks; activation-code issuance uses the explicitly configured service operator.

This is setup for a purchase already recorded in billing, not a new public product catalogue or unrestricted free signup. The existing payment-link checkout was exercised with the sandbox provider and its signed webhook. Live provider onboarding/settlement and public purchase distribution remain separate; never remove sandbox warnings or claim a real charge from that test.

## Team onboarding

The business owner uses **Staff → Add staff member**, assigns a unique username, records the email and selects **Email them a one-time code so they choose their own password**. Normal staff-management permissions still apply; platform access alone does not grant access to shop financial records or impersonate the shop owner.

The invitee opens the public sign-in page, chooses **I have a sign-in code**, enters the assigned username and emailed code, and chooses their password. Successful proof acceptance signs them into their assigned workspace; replay fails. Legacy duplicated usernames require their canonical shop-qualified form. Codes expire after 48 hours and the engine retains its failed-code limit. The owner can resend an expired code. The existing direct workspace/native invitation screens still work.

## Deployment and retained safeguards

Use `client` deployment mode on production and `team-test` on staging. Both roots use the same private sign-in page. Production administration/new real clients carry no blanket team-test notice. Explicit synthetic shops remain identified inside their authorised workspace using the private test-account manifest. Their financial records, synthetic labels and audit history remain unchanged. Switching mode does not enable real payments, installer signing, GRA certification or independent backups.

Validation and deployment evidence is recorded in the release PR and shared board. Browser coverage includes administrator → assigned owner/email proof → chosen password → owner sign-in → team invite → staff password setup → cashier workspace; a completed sandbox purchase → email proof → chosen username/password → owner workspace → team invite; duplicate names, assigned-username override, refund-before-activation, proof replay, isolation, mobile sign-in layout and accessibility. These are disposable local browser/API/store checks, not real mail delivery, real payment settlement or physical hardware acceptance.

Production request-driven account invitations, staff codes and owner recovery use the verified Resend sender with recorded client recipients. The separate billing/background notification adapter retains its existing recipient allowlist; this release does not flush previously blocked test mail. Staging cannot enable the client account adapter. Provider acceptance/delivery remains distinct from local mocked email tests.
