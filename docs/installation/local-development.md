# Local development

Requirements: Node.js 22+, npm 10+. PostgreSQL is optional (tests and the demo use
an embedded PostgreSQL).

```bash
npm install
npm run typecheck
npm run build
npm test
npm run demo -- --seed
```

| Command | What it does |
| --- | --- |
| `npm run demo` | API + admin dashboard + laptop app (browser host) on ports 4000 / 5174 / 5173 |
| `npm run desktop:dev` | Laptop app only, in a browser, using `.demo-data/laptop` |
| `npm run api:dev` | API against `DATABASE_URL` (real PostgreSQL), with reload |
| `npm run admin:dev` | Admin dashboard with hot reload on 5174 |
| `npm run test:e2e` | Builds both interfaces, then runs the browser test |
| `npm start -w @mansora/desktop` | Runs the real Electron app (see below) |

## Running the real Electron app

The SQLite module is native code and must match the runtime:

```bash
npm run rebuild:electron -w @mansora/desktop    # switch the module to Electron
npm start -w @mansora/desktop
npm rebuild better-sqlite3-multiple-ciphers     # switch back before running npm test
```

Day-to-day work does not need Electron: the browser host runs the same engine and
the same interface.

## Running tests on a real PostgreSQL server

```bash
createdb mansora_test          # must be empty
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/mansora_test npx vitest run tests/sync/sync.test.ts
```

The connecting role needs `CREATEROLE` the first time, to create the two
application roles.

## Conventions

- Money is integer pesewas. Never use floats for money; use `packages/domain/src/money.ts`.
- Every change on the laptop is a command in `apps/desktop/src/core/commands`. Do
  not write to the database from anywhere else.
- A new synced table or column is added in three places: `SYNC_TABLES`, a new
  SQLite migration and a new PostgreSQL migration. A contract test fails otherwise.
- Released migrations are never edited. Add a new one.
- No secrets in the repository. Configuration comes from the environment.
