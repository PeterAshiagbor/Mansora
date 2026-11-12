import { build } from 'esbuild';
await build({ entryPoints: ['scripts/monitor/server.ts'], outfile: 'dist/monitor/server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'info' });
