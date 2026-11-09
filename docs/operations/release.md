# Release and update procedure

1. All work merges through pull requests; CI must be green (typecheck, build, tests, Windows package and launch).
2. Bump `version` in `apps/desktop/package.json` and `apps/api/package.json`. The laptop reports its version on every sync, visible per client in the dashboard.
3. Database changes: add a new migration (laptop and/or cloud). Never edit a released one. Cloud migrations run before the new API starts; laptop migrations run automatically on first start of the new version.
4. Sync contract changes must stay backward compatible for one release: deploy the API first, then the laptops. Adding a table or nullable column is compatible; removing or renaming is not.
5. Before updating a shop: make a backup. Install the new signed installer over the old one. Confirm sign-in, one sale, one sync.
6. Keep the previous installer. Rolling back the app is safe only if the new version added no migration.

Not yet in place: signed installers, automatic updates, a staging environment, a changelog.
