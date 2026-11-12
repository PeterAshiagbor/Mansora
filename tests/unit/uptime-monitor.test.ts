import { expect, it } from 'vitest';
import { EmailDeliveryError, type EmailMessage } from '../../apps/api/src/email';
import { createUptimeChecker } from '../../scripts/monitor/checker';
function fixture() {
  let time = 1_700_000_000_000, ready = true, error: Error | undefined;
  const messages: EmailMessage[] = [], events: string[] = [];
  const options = { url: 'https://app.example.test/healthz', recipient: 'alerts@example.test', now: () => time, onEvent: (event: string) => events.push(event),
    email: { configured: () => true, async send(message: EmailMessage) { messages.push(message); if (error) throw error; } },
    fetch: (async (_url: unknown, init: any) => { expect(init.redirect).toBe('error'); return new Response(JSON.stringify({ ok: ready, mode: 'team-staging', private: 'not-for-email' }), { status: ready ? 200 : 503, headers: { 'content-type': 'application/json' } }); }) as typeof fetch };
  return { options, messages, events, ready: (value: boolean) => { ready = value; }, advance: (ms: number) => { time += ms; }, error: (value?: Error) => { error = value; } };
}
it('alerts after three failures, bounds reminders, announces recovery and never copies response content', async () => {
  const f = fixture(), monitor = createUptimeChecker(f.options);
  await monitor.tick(); expect(f.messages).toHaveLength(0); f.ready(false);
  await monitor.tick(); await monitor.tick(); expect(f.messages).toHaveLength(0);
  await monitor.tick(); await monitor.tick(); expect(f.messages).toHaveLength(1); expect(f.messages[0].subject).toBe('Mansora availability alert');
  expect(JSON.stringify(f.messages)).not.toContain('not-for-email'); f.advance(31 * 60_000); await monitor.tick(); expect(f.messages).toHaveLength(2);
  f.ready(true); await monitor.tick(); await monitor.tick(); expect(f.messages).toHaveLength(3); expect(f.messages[2].subject).toBe('Mansora availability restored');
});
it('uses identical bodies/keys across process recreation, retries transient failures only and stops after three attempts per window', async () => {
  const f = fixture(); f.ready(false); f.error(new EmailDeliveryError('temporary private detail', true)); let monitor = createUptimeChecker(f.options);
  for (let index = 0; index < 6; index++) await monitor.tick(); expect(f.messages).toHaveLength(3);
  f.error(); monitor = createUptimeChecker(f.options); for (let index = 0; index < 3; index++) await monitor.tick();
  expect(f.messages[3]).toEqual(f.messages[0]); expect(f.events).not.toContain('temporary private detail');
  const terminal = fixture(); terminal.ready(false); terminal.error(new EmailDeliveryError('bad sender', false)); const stopped = createUptimeChecker(terminal.options);
  for (let index = 0; index < 6; index++) await stopped.tick(); expect(terminal.messages).toHaveLength(1);
});
it('serialises concurrent checks, rejects redirects/oversized or malformed readiness and requires explicit verified delivery config', async () => {
  const f = fixture(); let release!: () => void, calls = 0;
  f.options.fetch = (async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return new Response('x'.repeat(4097), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  const monitor = createUptimeChecker(f.options); const first = monitor.tick(), second = monitor.tick(); release(); await Promise.all([first, second]); expect(calls).toBe(1); expect(monitor.status().outcome).toBe('unavailable');
  expect(() => createUptimeChecker({ ...f.options, url: 'https://app.example.test/api/private?token=secret' })).toThrow();
  expect(() => createUptimeChecker({ ...f.options, email: { ...f.options.email, configured: () => false } })).toThrow();
});
it('labels a delivery canary clearly and gives repeated requests the same provider deduplication identity', async () => {
  const f = fixture(), monitor = createUptimeChecker(f.options);
  await monitor.canary('canary-20261112'); await monitor.canary('canary-20261112'); expect(f.messages[0]).toEqual(f.messages[1]); expect(f.messages[0].subject).toContain('no platform outage');
  await expect(monitor.canary('invalid/secret')).rejects.toThrow();
});

it('keeps its own HTTP health ready while the platform is unavailable and emits a bounded, clearly labelled canary', async () => {
  const { createServer } = await import('node:http');
  const { runMonitor } = await import('../../scripts/monitor/server');
  const { vi } = await import('vitest');
  const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const realFetch = fetch, sent: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: any) => {
    if (url === 'https://app.example.test/healthz') return new Response('{"ok":false}', { status: 503 });
    if (url === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return new Response('{"id":"synthetic-canary"}', { headers: { 'content-type': 'application/json' } }); }
    throw new Error('Unexpected network destination');
  });
  let monitor: Awaited<ReturnType<typeof runMonitor>> | undefined;
  try {
    monitor = await runMonitor({ PORT: String(port), MANSORA_MONITOR_URL: 'https://app.example.test/healthz', PLATFORM_ALERT_EMAIL: 'alerts@example.test', RESEND_API_KEY: 'fixture-not-a-real-key', RESEND_FROM_EMAIL: 'sender@example.test', MANSORA_MONITOR_CANARY_ID: 'canary-runtime-20261112', MANSORA_MONITOR_CANARY_UNTIL: new Date(Date.now() + 60_000).toISOString() });
    const health = await realFetch(`http://127.0.0.1:${port}/healthz`); expect(health.status).toBe(200); expect(await health.json()).toMatchObject({ ok: true, role: 'uptime-monitor', outcome: 'unavailable' });
    expect(sent).toHaveLength(1); expect(sent[0].subject).toContain('no platform outage'); expect(sent[0].to).toEqual(['alerts@example.test']);
  } finally { await monitor?.close(); vi.unstubAllGlobals(); }
});
