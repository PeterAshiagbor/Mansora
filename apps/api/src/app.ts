import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Database } from './db';
import { registerAdminRoutes } from './modules/admin';
import { registerDeviceRoutes } from './modules/device';
import { HttpError } from './security';
import { BackupStorageError, FileStorage, type BackupStorage } from './storage';

export interface AppContext {
  db: Database;
  backupStorage: BackupStorage;
}

export interface AppOptions extends Omit<AppContext, 'backupStorage'> {
  /** Local fallback for existing callers; unused when backupStorage is supplied. */
  backupDir: string;
  backupStorage?: BackupStorage;
  adminOrigins?: string[];
  logger?: boolean;
  /** Explicit proxy addresses/CIDRs only; forwarded headers are untrusted by default. */
  trustProxy?: string[];
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const context: AppContext = { db: opts.db, backupStorage: opts.backupStorage ?? new FileStorage(opts.backupDir) };
  const app = Fastify({ logger: opts.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false, bodyLimit: 8 * 1024 * 1024, trustProxy: opts.trustProxy ?? false });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: opts.adminOrigins ?? false, methods: ['GET', 'POST', 'PUT'] });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  // Encrypted backup uploads arrive as raw bytes.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError || err instanceof BackupStorageError) return reply.status(err.status).send({ code: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ code: 'INVALID_INPUT', message: `${err.issues[0].path.join('.') || 'request'}: ${err.issues[0].message}` });
    if (err.code === '23505') return reply.status(409).send({ code: 'CONFLICT', message: 'A record with these details already exists' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ code: 'BAD_REQUEST', message: err.message });
    req.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' });
  });

  app.get('/health', async () => {
    await opts.db.platform((q) => q('SELECT 1'));
    return { status: 'ok', time: new Date().toISOString() };
  });
  registerDeviceRoutes(app, context);
  registerAdminRoutes(app, context);
  return app;
}
