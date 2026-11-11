# Readable test access and invitations

The owner explicitly authorized rotating assigned test-owner credentials and
emailing each owner their own sign-in details. This is a team-test operation,
not a production password-reset or marketing system.

Set a unique `STAGING_TESTER_INVITATION_ID` on the Railway web service only after
reviewing the assigned private tester email settings. On startup, the existing
service uses its private account manifest and the existing auth/change-password
commands. Each replacement has five independently sampled English words plus
four digits (about 68 bits before the minimum-length check), is at least 24
characters, and is not a common shared password.

Resend must be configured and the sender verified. When this explicit operation
is enabled, only the existing assigned tester addresses are added to the
server's recipient allowlist. No test identity, password or message body is
printed or committed. The invitation links to the owner's own workspace and
prefills their email via a URL fragment; credentials are never put in the URL.
After activation, empty or sample-only client/billing email contacts are linked
to that assigned owner inbox so test reminders and service messages can arrive.
Existing non-placeholder billing contact overrides are preserved.

The private `/data/staging/tester-invitations.json` journal (mode 0600) stores
the plan and provider acceptance before password activation. A failed send
preserves the old credentials. A restart resumes an accepted invitation and
recovers a DB-commit/manifest-write interruption without generating another
password or sending another invitation. Completed operations are not repeated.
Use the same ID to retry; ambiguous sends older than 23 hours require provider
reconciliation rather than an unprotected resend. The initial configured
password fingerprint remains checked on provisioning restarts, so changing an
environment variable still cannot silently reset an existing store.

Deployment logs report aggregate accepted/activated/waiting counts only.
“Accepted” means Resend accepted the email, not that a person read it. Confirm
actual inbox receipt before calling an invitation delivered. Do not delete the
journal or replace the persistent volume to retry this operation.

The sign-in form keeps its accessible labels and password-manager support,
explains email/staff usernames, accepts invitation prefill, permits pasting a
passphrase, offers Show/Hide password, and preserves the password after a
connection failure. Existing financial permissions and protected engine code
are unchanged.
