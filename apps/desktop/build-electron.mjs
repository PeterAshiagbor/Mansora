// Bundles the Electron main process and preload script. The native SQLite module stays external.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: false, logLevel: 'info', external: ['electron', 'better-sqlite3-multiple-ciphers'] };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist/electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist/electron/preload.cjs' });
