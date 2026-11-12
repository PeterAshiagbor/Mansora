import { EmailDeliveryError, type EmailAdapter, type EmailMessage } from '../../apps/api/src/email';
const WINDOW_MS = 30 * 60_000;
/** Independent probe; it needs no platform login, database, retail key or customer record. */
export function createUptimeChecker(options: { url: string; recipient: string; email: EmailAdapter; now?: () => number; fetch?: typeof fetch; onEvent?: (event: string) => void }) {
  const url = new URL(options.url), now = options.now ?? Date.now;
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/healthz' || url.search || url.hash) throw new Error('Monitor needs the fixed HTTPS platform health URL.');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(options.recipient) || !options.email.configured()) throw new Error('Configure the verified sender and designated alert recipient.');
  let active: Promise<void> | undefined, failures = 0, incident = false, lastCheckAt = 0, outcome = 'starting';
  const attempts = new Map<string, { count: number; accepted: boolean; terminal: boolean }>();
  async function notify(kind: 'outage' | 'recovered', window: number) {
    const key = `mansora-uptime/${kind}/${window}`, entry = attempts.get(key) ?? { count: 0, accepted: false, terminal: false };
    if (entry.accepted || entry.terminal || entry.count >= 3) return entry.accepted;
    attempts.set(key, entry); entry.count++;
    const start = new Date(window * WINDOW_MS).toISOString();
    const message: EmailMessage = { to: options.recipient, idempotencyKey: key,
      subject: kind === 'outage' ? 'Mansora availability alert' : 'Mansora availability restored',
      body: kind === 'outage' ? `The independent monitor could not confirm Mansora readiness on three consecutive checks.\n\nHealth address: ${url.href}\nAlert window: ${start}\n\nCheck Railway service and database health before retrying transactions. No passwords, customer data or error response content are included. This alert repeats at most once per 30-minute window while the outage continues.` : `The independent monitor has confirmed Mansora readiness again.\n\nHealth address: ${url.href}\nRecovery window: ${start}\n\nCheck saved records before retrying any transaction whose result was uncertain.` };
    try { await options.email.send(message); entry.accepted = true; options.onEvent?.(kind + '-accepted'); }
    catch (error) { if (!(error instanceof EmailDeliveryError) || !error.retryable) entry.terminal = true; options.onEvent?.('alert-delivery-failed'); }
    return entry.accepted;
  }
  async function probe() {
    try {
      const response = await (options.fetch ?? fetch)(url.href, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); return false; }
      const reader = response.body?.getReader(); if (!reader) return false;
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4096) { await reader.cancel(); return false; } chunks.push(next.value); } }
      finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return data?.ok === true && ['team-staging', 'client'].includes(data.mode);
    } catch { return false; }
  }
  async function check() {
    const ready = await probe(), current = now(), window = Math.floor(current / WINDOW_MS);
    lastCheckAt = current; outcome = ready ? 'ready' : 'unavailable';
    for (const key of attempts.keys()) if (!key.endsWith('/' + window)) attempts.delete(key);
    if (!ready) { failures = Math.min(failures + 1, 3); if (failures >= 3) { incident = true; await notify('outage', window); } }
    else { failures = 0; if (incident && await notify('recovered', window)) incident = false; }
  }
  return {
    tick() { if (!active) active = check().finally(() => { active = undefined; }); return active; },
    status() { return { lastCheckAt, outcome }; },
    async canary(id: string) {
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Choose a stable nonsecret canary identifier.');
      await options.email.send({ to: options.recipient, subject: 'Mansora monitoring test — no platform outage', idempotencyKey: 'mansora-uptime-canary/' + id, body: `This is the authorized independent Mansora monitoring delivery test. It does not indicate a platform outage.\n\nHealth address: ${url.href}\n\nNo customer data, passwords or private recovery links are included.` });
    },
  };
}
