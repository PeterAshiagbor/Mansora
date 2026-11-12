# Railway combined service

The existing single-replica image bundles the API, shared browser gateway and retail engines. C36 adds its workspace-onboarding adapter to that existing bundle; no new service, port, required environment variable or native IPC capability is introduced. Public ingress remains the existing gateway, with the API bound to loopback and private data/keys on `/data`.

The image acceptance command `/app/railway/smoke.cjs` now also creates a third synthetic client, completes owner-side setup over the gateway, saves a record and verifies persistence after container recreation. Synthetic operator/owner credentials remain in private mode-0600 fixture files and never appear in logs. The command respects MFA requirements and fails rather than bypassing them. This explicit CI/operator acceptance is not a startup task and must not be used to add fixtures to a real-client environment.

See [workspace provisioning](../../docs/operations/browser-workspaces.md) and [Railway operations](../../docs/operations/railway-staging.md). Workspace registry, pending onboarding secrets and per-shop stores must be included with protected key custody in the separately tracked C38 recovery design. Keep one replica while using the shared SQLite volume; this does not claim multi-process provisioning coordination.

C37 adds explicit gateway modes, scoped resource/sign-in budgets and recorded-owner email recovery through the existing device command. The current team-test mode stays in place. See [gateway and recovery operations](../../docs/operations/browser-gateway.md) for bounds, proxy trust, private journals and remaining live acceptance.
