# Windows installer

Target: Windows 10/11, 64-bit.

## Build

On a Windows machine with Node.js 22:

```bash
npm ci
npm run desktop:dist
```

Output: `apps/desktop/release/*.exe` (NSIS installer, per-machine). CI produces the
same file as the artifact `mansora-windows-installer-unsigned` on every pull
request and launches the packaged app to verify its security shell.

## Signing (required before any client installation)

The installer is currently **unsigned**: Windows SmartScreen will warn, and
signed automatic updates are not possible. To sign:

1. Mansora obtains a code-signing certificate in its own name.
2. Provide it to the build as `CSC_LINK` / `CSC_KEY_PASSWORD` secrets (never in the repository).
3. Remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the CI job.

Automatic updates (`electron-updater`, signed) are **not implemented**; version one
updates are installed by running a newer installer. Local data is kept.

## Where data lives on the laptop

The `data` folder inside the app's Windows user-data directory (in the app: Help → Open data folder):

| File | Content |
| --- | --- |
| `mansora.db` | Encrypted database |
| `db.key` | Database key, encrypted by Windows for this user account (DPAPI) |
| `backups\*.mbk` | Passphrase-encrypted backups |

`db.key` only works for the same Windows user on the same PC. Moving to another
laptop is done with a backup, not by copying files.

## Electron version

Electron is pinned to an exact version (44.x) because the encrypted-SQLite module ships prebuilt binaries only for certain Electron versions, and building it from source needs a C++ toolchain. Before upgrading Electron, check that `better-sqlite3-multiple-ciphers` publishes an `electron-v<ABI>-win32-x64` binary for it (version 13.0.3 had none for Electron 45 on 9 Nov 2026). Dependabot is told to leave both packages alone.
