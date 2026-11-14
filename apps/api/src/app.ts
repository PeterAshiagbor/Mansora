import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ServiceStanding } from '@mansora/domain';
import type { Database } from './db';
import type { BrowserWorkspaceProvisioner } from './browser-workspaces';
import { tenantStanding } from './billing/standing';
import type { EmailAdapter } from './email';
import { registerLeadRoutes } from './modules/leads';
import { registerContactRoutes } from './modules/contact';
import { registerAdminRoutes } from './modules/admin';
import { registerDeviceRoutes } from './modules/device';
import { registerBugReportRoutes } from './modules/bug-reports';
import { createBillingFromEnv, registerBillingRoutes, queueEmail, deliverQueued, type Billing } from './billing';
import { HttpError } from './security';
import { BackupStorageError, FileStorage, type BackupStorage } from './storage';
import { installObservability, loggerOptions, requestId, safeError, type ObservabilityOptions } from './observability';

export interface AppContext {
  db: Database;
  backupStorage: BackupStorage;
  browserWorkspaces?: BrowserWorkspaceProvisioner;
  /** Non-payment standing for a business, sent to its laptop on every sync. */
  standing?: (tenantId: string) => Promise<ServiceStanding>;
  /** Outbound email (Resend in production). Staff sign-in codes are sent directly, never queued or stored. */
  email?: EmailAdapter;
  /** Public address of the administration dashboard (invitation links). */
  adminUrl?: string;
}

export interface AppOptions extends Omit<AppContext, 'backupStorage'>, ObservabilityOptions {
  /** Local fallback for existing callers; unused when backupStorage is supplied. */
  backupDir: string;
  backupStorage?: BackupStorage;
  adminOrigins?: string[];
  logger?: boolean;
  /** Billing and payment collection. Created from the environment when not supplied. */
  billing?: Billing;
  /** Public address of the administration dashboard, used in administrator invitation links. */
  adminUrl?: string;
  /** Explicit proxy addresses/CIDRs only; forwarded headers are untrusted by default. */
  trustProxy?: string[];
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const context: AppContext = { db: opts.db, browserWorkspaces: opts.browserWorkspaces, backupStorage: opts.backupStorage ?? new FileStorage(opts.backupDir) };
  const app = Fastify({ logger: opts.logger || opts.logStream ? loggerOptions(opts.logStream) : false, logController: new LogController({ disableRequestLogging: true }), requestIdHeader: false, genReqId: requestId, bodyLimit: 8 * 1024 * 1024, trustProxy: opts.trustProxy ?? false });
  const billing = opts.billing ?? createBillingFromEnv(opts.db).billing;
  const alertTo = process.env.PLATFORM_ALERT_EMAIL?.trim();
  if (alertTo && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(alertTo)) throw new Error('PLATFORM_ALERT_EMAIL must be an email address.');
  const observability = installObservability(app, opts.db, { ...opts, queueErrorEmail: opts.queueErrorEmail ?? (alertTo && billing.email.configured() ? async message => { await opts.db.platform(q => queueEmail(q, { ...message, to: alertTo, kind: 'platform_error' })); } : undefined) });
  let emailRun: Promise<unknown> | undefined;
  const emailTimer = setInterval(() => {
    if (!billing.email.configured() || emailRun) return;
    emailRun = deliverQueued(billing).catch(() => app.log.warn({ event: 'email_worker_failed' }, 'Email worker failed')).finally(() => { emailRun = undefined; });
  }, 60_000);
  emailTimer.unref();
  app.addHook('onClose', async () => { clearInterval(emailTimer); await emailRun; });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: opts.adminOrigins ?? false, methods: ['GET', 'POST', 'PUT'] });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  // Encrypted backup uploads arrive as raw bytes.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.setErrorHandler(async (err: any, req, reply) => {
    if (err instanceof HttpError || err instanceof BackupStorageError) return reply.status(err.status).send({ code: err.code, message: err.message, requestId: req.id });
    if (err instanceof ZodError) return reply.status(400).send({ code: 'INVALID_INPUT', message: `${err.issues[0].path.join('.') || 'request'}: ${err.issues[0].message}`, requestId: req.id });
    if (err.code === '23505') return reply.status(409).send({ code: 'CONFLICT', message: 'A record with these details already exists', requestId: req.id });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ code: 'BAD_REQUEST', message: err.message, requestId: req.id });
    const context = await observability.context(req, 500);
    req.log.error({ ...context, error: safeError(err) }, 'Request failed');
    observability.reportError(err, context);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Something went wrong on the server', requestId: req.id });
  });

  app.get('/health/live', async () => ({ status: 'ok', time: new Date().toISOString() }));
  const ready = async () => {
    try { await opts.db.platform((q) => q('SELECT 1')); }
    catch { throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'); }
    return { status: 'ok', time: new Date().toISOString() };
  };
  app.get('/health/ready', ready);
  app.get('/health', ready); // Compatibility with existing deployment health checks.
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found', requestId: req.id }));
  // Delegate at call time, so swapping billing.email (tests, reconfiguration) takes effect here too.
  context.adminUrl = (opts.adminUrl ?? process.env.ADMIN_PUBLIC_URL ?? (opts.adminOrigins?.[0] ? `${opts.adminOrigins[0]}/` : undefined))?.replace(/\/*$/, '/');
  context.email = { configured: () => billing.email.configured(), send: (m) => billing.email.send(m) };
  context.standing = (tenantId) => opts.db.platform((q) => tenantStanding(billing, q, tenantId));
  registerDeviceRoutes(app, context);
  registerAdminRoutes(app, context);
  registerBugReportRoutes(app, context);
  registerContactRoutes(app, context);
  registerLeadRoutes(app, context);
  registerBillingRoutes(app, billing);
  return app;
}
