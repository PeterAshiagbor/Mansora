import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/api/src/app';
import { connectEmbedded, type Database } from '../apps/api/src/db';
import { createAdmin } from '../apps/api/src/modules/admin';
import { tempDir } from './helpers';

export const ADMIN = { email: 'admin@mansora.test', name: 'Mansora Admin', password: 'admin-password-123' };

export interface Cloud {
  url: string;
  db: Database;
  app: FastifyInstance;
  adminToken: string;
  api: <T = any>(method: string, path: string, body?: unknown, token?: string | null) => Promise<{ status: number; body: T }>;
  createClient: (name: string) => Promise<{ id: string; code: string }>;
  close: () => Promise<void>;
}

/** A real API server on a real (embedded) PostgreSQL, listening on a random local port. */
export async function startCloud(): Promise<Cloud> {
  const db = await connectEmbedded();
  await db.migrate();
  await db.platform((q) => createAdmin(q, ADMIN));
  const app = await buildApp({ db, backupDir: tempDir('mansora-cloud-backups-') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let adminToken = '';
  const api: Cloud['api'] = async (method, path, body, token) => {
    const t = token === undefined ? adminToken : token;
    const res = await fetch(url + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* binary or empty */
    }
    return { status: res.status, body: parsed };
  };
  adminToken = (await api('POST', '/v1/admin/login', { email: ADMIN.email, password: ADMIN.password }, null)).body.token;
  return {
    url, db, app, adminToken, api,
    createClient: async (name) => {
      const { body } = await api('POST', '/v1/admin/clients', { name, ownerName: 'Owner of ' + name, phone: '0240000000', address: 'Accra' });
      const code = (await api('POST', `/v1/admin/clients/${body.id}/activation-codes`)).body.code;
      return { id: body.id, code };
    },
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

/** Network conditions for a laptop: flip `online`, or lose the server's replies after it has processed the request. */
export function flakyNetwork() {
  const net = {
    online: true,
    /** Number of upcoming requests whose RESPONSE is lost (the server still processes them). */
    dropResponses: 0,
    requests: 0,
    fetch: (async (input: any, init?: any) => {
      if (!net.online) throw new TypeError('fetch failed');
      net.requests++;
      const res = await fetch(input, init);
      if (net.dropResponses > 0 && String(input).includes('/v1/sync/events')) {
        net.dropResponses--;
        await res.arrayBuffer();
        throw new TypeError('fetch failed: connection reset');
      }
      return res;
    }) as typeof fetch,
  };
  return net;
}

export const count = async (db: Database, tenantId: string, table: string): Promise<number> => (await db.tenant(tenantId, (q) => q(`SELECT COUNT(*) AS n FROM ${table}`)))[0].n;
