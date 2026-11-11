import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startConfiguredStaging } from './server';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void startConfiguredStaging().then(host => {
    console.log('Mansora team staging is running. Test accounts are required; records persist in the staging volume.');
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (stopping) return; stopping = true; void host.close().then(() => process.exit(0), () => process.exit(1)); });
  }).catch(() => { console.error('Staging did not start. Check the private configuration, provisioned stores and persistent key.'); process.exitCode = 1; });
}
