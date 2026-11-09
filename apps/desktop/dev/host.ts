/**
 * DEVELOPMENT ONLY. Serves the built user interface in an ordinary browser and
 * forwards commands to a real local engine, so the app can be developed and
 * tested without Electron. It is not part of the packaged application: it has
 * one shared session and no OS-protected key storage.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { DomainError } from '@mansora/domain';
import { openEngine, runScheduledBackup, syncNow, type Engine } from '../src/core';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function startDevHost(opts: { dataDir: string; port: number; dbKey?: string; syncEveryMs?: number }): Promise<{ server: Server; engine: Engine; url: string }> {
  const root = join(import.meta.dirname, '..', 'dist', 'renderer');
  if (!existsSync(join(root, 'index.html'))) throw new Error('Build the user interface first: npm run build:renderer -w @mansora/desktop');
  const engine = openEngine({ dataDir: opts.dataDir, dbKey: opts.dbKey ?? 'development-only-key', appVersion: '0.1.0-dev' });
  let token: string | null = null;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/invoke') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let out: unknown;
      try {
        const { command, input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (command === 'auth.logout') {
          engine.endSession(token);
          token = null;
          out = { ok: true, data: { ok: true } };
        } else {
          const data = await engine.execute(token, command, input);
          if (command === 'auth.login') {
            token = data.token;
            out = { ok: true, data: { user: data.user } };
          } else out = { ok: true, data };
        }
      } catch (e) {
        if (e instanceof DomainError) {
          if (e.code === 'SESSION_LOCKED') token = null;
          out = { ok: false, error: { code: e.code, message: e.message, details: e.details } };
        } else {
          console.error(e);
          out = { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Nothing was saved.' } };
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      return;
    }
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path === '/' || path === '\\' ? 'index.html' : path);
    if (!file.startsWith(root) || !existsSync(file)) return void res.writeHead(404).end('Not found');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  if (opts.syncEveryMs) setInterval(() => void runScheduledBackup(engine), 3_600_000).unref();
  if (opts.syncEveryMs) setInterval(() => void syncNow(engine).catch(() => {}), opts.syncEveryMs).unref();
  return new Promise((resolve) => server.listen(opts.port, '127.0.0.1', () => resolve({ server, engine, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { url } = await startDevHost({ dataDir: process.env.MANSORA_DATA_DIR ?? join(process.cwd(), '.demo-data', 'laptop'), port: Number(process.env.PORT ?? 5173), syncEveryMs: 15_000 });
  console.log(`Desktop user interface (development host): ${url}`);
}
