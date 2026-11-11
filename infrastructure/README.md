# Local API deployment and container verification

This stack is a local deployment fixture, not a hosted production environment.
It builds a multi-stage Node 22 API image, runs PostgreSQL 16, applies migrations
with a separate identity, creates a local administrator once, then starts the
API using a restricted runtime identity. No desktop/Electron dependencies are
installed in the image.

## Start from a clean checkout

Requirements: Node.js 22+, Docker Engine with BuildKit and Docker Compose v2.
From the repository root:

```sh
node infrastructure/init-secrets.mjs
docker compose -f infrastructure/docker-compose.yml up --build --wait
```

The API is available at `http://127.0.0.1:4000/health`. Change `API_PORT` if the
port is occupied, or use `API_PORT=0` for an ephemeral local port. PostgreSQL is
not published to the host. The local administrator email defaults to
`admin@localhost.test`; override `ADMIN_EMAIL` before initial setup if needed.
Its generated password is in `infrastructure/.secrets/admin_password`.
Read that file locally when signing in; do not paste it into logs or chat.

The setup helper generates cryptographically random values and never prints or
overwrites them. The secrets directory has mode 0700 and is excluded from Git
and the Docker build context. Individual files are readable inside their
explicit service mounts so the PostgreSQL and Node UIDs can consume them; the
private parent directory prevents access by other host users. For a real
installation, use a proper secrets manager and provider-specific mounts rather
than this local convenience mechanism.

Keep the secret files with the persistent volumes. Re-running setup does not
rotate passwords or the MFA key; deleting/replacing files does not update the
existing PostgreSQL roles or administrator account. Back them up securely and
use a separately reviewed rotation procedure. Administrator bootstrap preserves
existing credentials; it never resets an existing administrator's password.

## Verify the running stack

The dependency-free secret-generator regression test is `node --test infrastructure/secrets.test.mjs`.

```sh
docker compose -f infrastructure/docker-compose.yml run --rm smoke
docker compose -f infrastructure/docker-compose.yml exec -T api node /app/infrastructure/entrypoint.mjs check
```

The smoke test calls `/health`, signs in, calls the authenticated `/v1/admin/me`,
checks that an anonymous request is refused, then logs out. It does not print
credentials or tokens. The smoke fixture assumes a fresh local administrator without an enrolled authenticator; a production account with MFA must use its approved second-factor flow. The runtime check asserts a non-root UID, an unwritable
application filesystem, absent development/native-desktop packages, no mounted
migration secret, and the runtime role's privilege boundaries. It also checks
that the runtime identity cannot assume the migration role, create tables, or
read business tables through the platform role. Database application access
uses `Database.platform()`.

To check restart/idempotence without deleting data:

```sh
docker compose -f infrastructure/docker-compose.yml down
docker compose -f infrastructure/docker-compose.yml up --wait
docker compose -f infrastructure/docker-compose.yml run --rm smoke
```

`down` retains named database and backup volumes. `down --volumes` destroys this
local stack's data; use it only for a disposable verification project. Never
reuse a production Compose project name for tests. CI uses an ephemeral runner
and removes its own test volumes after the check.

## Image and role boundaries

- The build stage installs only the API/domain workspaces, compiles the API and
  infrastructure helpers, then prunes development dependencies. The final
  stage copies only production modules, compiled entry points and tiny launch/
  health/smoke scripts. It contains neither build-time credentials nor source
  secrets. The build never downloads Electron or compiles SQLite.
- The API runs as the image's `node` user. Compose makes its root filesystem
  read-only, drops Linux capabilities, prevents privilege escalation, gives it
  a bounded `/tmp` tmpfs, and mounts only the backup volume writable. A Docker
  health check verifies `/health` and the database connection.
- `init.sql` runs once as PostgreSQL's bootstrap administrator, creates the
  platform/tenant roles and the separate `mansora_migration` and
  `mansora_runtime` logins, and reads their passwords from secret files.
- Both logins are `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`.
  The migration login owns the application schema and has admin option on the
  two pre-created application roles, which is enough for migration 1's grants
  without general `CREATEROLE`. The runtime login can assume only the two
  application roles, owns no schema/table, and cannot create schema objects.
- Only the one-shot migration service receives the migration credential. The
  API receives only the runtime password and its persistent TOTP key. The local
  bootstrap service also receives the generated administrator password and
  exits before the API starts. No migration runs on API startup.

The local stack uses private filesystem backup storage on a named volume. For
production use the private S3 driver and deployment guidance when available;
this Compose fixture does not select a hosting region, deploy DNS/TLS, obtain
cloud credentials, or set retention policy.

## TLS-inspecting build environments

TLS verification stays enabled. If an organization-managed proxy adds a custom
CA, pass its public certificate as an optional BuildKit secret, not an image
layer or copied source file:

```sh
docker build --secret id=proxy_ca,src=/path/to/proxy-ca.pem -f infrastructure/Dockerfile -t mansora-api:local .
docker compose -f infrastructure/docker-compose.yml up --no-build --wait
```

The CA is visible only during dependency installation/build. Ordinary machines
and CI need no such secret. Preserve the environment's Docker proxy settings;
do not use insecure npm/TLS flags.

## CI and remaining responsibilities

`.github/workflows/api-container.yml` builds and starts this stack, runs the
smoke and runtime checks, restarts without deleting volumes, repeats the smoke
test, and cleans up. The workflow is outside this folder because GitHub only
executes workflow files from `.github/workflows`; application code is unchanged.
The docs/decision updates follow the task list's shared documentation rule.

Before production, review base-image/security updates, deployment secret
management, TLS and network boundaries, backup and retention policy, managed
PostgreSQL settings, availability, monitoring and restore drills. No physical
hardware, certificate signing, live hosting or legal approval is claimed here.

## Transactional email

The API optionally sends through Resend. Bind `RESEND_API_KEY` privately,
`RESEND_FROM_EMAIL` to a Resend-verified sender, `RESEND_REPLY_TO` to the support
inbox, and `PLATFORM_ALERT_EMAIL` to the operator inbox. Railway's team-test mode
also requires `RESEND_ALLOWED_RECIPIENTS` (comma-separated) before email can be
enabled. Keep these server-side; no native Electron bridge capability changes.
An unset key/sender preserves the visible queued-email behaviour. Delivery and
retry details are in `docs/billing/resend-email.md`.
