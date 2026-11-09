# Hardware and packaged-app tests

Nothing in this folder runs as part of `npm test`.

| Test | Status | Evidence |
| --- | --- | --- |
| Packaged Windows app launches with a locked-down shell (`electron-smoke.mjs`) | Passing in CI on `windows-latest` (Electron 44) | CI job "Windows installer (unsigned) and app smoke test" |
| USB barcode scanner (HID keyboard emulation) on reference hardware | **Not tested on a physical device** | Simulated keystroke scans are covered by `tests/e2e/ui.test.ts` |
| 80 mm thermal receipt printer through the Windows print queue | **Not tested on a physical device** | Receipt HTML content is covered by automated tests |
| A4 / PDF receipt fallback on Windows | **Not tested on a physical device** | — |
| Cash drawer | Out of scope for v1 | — |

No scanner, printer or laptop model may be described as supported until its row
has been filled in from a run on the physical device, with photos or print
samples kept as handover evidence. Use `docs/onboarding/hardware-test-script.md`.
