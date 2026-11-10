import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { backupStorageFromEnv, FileStorage, S3Storage, type BackupStorage } from '../../apps/api/src/storage';
import { startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();

/** Local protocol fixture: verifies the actual HTTP request, not a client helper. */
function fakeS3() {
  const accessKeyId = randomBytes(12).toString('hex');
  const secretAccessKey = randomBytes(32).toString('base64');
  const region = 'test-region-1', bucket = 'mansora-backups';
  const objects = new Map<string, { bytes: Buffer; sha256: string }>();
  const requests: { method: string; key: string; verified: boolean; encrypted?: string }[] = [];
  const control = { status: 0, redirect: '', corrupt: false, delayMs: 0 };
  let url = '';
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(String(req.headers.authorization));
      let verified = false;
      if (auth) {
        const [, id, scope, signed, signature] = auth;
        const [day, signedRegion, service, terminator] = scope.split('/');
        const names = signed.split(';');
        const date = String(req.headers['x-amz-date']);
        const payloadHash = digest(bytes);
        const headers = names.map((name) => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
        const canonicalRequest = `${req.method}\n${req.url}\n\n${headers}\n${signed}\n${payloadHash}`;
        const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
        const expected = hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${digest(canonicalRequest)}`).toString('hex');
        verified = id === accessKeyId && signedRegion === region && service === 's3' && terminator === 'aws4_request'
          && /^\d{8}T\d{6}Z$/.test(date) && date.startsWith(day) && names.includes('host') && names.includes('x-amz-date')
          && names.includes('x-amz-content-sha256') && [...new Set(names)].sort().join(';') === signed
          && req.headers['x-amz-content-sha256'] === payloadHash && signature === expected;
      }
      const prefix = `/gateway/${bucket}/`;
      const rawPath = req.url ?? '';
      const key = rawPath.startsWith(prefix) ? rawPath.slice(prefix.length).split('/').map(decodeURIComponent).join('/') : '';
      requests.push({ method: req.method!, key, verified, encrypted: req.headers['x-amz-server-side-encryption'] as string | undefined });
      if (!verified) { res.writeHead(403).end('Invalid signature'); return; }
      if (!key) { res.writeHead(404).end(); return; }
      if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
      if (control.redirect) { res.writeHead(307, { location: control.redirect }).end(); return; }
      if (control.status) { res.writeHead(control.status).end('Provider details are private'); return; }
      if (req.method === 'PUT') {
        if (req.headers['if-none-match'] !== '*') { res.writeHead(400).end('Conditional writes required'); return; }
        if (objects.has(key)) { res.writeHead(412).end(); return; }
        if (req.headers['x-amz-meta-sha256'] !== digest(bytes)) { res.writeHead(400).end(); return; }
        objects.set(key, { bytes, sha256: digest(bytes) });
        res.writeHead(200).end();
      } else if (req.method === 'HEAD' || req.method === 'GET') {
        const object = objects.get(key);
        if (!object) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-amz-meta-sha256': object.sha256 });
        res.end(req.method === 'HEAD' ? undefined : control.corrupt ? Buffer.from('corrupted') : object.bytes);
      } else { res.writeHead(405).end(); }
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  return {
    objects, requests, control,
    options: () => ({ endpoint: `${url}/gateway`, region, bucket, accessKeyId, secretAccessKey }),
    start: async () => {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

function storageContract(name: string, create: () => BackupStorage) {
  describe(name, () => {
    it('round-trips bytes, checks existence and permits identical retries without replacement', async () => {
      const storage = create();
      const key = `${randomUUID()}/backup +雪!#%.mbk`;
      const bytes = randomBytes(128);
      expect(await storage.exists(key)).toBe(false);
      await storage.put(key, bytes, digest(bytes));
      expect(await storage.exists(key)).toBe(true);
      expect(await storage.get(key)).toEqual(bytes);
      await storage.put(key, bytes, digest(bytes));
      await expect(storage.put(key, Buffer.from('different'), digest('different'))).rejects.toMatchObject({ status: 409 });
      expect(await storage.get(key)).toEqual(bytes);
    });
    it('never replaces an object when different uploads race', async () => {
      const storage = create();
      const key = `${randomUUID()}/race.mbk`;
      const a = randomBytes(256), b = randomBytes(256);
      const results = await Promise.allSettled([storage.put(key, a, digest(a)), storage.put(key, b, digest(b))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const stored = await storage.get(key);
      expect(stored.equals(a) || stored.equals(b)).toBe(true);
    });
    it('rejects a mismatched checksum before writing', async () => {
      const storage = create(), key = `${randomUUID()}/invalid.mbk`;
      await expect(storage.put(key, randomBytes(20), digest('different'))).rejects.toMatchObject({ status: 400, code: 'CHECKSUM_MISMATCH' });
      expect(await storage.exists(key)).toBe(false);
    });
    it('rejects path traversal and absolute keys', async () => {
      const storage = create();
      for (const key of ['../escape', '/absolute', 'tenant/../escape', 'tenant//file', 'C:\\escape', 'tenant/./file', 'bad\0key']) {
        await expect(storage.put(key, Buffer.alloc(0), digest(''))).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
        await expect(storage.get(key)).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
        await expect(storage.exists(key)).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
      }
    });
    it('returns a typed not-found error for a missing object', async () => {
      await expect(create().get(`${randomUUID()}/missing.mbk`)).rejects.toMatchObject({ status: 404, code: 'BACKUP_NOT_FOUND' });
    });
    it('reads historical Windows-separated keys', async () => {
      const storage = create(), tenant = randomUUID(), bytes = randomBytes(20);
      await storage.put(`${tenant}\\legacy.mbk`, bytes, digest(bytes));
      expect(await storage.get(`${tenant}/legacy.mbk`)).toEqual(bytes);
    });
  });
}

storageContract('filesystem storage contract', () => new FileStorage(tempDir('mansora-storage-')));

it('publishes private filesystem files atomically and cleans temporary files', async () => {
  const root = tempDir('mansora-private-storage-'), storage = new FileStorage(root);
  const bytes = randomBytes(64), key = 'tenant/file.mbk';
  await storage.put(key, bytes, digest(bytes));
  await expect(storage.put(key, randomBytes(64), digest(bytes))).rejects.toThrow();
  expect(await readdir(join(root, 'tenant'))).toEqual(['file.mbk']);
  expect(await readFile(join(root, key))).toEqual(bytes);
  if (process.platform !== 'win32') {
    expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'tenant'))).mode & 0o777).toBe(0o700);
  }
});

