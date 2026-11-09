# Mansora Sales & Stock Platform

Offline-first point of sale, inventory and business operations software for small
businesses in Ghana, distributed and supported by Mansora Consulting and Business
Solutions.

**Status: version 0.1 — foundation and core workflows built and tested in
software. Not yet production-ready.** No physical scanner, printer or Windows
laptop has been tested, and several business and legal decisions are awaiting
Mansora's approval. See [the phase report](docs/phase-report.md) for exactly what
is done, what is not, and the evidence.

## What is here

| Part | Path | What it is |
| --- | --- | --- |
| Shop laptop app | `apps/desktop` | Electron + React. Sells, tracks stock, credit, shifts, expenses and reports with **no internet**. Local encrypted SQLite. |
| Cloud API | `apps/api` | Fastify + PostgreSQL. Device activation, idempotent sync, client administration, consent-based support access. |
| Admin dashboard | `apps/admin-web` | React. Mansora's client directory, onboarding, plans, health and audit. |
| Business rules | `packages/domain` | Money, pricing, refunds, cash reconciliation, costing, permissions and the sync contract. No UI, no database. |
| UI kit | `packages/ui` | Provisional design system shared by both interfaces. |
| Tests | `tests` | Unit, integration, sync, security and browser end-to-end tests. |

## Try it on one machine

Requires Node.js 22.12 or newer. No database install is needed for the demo.

```bash
npm install
npm run build
npm run demo -- --seed     # prints the sign-in details it generated
```

| | Address |
| --- | --- |
| Shop laptop app (in a browser, development host) | http://127.0.0.1:5173 |
| Mansora admin dashboard | http://127.0.0.1:5174 |
| Cloud API | http://127.0.0.1:4000 |

`--seed` activates the laptop and loads products marked "(sample)". Without it you
get an activation code and go through activation yourself. Demo data lives in
`.demo-data/`; delete the folder to start again.

To prove offline behaviour: stop the demo (the cloud goes away with it) and run
only the laptop with `npm run desktop:dev`. Selling, refunds, shifts and reports
keep working; the status bar shows "Offline" and the number of changes waiting.
Start the demo again and they sync once.

## Tests

```bash
npm run typecheck
npm run build        # needed once for the browser end-to-end test
npm test
```

The suite maps to the acceptance tests in the specification; the mapping and
results are in [docs/phase-report.md](docs/phase-report.md). The end-to-end test
needs Playwright with Chromium and is skipped when it is not installed.

## Windows installer

```bash
npm run desktop:dist   # run on Windows; output in apps/desktop/release
```

CI builds an **unsigned** installer on every pull request and launches the packaged
app to check its security shell. A code-signing certificate is required before
giving an installer to a client. Details: [docs/installation](docs/installation/windows-installer.md).

## Documentation

- [Architecture](docs/architecture/overview.md) · [Report definitions](docs/architecture/report-definitions.md) · [API](docs/architecture/api.md)
- [Decision log — includes every default awaiting Mansora's approval](docs/decisions/decision-log.md)
- [Local development](docs/installation/local-development.md) · [Production deployment](docs/installation/production-deployment.md)
- [Client onboarding](docs/onboarding/client-onboarding.md) · [Hardware test script](docs/onboarding/hardware-test-script.md)
- [Cashier guide](docs/user-guide/cashier.md) · [Owner guide](docs/user-guide/owner.md) · [Mansora administrator guide](docs/operations/admin-guide.md)
- [Security audit and hardening](docs/security-audit.md)
- [Backup and recovery](docs/disaster-recovery/backup-and-recovery.md) · [Incident response](docs/operations/incident-response.md) · [Releases](docs/operations/release.md)
