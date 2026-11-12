# Browser gateway modes and owner recovery

C37 preserves the shared gateway, encrypted retail engines, loopback API and single-replica boundary. It does not enable live payments or convert the current team-test deployment into a production client service.

## Explicit modes and budgets

Set `MANSORA_DEPLOYMENT_MODE` to `team-test` or `client`. The existing `MANSORA_STAGING_MODE=team-test` remains supported without a variable change. If both names are set they must agree; missing/unknown modes fail startup.

Team-test keeps its banner, tester invitations, sample-data opt-in and Resend recipient allowlist. Client mode skips synthetic provisioning, invitations and sample seeding; a new service may begin with an empty private registry. Its public root does not enumerate businesses. Private test workspaces identified in the existing tester manifest retain their warning even in client mode. Changing mode is an explicit operator action after deployment acceptance, not part of this change.

| Variable | Default | Bounds |
| --- | --- | --- |
| `GATEWAY_MAX_CONCURRENT_REQUESTS` | 16 | 1–64 |
| `GATEWAY_MAX_REQUESTS_PER_WORKSPACE` | 8, capped by global | 1–global |
| `GATEWAY_MAX_CONCURRENT_IMPORTS` | 1 team-test / 2 client, capped by global | 1–4, capped by global |
| `GATEWAY_TRUSTED_PROXIES` | empty | comma-separated numeric peer addresses/CIDRs; no `/0` |

Imports also have a one-per-shop limit. Existing body/archive expansion, origin, session, role, cookie, CSP, connection and header limits remain. Busy requests release their permits on success or failure; callers receive a retry response. The service retains a ten-workspace capacity and 500-session bound. These are transport limits, not a scale or multi-replica claim.

Sign-in budgets include the workspace and normalized account; the address budget also includes the workspace. Railway documents `X-Real-IP` in [HTTP technical specifications](https://docs.railway.com/networking/public-networking/specs-and-limits). Only a single numeric value from an explicitly trusted socket peer is accepted; malformed, multi-value and untrusted headers fall back to the socket address. Do not trust all addresses or copy a guessed private CIDR. Keep trust empty until the actual ingress boundary is independently checked. When configured, `/healthz` reports only `clientAddressSource`, never the address. Local trusted-proxy isolation is tested; live ingress trust remains a separate deployment acceptance check.

## Recorded-owner recovery

When Resend is configured the browser sign-in screen offers a private owner recovery page. Staff retain the existing owner-assisted reset process; packaged desktop recovery continues using the existing operator-issued code form.

The service resolves the recipient from the private tenant-bound browser registry or the private test-owner manifest. A submitted email cannot choose a recipient or establish ownership. Known and unknown requests receive the same response. Requests and completion are same-origin JSON POSTs with 4 KiB bodies and per-workspace/address limits.

Proofs contain 32 random bytes, expire after 15 minutes, are bound to the workspace, tenant, recorded owner email and configured origin, and work once. Links carry proof in a fragment; it is removed from browser history on load and sent only in the POST body. The private mode-0600 journal stores its hash and AES-GCM encrypted pending secret under a separately derived key. No password, raw proof or email body is logged or exported. Repeated requests preserve a pending link instead of invalidating it.

A single durable worker sends through the existing Resend adapter and team-test allowlist, with stable idempotency keys and at most three attempts inside the proof lifetime. Temporary failures retry with backoff; terminal failures need review. Provider acceptance is recorded separately from delivery. Expired/used secrets are removed. A late provider acknowledgement cannot resurrect a consumed proof.

After proof verification, the server consumes the proof before issuing a ten-minute, one-time device recovery code under the existing platform operator identity, with an audit source identifying verified browser-owner email proof. The unchanged `auth.recoverOwner` command validates the device-bound code and changes the owner password, ending existing owner sessions. No direct password-hash write or new public recovery-code API is introduced. The browser requires 12–200 characters. If the process fails after proof consumption, request a fresh link; do not replay or repair the journal by hand.

The registry, recovery journal and encryption root are part of the private backup/key inventory tracked by C38. One process owns this journal; do not add a second replica.

## Evidence and remaining acceptance

Automated integration uses real embedded PostgreSQL, the actual device recovery endpoint and encrypted retail engines. It covers cross-shop proof rejection, concurrent redemption, replay/expiry, password policy, owner session invalidation, unaffected staff/other shops, durable transient retry across restart, encrypted journal contents, expiry cleanup, acknowledgement races and browser request/reset navigation. Gateway tests cover mode notices, empty client startup, scoped concurrency and trusted/spoofed addresses. Tests use synthetic email adapters; no real recovery email or password reset is sent by CI.

Before calling the live client path accepted: verify the real proxy trust boundary, request/redeem a link with an authorized test owner, observe delivery separately from API acceptance, and retain the existing team-test environment setting. This document does not claim those live owner actions or C38 restore readiness.