describe('S3-compatible storage', () => {
  const fake = fakeS3();
  beforeAll(() => fake.start());
  afterAll(() => fake.close());
  beforeEach(() => {
    fake.objects.clear(); fake.requests.length = 0;
    Object.assign(fake.control, { status: 0, redirect: '', corrupt: false, delayMs: 0 });
  });
  storageContract('S3 storage contract', () => new S3Storage(fake.options()));

  it('signs PUT/GET/HEAD, encodes paths and enables server-side encryption by default', async () => {
    const storage = new S3Storage(fake.options()), key = 'tenant/a b+雪!#?%.mbk', bytes = randomBytes(40);
    await storage.put(key, bytes, digest(bytes));
    await storage.get(key); await storage.exists(key);
    expect(fake.requests.map((r) => [r.method, r.key, r.verified])).toEqual([['PUT', key, true], ['GET', key, true], ['HEAD', key, true]]);
    expect(fake.requests[0].encrypted).toBe('AES256');
  });
  it('allows an explicit SSE opt-out only for incompatible providers', async () => {
    const bytes = randomBytes(20);
    await new S3Storage({ ...fake.options(), serverSideEncryption: 'none' }).put('tenant/file', bytes, digest(bytes));
    expect(fake.requests[0].encrypted).toBeUndefined();
  });
  it('fails when the signing credential is wrong without exposing provider responses', async () => {
    const storage = new S3Storage({ ...fake.options(), secretAccessKey: randomBytes(32).toString('base64') });
    await expect(storage.exists('tenant/file')).rejects.toMatchObject({ status: 503, message: 'Backup storage is unavailable. Please try again later.' });
    expect(fake.requests[0].verified).toBe(false);
  });
  it('detects corrupted GET contents and provider failures', async () => {
    const storage = new S3Storage(fake.options()), bytes = randomBytes(20);
    await storage.put('tenant/file', bytes, digest(bytes));
    fake.control.corrupt = true;
    await expect(storage.get('tenant/file')).rejects.toMatchObject({ status: 502, code: 'BACKUP_INTEGRITY_ERROR' });
    fake.control.corrupt = false; fake.control.status = 500;
    await expect(storage.get('tenant/file')).rejects.toMatchObject({ status: 503 });
    await expect(storage.exists('tenant/file')).rejects.toMatchObject({ status: 503 });
    await expect(storage.put('tenant/other', bytes, digest(bytes))).rejects.toMatchObject({ status: 503 });
  });
  it('does not follow redirects with signed credentials', async () => {
    fake.control.redirect = `${fake.options().endpoint}/other`;
    await expect(new S3Storage(fake.options()).exists('tenant/file')).rejects.toMatchObject({ status: 503 });
    expect(fake.requests).toHaveLength(1);
  });
  it('bounds slow storage requests', async () => {
    fake.control.delayMs = 150;
    await expect(new S3Storage({ ...fake.options(), timeoutMs: 30 }).exists('tenant/file')).rejects.toMatchObject({ status: 503 });
  });

  it('serves existing backup endpoints from S3, preserves integrity and isolates tenants', async () => {
    let cloud: Cloud | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
    try {
      cloud = await startCloud();
      const first = await cloud.createClient('S3 storage test A'), second = await cloud.createClient('S3 storage test B');
      const activate = async (code: string) => (await cloud!.api('POST', '/v1/devices/activate', { code, deviceName: 'Storage test', appVersion: 'test' }, null)).body.deviceToken;
      const tokenA = await activate(first.code), tokenB = await activate(second.code);
      app = await buildApp({ db: cloud.db, backupDir: tempDir(), backupStorage: new S3Storage(fake.options()) });
      const id = randomUUID(), bytes = randomBytes(80);
      const put = (token: string, content: Buffer) => app!.inject({ method: 'PUT', url: `/v1/backups/${id}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-sha256': digest(content) }, payload: content });
      expect((await put(tokenA, bytes)).statusCode).toBe(200);
      expect((await put(tokenA, bytes)).statusCode).toBe(200);
      expect((await put(tokenA, randomBytes(80))).statusCode).toBe(409);
      expect((await put(tokenB, bytes)).statusCode).toBe(409);
      const download = await app.inject({ method: 'GET', url: '/v1/backups/latest', headers: { authorization: `Bearer ${tokenA}` } });
      expect(download.rawPayload).toEqual(bytes);
      expect(download.headers['x-sha256']).toBe(digest(bytes));
      expect((await app.inject({ method: 'GET', url: '/v1/backups/latest', headers: { authorization: `Bearer ${tokenB}` } })).statusCode).toBe(404);
      expect(fake.objects.size).toBe(1);
      const failedId = randomUUID();
      fake.control.status = 500;
      const failedUpload = await app.inject({ method: 'PUT', url: `/v1/backups/${failedId}`, headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/octet-stream', 'x-sha256': digest(bytes) }, payload: bytes });
      expect(failedUpload.statusCode).toBe(503);
      expect(failedUpload.json().code).toBe('BACKUP_STORAGE_UNAVAILABLE');
      expect(failedUpload.body).not.toContain('Provider details');
      expect(await cloud.db.platform((q) => q('SELECT id FROM backup_records WHERE id = $1', [failedId]))).toEqual([]);
      fake.control.status = 0; fake.control.corrupt = true;
      const corruptDownload = await app.inject({ method: 'GET', url: '/v1/backups/latest', headers: { authorization: `Bearer ${tokenA}` } });
      expect(corruptDownload.statusCode).toBe(502);
      expect(corruptDownload.headers['content-type']).toContain('application/json');
      expect(corruptDownload.json().code).toBe('BACKUP_INTEGRITY_ERROR');
      fake.control.corrupt = false; fake.objects.clear();
      const missingDownload = await app.inject({ method: 'GET', url: '/v1/backups/latest', headers: { authorization: `Bearer ${tokenA}` } });
      expect(missingDownload.statusCode).toBe(404);
      expect(missingDownload.json().code).toBe('BACKUP_NOT_FOUND');
      expect(fake.requests.every((r) => r.verified)).toBe(true);
    } finally { await app?.close(); await cloud?.close(); }
  });
});

it('selects filesystem storage only when S3 is not configured and rejects partial/unsafe configuration', () => {
  expect(backupStorageFromEnv({ BACKUP_DIR: tempDir() })).toBeInstanceOf(FileStorage);
  expect(() => backupStorageFromEnv({ BACKUP_S3_ENDPOINT: 'https://storage.example.com' })).toThrow(/all five/);
  const settings = { endpoint: 'https://storage.example.com', region: 'test-region-1', bucket: 'mansora-backups', accessKeyId: randomBytes(12).toString('hex'), secretAccessKey: randomBytes(32).toString('base64') };
  expect(backupStorageFromEnv({ BACKUP_S3_ENDPOINT: settings.endpoint, BACKUP_S3_REGION: settings.region, BACKUP_S3_BUCKET: settings.bucket, BACKUP_S3_ACCESS_KEY_ID: settings.accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: settings.secretAccessKey })).toBeInstanceOf(S3Storage);
  for (const endpoint of ['http://storage.example.com', `https://${randomBytes(8).toString('hex')}:${randomBytes(8).toString('hex')}@storage.example.com`, 'https://storage.example.com?query=1', 'https://storage.example.com#fragment']) {
    expect(() => new S3Storage({ ...settings, endpoint })).toThrow(/requires HTTPS/);
  }
});
