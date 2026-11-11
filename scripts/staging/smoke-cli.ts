import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { smokeStaging } from './smoke';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void smokeStaging().catch(() => { console.error('Staging smoke check failed. No credentials or payloads are logged.'); process.exitCode = 1; });
