import { createHash, createHmac, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Keys are relative opaque paths; put is immutable and identical retries are safe. */
export interface BackupStorage {
  put(key: string, bytes: Buffer, sha256: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class BackupStorageError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const missing = () => new BackupStorageError(404, 'BACKUP_NOT_FOUND', 'The backup file is not available');
const conflict = () => new BackupStorageError(409, 'BACKUP_CONFLICT', 'A different backup already uses this storage key');
const unavailable = () => new BackupStorageError(503, 'BACKUP_STORAGE_UNAVAILABLE', 'Backup storage is unavailable. Please try again later.');
const integrity = () => new BackupStorageError(502, 'BACKUP_INTEGRITY_ERROR', 'The stored backup failed its integrity check');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 200 * 1024 * 1024;

function normaliseKey(key: string): string {
  // Accept historical Windows separators, but never traversal or absolute paths.
  const normal = key.replace(/\\/g, '/');
  if (!normal || Buffer.byteLength(normal) > 1024 || /^[a-z]:/i.test(normal) || /[\x00-\x1f\x7f]/.test(normal) || normal.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new BackupStorageError(400, 'INVALID_STORAGE_KEY', 'Invalid backup storage key');
  }
  return normal;
}
function checkBytes(bytes: Buffer, digest: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest) || hash(bytes) !== digest) throw new BackupStorageError(400, 'CHECKSUM_MISMATCH', 'The backup checksum does not match its contents');
  if (bytes.length > MAX_BYTES) throw new BackupStorageError(413, 'BACKUP_TOO_LARGE', 'Backup exceeds the 200 MiB storage limit');
}

export class FileStorage implements BackupStorage {
  private root: string;
  constructor(directory: string) { this.root = resolve(directory); }
  private path(key: string) { return join(this.root, ...normaliseKey(key).split('/')); }
  async put(key: string, bytes: Buffer, digest: string): Promise<void> {
    const path = this.path(key);
    checkBytes(bytes, digest);
    const temp = join(dirname(path), `${randomUUID()}.tmp`);
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      try {
        await link(temp, path); // publish only the completed file, without replacing an existing one
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;
        if (hash(await readFile(path)) !== digest) throw conflict();
      }
    } catch (err) {
      if (err instanceof BackupStorageError) throw err;
      throw unavailable();
    } finally { await unlink(temp).catch(() => {}); }
  }
  async get(key: string): Promise<Buffer> {
    const path = this.path(key);
    try { return await readFile(path); }
    catch (err: any) { throw err.code === 'ENOENT' ? missing() : unavailable(); }
  }
  async exists(key: string): Promise<boolean> {
    const path = this.path(key);
    try { return (await stat(path)).isFile(); }
    catch (err: any) { if (err.code === 'ENOENT') return false; throw unavailable(); }
  }
}

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** AES256 by default. Disable only for providers without the SSE-S3 extension. */
  serverSideEncryption?: 'AES256' | 'none';
  timeoutMs?: number;
}
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();

/** Path-style S3 requests, AWS Signature Version 4; no SDK or presigned public URLs. */
export class S3Storage implements BackupStorage {
  private endpoint: URL;
  private timeout: number;
  constructor(private options: S3StorageOptions) {
    try { this.endpoint = new URL(options.endpoint); }
    catch { throw new Error('BACKUP_S3_ENDPOINT must be an absolute HTTPS URL'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname);
    if ((this.endpoint.protocol !== 'https:' && !(local && this.endpoint.protocol === 'http:')) || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash) {
      throw new Error('BACKUP_S3_ENDPOINT requires HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) || !/^[a-z0-9-]+$/.test(options.region) || !options.accessKeyId || !options.secretAccessKey || /[\s/]/.test(options.accessKeyId)) {
      throw new Error('S3 backup storage requires a valid bucket, region and credentials');
    }
    if (options.serverSideEncryption !== undefined && !['AES256', 'none'].includes(options.serverSideEncryption)) throw new Error('Invalid S3 server-side encryption setting');
    this.timeout = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout <= 0) throw new Error('Invalid S3 request timeout');
  }
  private async request(method: 'PUT' | 'GET' | 'HEAD', key: string, bytes?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
    const url = new URL(this.endpoint);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encode(this.options.bucket)}/${normaliseKey(key).split('/').map(encode).join('/')}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadHash = hash(bytes ?? Buffer.alloc(0));
    const headers: Record<string, string> = { host: url.host, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash, ...extra };
    const names = Object.keys(headers).sort();
    const signedHeaders = names.join(';');
    const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`).join('');
    const canonical = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date.slice(0, 8)}/${this.options.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', date, scope, hash(canonical)].join('\n');
    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, date.slice(0, 8));
    const signingKey = hmac(hmac(hmac(dateKey, this.options.region), 's3'), 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString('hex')}`;
    try {
      // Never follow redirects with signed credentials, and bound network/body waits.
      return await fetch(url, { method, headers, body: bytes as any, redirect: 'error', signal: AbortSignal.timeout(this.timeout) });
    } catch { throw unavailable(); }
  }
  async put(key: string, bytes: Buffer, digest: string): Promise<void> {
    checkBytes(bytes, digest);
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-meta-sha256': digest };
    if (this.options.serverSideEncryption !== 'none') headers['x-amz-server-side-encryption'] = 'AES256';
    const response = await this.request('PUT', key, bytes, headers);
    await response.body?.cancel().catch(() => {});
    if (response.status === 412) {
      // The server refused the write. Only an identical existing object counts as a safe retry.
      if (hash(await this.get(key)) !== digest) throw conflict();
      return;
    }
    if (!response.ok) throw unavailable();
  }
  async get(key: string): Promise<Buffer> {
    const response = await this.request('GET', key);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw response.status === 404 ? missing() : unavailable();
    }
    let bytes: Buffer;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      if (!response.body) throw integrity();
      for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > MAX_BYTES) throw integrity();
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks, size);
    } catch (err) { if (err instanceof BackupStorageError) throw err; throw unavailable(); }
    const digest = response.headers.get('x-amz-meta-sha256');
    if (digest && (!/^[a-f0-9]{64}$/.test(digest) || hash(bytes) !== digest)) throw integrity();
    return bytes;
  }
  async exists(key: string): Promise<boolean> {
    const response = await this.request('HEAD', key);
    await response.body?.cancel().catch(() => {});
    if (response.status === 404) return false;
    if (!response.ok) throw unavailable();
    return true;
  }
}

/** Fail closed on partial S3 configuration rather than silently writing to local disk. */
export function backupStorageFromEnv(env: NodeJS.ProcessEnv = process.env): BackupStorage {
  const names = ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY'];
  if (!names.some((name) => env[name]) && !env.BACKUP_S3_SERVER_SIDE_ENCRYPTION) return new FileStorage(env.BACKUP_DIR ?? './data/backups');
  if (names.some((name) => !env[name])) throw new Error('S3 backup storage requires all five BACKUP_S3_* connection variables');
  const encryption = env.BACKUP_S3_SERVER_SIDE_ENCRYPTION ?? 'AES256';
  if (encryption !== 'AES256' && encryption !== 'none') throw new Error('BACKUP_S3_SERVER_SIDE_ENCRYPTION must be AES256 or none');
  return new S3Storage({ endpoint: env.BACKUP_S3_ENDPOINT!, region: env.BACKUP_S3_REGION!, bucket: env.BACKUP_S3_BUCKET!, accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!, serverSideEncryption: encryption });
}
