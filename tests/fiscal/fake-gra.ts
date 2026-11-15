import { createHash } from 'node:crypto';

/**
 * A stand-in authority for tests. It speaks Mansora's own SANDBOX protocol (see the design doc), NOT GRA's.
 * Faults are scripted so every failure mode of the worker can be reproduced exactly.
 */
export function createFakeGra() {
  const held = new Map<string, { reference: string; signature: string; qr: string; timestamp: string; body: any }>();
  const s = { down: false, failNext: 0, dropResponseNext: 0, reject: null as null | { code: string; message: string }, posts: [] as { key: string; kind: string; originalReference: string | null }[], gets: 0 };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ack = (h: { reference: string; signature: string; qr: string; timestamp: string }) => json(200, h);

  const fetchImpl = (async (url: any, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (s.down) throw new TypeError('fetch failed');
    if (init.method === 'GET') {
      s.gets++;
      const h = held.get(decodeURIComponent(u.pathname.split('/').pop()!));
      return h ? ack(h) : json(404, { code: 'NOT_FOUND' });
    }
    const headers = new Headers(init.headers);
    const key = headers.get('idempotency-key')!;
    const body = JSON.parse(String(init.body));
    s.posts.push({ key, kind: body.kind, originalReference: body.originalReference });
    if (s.failNext > 0) { s.failNext--; return json(503, { message: 'unavailable' }); }
    if (s.reject) return json(422, s.reject);
    let h = held.get(key);
    if (!h) {
      const n = held.size + 1;
      const reference = `SBX-${String(n).padStart(6, '0')}`;
      h = { reference, signature: createHash('sha256').update(String(init.body)).digest('hex').slice(0, 32), qr: `https://sandbox.invalid/verify/${reference}`, timestamp: '2026-11-15T12:00:00Z', body };
      held.set(key, h);
    }
    if (s.dropResponseNext > 0) { s.dropResponseNext--; throw new TypeError('fetch failed'); } // accepted, but the reply never arrives
    return ack(h);
  }) as typeof fetch;

  return { fetch: fetchImpl, state: s, held, url: 'http://sandbox.gra.test' };
}
