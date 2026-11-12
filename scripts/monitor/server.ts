import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { ResendEmail } from '../../apps/api/src/email';
import { createUptimeChecker } from './checker';
export async function runMonitor(env: NodeJS.ProcessEnv = process.env) {
  const recipient = env.PLATFORM_ALERT_EMAIL?.trim() ?? '', port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid monitor health port.');
  const checker = createUptimeChecker({ url: env.MANSORA_MONITOR_URL ?? '', recipient, email: new ResendEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, replyTo: env.RESEND_REPLY_TO, allowedRecipients: [recipient] }), onEvent: event => console.log('Monitor: ' + event) });
  const until = env.MANSORA_MONITOR_CANARY_UNTIL ? Date.parse(env.MANSORA_MONITOR_CANARY_UNTIL) : 0;
  if (env.MANSORA_MONITOR_CANARY_UNTIL && (!Number.isFinite(until) || until > Date.now() + 30 * 60_000)) throw new Error('Canary delivery window must expire within 30 minutes.');
  let canaryDone = false, active: Promise<void> | undefined, stopped = false;
  function tick() {
    if (stopped) return Promise.resolve();
    if (!active) active = (async () => {
      await checker.tick();
      if (!canaryDone && env.MANSORA_MONITOR_CANARY_ID && until > Date.now()) {
        try { await checker.canary(env.MANSORA_MONITOR_CANARY_ID); canaryDone = true; console.log('Monitor: canary-accepted'); }
        catch { console.warn('Monitor: canary-needs-review'); }
      }
    })().catch(() => console.warn('Monitor: check-needs-review')).finally(() => { active = undefined; });
    return active;
  }
  const server = createServer((req, res) => {
    const status = checker.status(), ready = status.lastCheckAt > Date.now() - 3 * 60_000;
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
    res.writeHead(req.url === '/healthz' && ready ? 200 : 503, { 'content-type': 'application/json' });
    // Monitor health describes its own loop, never the target's availability. Do not restart it during an outage.
    res.end(JSON.stringify({ ok: ready, role: 'uptime-monitor', lastCheckAt: status.lastCheckAt, outcome: status.outcome }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  void tick(); const timer = setInterval(() => { void tick(); }, 60_000);
  return { close: async () => { stopped = true; clearInterval(timer); await active; await new Promise<void>(resolve => server.close(() => resolve())); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMonitor().then(monitor => { for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void monitor.close().then(() => process.exit(0)); }); }).catch(() => { console.error('Monitor startup needs configuration review.'); process.exitCode = 1; });
}
