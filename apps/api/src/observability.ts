import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db';
import { sha256 } from './security';

export interface ObservabilityOptions {
  metricsToken?: string;
  errorWebhookUrl?: string;
  /** Injectable destination for tests/hosting; no request bodies are serialized. */
  logStream?: { write(message: string): unknown };
}
interface Identity { adminId?: string; tenantId?: string; deviceId?: string }
export interface ErrorContext extends Identity { requestId: string; method: string; route: string; statusCode: number }
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function requestId(request: { headers: Record<string, unknown> }): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

/** Exception messages/stacks may contain SQL values, credentials or event data. */
export function safeError(error: any): { type: string; code?: string } {
  const names = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ZodError', 'HttpError'];
  return {
    type: names.includes(error?.name) ? error.name : 'Error',
    ...(typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? { code: error.code } : {}),
  };
}
export function loggerOptions(stream?: ObservabilityOptions['logStream']) {
  return {
    ...(stream ? { stream } : {}),
    redact: ['req.headers', 'headers', 'body', 'payload', 'password', 'token'],
    serializers: {
      req: (req: any) => ({ id: req.id, method: req.method, route: req.routeOptions?.url ?? 'unmatched' }),
      res: (res: any) => ({ statusCode: res.statusCode }),
      err: (error: any) => ({ ...safeError(error), message: 'Error details omitted', stack: '' }),
    },
  };
}

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const label = (value: string) => JSON.stringify(value);
export function installObservability(app: FastifyInstance, db: Database, options: ObservabilityOptions) {
  const metricsToken = options.metricsToken || undefined;
  if (metricsToken && !/^[\x21-\x7e]{32,256}$/.test(metricsToken)) throw new Error('METRICS_TOKEN must be 32–256 printable ASCII characters without spaces');
  let webhook: URL | undefined;
  if (options.errorWebhookUrl) {
    try { webhook = new URL(options.errorWebhookUrl); }
    catch { throw new Error('ERROR_WEBHOOK_URL must be a valid HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(webhook.protocol) || webhook.username || webhook.password) throw new Error('ERROR_WEBHOOK_URL must be HTTP(S), without URL credentials');
  }
  const started = new WeakMap<FastifyRequest, number>();
  const identities = new WeakMap<FastifyRequest, Promise<Identity>>();
  const counters = new Map<string, number>();
  const histograms = new Map<string, { count: number; sum: number; buckets: number[] }>();
  const pending = new Set<Promise<unknown>>();
  let accepted = 0, rejected = 0, loginFailures = 0;
  const route = (req: FastifyRequest) => req.routeOptions.url ?? 'unmatched';
  function identity(req: FastifyRequest): Promise<Identity> {
    const cached = identities.get(req);
    if (cached) return cached;
    const lookup = (async (): Promise<Identity> => {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) return {};
      const hash = sha256(header.slice(7));
      // Platform identity metadata only: never business rows, request-supplied IDs or token text.
      if (route(req).startsWith('/v1/admin/')) {
        const [row] = await db.platform((q) => q('SELECT a.id FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = \'active\'', [hash]));
        return row ? { adminId: row.id } : {};
      }
      if (route(req).startsWith('/v1/')) {
        const [row] = await db.platform((q) => q("SELECT id, tenant_id FROM devices WHERE token_hash = $1 AND status = 'active'", [hash]));
        return row ? { deviceId: row.id, tenantId: row.tenant_id } : {};
      }
      return {};
    })().catch(() => ({}));
    identities.set(req, lookup);
    return lookup;
  }
  async function context(req: FastifyRequest, statusCode: number): Promise<ErrorContext> {
    const actor = await identity(req);
    const clientId = (req.params as { id?: string } | undefined)?.id;
    const tenant = actor.adminId && statusCode < 400 && route(req).startsWith('/v1/admin/clients/:id') && typeof clientId === 'string' && /^[0-9a-f-]{36}$/i.test(clientId) ? { tenantId: clientId } : {};
    return { requestId: req.id, method: req.method, route: route(req), statusCode, ...actor, ...tenant };
  }
  function reportError(error: unknown, ctx: ErrorContext): void {
    if (!webhook || pending.size >= 8) return;
    // Pick fields explicitly; never spread an Error, arbitrary context or request object.
    const payload = { requestId: ctx.requestId, method: ctx.method, route: ctx.route, statusCode: ctx.statusCode, adminId: ctx.adminId, tenantId: ctx.tenantId, deviceId: ctx.deviceId, error: safeError(error) };
    const job = fetch(webhook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(async (response) => { await response.body?.cancel(); if (!response.ok) throw new Error('Webhook rejected'); })
      .catch(() => app.log.warn({ event: 'error_webhook_failed', requestId: ctx.requestId }, 'Error webhook delivery failed'))
      .finally(() => pending.delete(job));
    pending.add(job);
  }
  app.addHook('onRequest', async (req, reply) => {
    started.set(req, performance.now());
    reply.header('x-request-id', req.id);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (route(req) === '/v1/sync/events' && reply.statusCode < 400 && typeof payload === 'string') {
      try {
        const result = JSON.parse(payload);
        if (Array.isArray(result.accepted)) accepted += result.accepted.length;
        if (Array.isArray(result.rejected)) rejected += result.rejected.length;
      } catch { /* Only valid serialized acknowledgement counts contribute. */ }
    }
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    const seconds = Math.max(0, (performance.now() - (started.get(req) ?? performance.now())) / 1000);
    const labels = `method=${label(req.method)},route=${label(route(req))}`;
    const key = `${labels},status=${label(String(reply.statusCode))}`;
    counters.set(key, (counters.get(key) ?? 0) + 1);
    const histogram = histograms.get(labels) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
    histogram.count++; histogram.sum += seconds;
    BUCKETS.forEach((upper, i) => { if (seconds <= upper) histogram.buckets[i]++; });
    histograms.set(labels, histogram);
    if (['/v1/admin/login', '/v1/admin/login/totp'].includes(route(req)) && reply.statusCode >= 400 && reply.statusCode < 500) loginFailures++;
    app.log.info({ event: 'request_completed', ...await context(req, reply.statusCode), durationMs: Math.round(seconds * 100_000) / 100 }, 'Request completed');
  });
  app.addHook('onClose', async () => { await Promise.allSettled([...pending]); });
  app.get('/metrics', async (req, reply) => {
    if (!metricsToken) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found', requestId: req.id });
    const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    if (!timingSafeEqual(Buffer.from(sha256(supplied)), Buffer.from(sha256(metricsToken)))) return reply.header('www-authenticate', 'Bearer').code(401).send({ code: 'UNAUTHENTICATED', message: 'Metrics authentication required', requestId: req.id });
    const lines = ['# HELP mansora_http_requests_total Completed HTTP requests', '# TYPE mansora_http_requests_total counter'];
    for (const [labels, count] of counters) lines.push(`mansora_http_requests_total{${labels}} ${count}`);
    lines.push('# HELP mansora_http_request_duration_seconds HTTP response duration', '# TYPE mansora_http_request_duration_seconds histogram');
    for (const [labels, h] of histograms) {
      BUCKETS.forEach((upper, i) => lines.push(`mansora_http_request_duration_seconds_bucket{${labels},le="${upper}"} ${h.buckets[i]}`));
      lines.push(`mansora_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`, `mansora_http_request_duration_seconds_sum{${labels}} ${h.sum}`, `mansora_http_request_duration_seconds_count{${labels}} ${h.count}`);
    }
    for (const [name, count] of [['sync_events_accepted', accepted], ['sync_events_rejected', rejected], ['login_failures', loginFailures]] as const) lines.push(`# TYPE mansora_${name}_total counter`, `mansora_${name}_total ${count}`);
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n');
  });
  return { context, reportError };
}
