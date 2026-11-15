# Environments and releases

Set up on 15 November 2026 (Railway control register: "production, staging and development are separated" and
"changes are tested, approved and traceable before production release").

| Environment | Where | Deploys | Data | Email |
| --- | --- | --- | --- | --- |
| Development | each developer's machine and CI | on every push / pull request (20 checks) | synthetic, thrown away | none (mocked) |
| **Staging** | Railway environment `staging`, `https://mansora-staging-df901ef3.up.railway.app` | **automatically, every merge to the main branch** (`claude/relaxed-lovelace-0179ut`) | its own PostgreSQL and its own volume; sample test data only; never a copy of production | only to the team inbox (allow-list) |
| **Production** | Railway environment `production`, `https://app.mansora-consulting.com` | **only the `production` branch**, which moves only through *Promote to production* | live shops and clients | as configured for the live service |

## How a change reaches production

1. A pull request is opened. CI runs all checks. It is merged only when every check passes.
2. The merge deploys to **staging** automatically. Check the change there (sign in with the test accounts; sample
   shops are recreated on a fresh staging volume).
3. When satisfied, run GitHub → Actions → **Promote to production** with the full commit SHA from main and a short
   description. The workflow refuses unless the commit is on main, **every check on it passed**, and production can
   move forward to it without losing anything (fast-forward only). It records who approved it and what it contains.
4. Railway deploys the production environment from the updated `production` branch.

Rollback: run *Promote to production* is forward-only by design; to roll back, revert the change on main (a pull
request), let it pass checks and reach staging, then promote that commit. In an emergency, Railway → production →
Deployments → an earlier deployment → Redeploy restores the previous build without changing any branch.

## Owner settings that complete the control (repository administrator)

- GitHub → Settings → Environments → `production`: add **required reviewers** (for example Peter and Priscilla).
  *Promote to production* then waits for one of them to approve before it can run.
- GitHub → Settings → Branches: protect `production` (no direct pushes; only the workflow) and the main branch
  (pull request and passing checks required). Until then, someone with write access could still push directly.
- Railway → project members: confirm who has access, with multi-factor authentication.

## What differs on staging (by design)

Staging was created as a copy of production's service settings, then changed so it can never touch real people or
production data:

- its own database and volume (new and empty at creation), its own Railway address (`STAGING_ORIGIN` removed);
- emails only to the team inbox (`RESEND_ALLOWED_RECIPIENTS`, `LEAD_ALERT_EMAIL`), no bug-report digest;
- start-up jobs that email testers or change test accounts are off (`STAGING_PASSWORD_RESET_ID`,
  `STAGING_CLOSE_SHIFTS_ID`, `STAGING_ROLE_LOGINS_ID` = `off`; no tester invitation);
- no off-site backups (staging data is disposable) and its own `DEMO_INTAKE_SECRET`;
- the uptime monitor is not deployed in staging (it watches production only);
- payments stay in Paystack test mode, as everywhere until the live go-ahead.

The corporate website (Vercel) is separate: its pull requests get Vercel preview deployments, and `main` is live.
