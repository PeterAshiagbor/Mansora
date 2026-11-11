# Persistent team test deployment

This deployment runs the real encrypted retail engine and PostgreSQL API behind one HTTPS origin. The gateway and bootstrap share the API container network namespace so the unchanged engine can reach its API through loopback; Caddy reaches that namespace at `api:4500`. The engine's HTTPS-or-loopback activation requirement remains enforced. It is separate from the public sample interface. No server account is connected yet: the deployment bundle is prepared, but there is no online team-test URL until a server and hostname are supplied. The public sample remains a sample.

## Provision a server

Use a Docker Compose capable Linux server; allow approximately 4 GB RAM and 20 GB disk for builds, stores and backups. Point a dedicated staging hostname to it. Permit inbound TCP 80/443 and UDP 443; keep API port 4000 and gateway port 4500 bound to loopback. Restrict SSH to the operator. Do not use production customer data.

Clone this repository and run:

```sh
node infrastructure/staging/init.mjs
cp infrastructure/staging/.env.example infrastructure/staging/.env
```

Set `STAGING_DOMAIN` to the hostname, `STAGING_ORIGIN` to its HTTPS origin (no trailing slash), and `ADMIN_EMAIL` to the platform administrator's test email. Keep the generated files under `infrastructure/.secrets/` private. Never paste them into chat or commit them. Then run:

```sh
docker compose --env-file infrastructure/staging/.env -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.staging.yml --profile https up --build --wait --wait-timeout 300
```

Caddy obtains the HTTPS certificate. The root page links to two businesses and the platform administration interface. Public HTTP origins are refused; plain HTTP is supported only on loopback for automated checks.

## Give the team access

Provisioning creates Shop A and Shop B, each with distinct random owner, manager and cashier passwords. An operator can read the private account file using:

```sh
docker compose --env-file infrastructure/staging/.env -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.staging.yml exec -T gateway cat /data/staging/test-accounts.json
```

This command intentionally displays credentials: use it only in a private operator terminal, never CI logs or recorded demos. Share each account through your team's secure password-sharing channel. Platform administration uses `ADMIN_EMAIL` and the separate generated `infrastructure/.secrets/admin_password`. The retail account file does not contain that password. Access uses application accounts; a ChatGPT account is not an application login.

Each browser gets its own HttpOnly, SameSite Strict cookie, limited to its business. Engine session tokens stay on the server. Role permissions remain enforced by the real engine. Sessions expire after 12 hours and are invalidated on service restart; saved business records remain. Team members using the same business see shared records.

## Test together

1. Sign in as owner in one browser and cashier in another. Add a product with stock as owner, open a shift and sell one item as cashier, then confirm the owner's stock and sales history update.
2. Preview an Excel import before committing it. Check carton cost divided by items, selling price and margin. Confirm a cashier cannot view costs or save products.
3. Exercise purchases, stock counts, credit repayments, refunds, shift closing and reports using clearly named synthetic records. Confirm restricted discount actions require the configured permission/approval.
4. Use the platform administration interface to inspect both clients and their invoices. Billing is sandbox only; notification delivery is unconfigured. No real payment-provider credentials are mounted.
5. Run the private smoke command below, restart services without deleting volumes, and run it with `--existing` to confirm records survived.

```sh
docker compose --env-file infrastructure/staging/.env -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.staging.yml exec -T gateway node /app/staging/smoke.cjs
docker compose --env-file infrastructure/staging/.env -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.staging.yml restart gateway
docker compose --env-file infrastructure/staging/.env -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.staging.yml exec -T gateway node /app/staging/smoke.cjs --existing
```

The automated workflow builds the actual images and also recreates the entire stack without deleting volumes. Browser acceptance covers separate roles, a real saved sale, shared stock, Excel preview and the proxied administration interface. Desktop hardware, native file restoration, offline operation and Windows signing require the desktop application and their own acceptance checks.

## Maintain data safely

Keep `postgres_data`, `backup_data` and `staging_data` volumes, plus all generated secret files. In particular, losing the staging master key makes the encrypted stores unreadable. Provisioning and secret generation preserve existing credentials and stores. Do not run `down --volumes` on a persistent environment; that command is used only for disposable CI cleanup. Back up volumes and keys through the hosting provider's protected backup facility before upgrades, and verify restoration separately.

Provisioning stops if an incomplete setup is found; it does not silently reset test data. An operator must inspect interrupted provisioning before retrying. A failed initial attempt may leave API-side test plans or clients; reconcile these deliberately rather than rerunning against a new database with old stores. Activation/relink is deployment managed and unavailable through the browser bridge.

The private account file contains generated usernames/passwords, roles and workspace identifiers. Keep its volume access restricted to operators. Browser sessions live only in process memory; no session payloads are logged. Existing legal drafts still require legal review before real client data is introduced.
