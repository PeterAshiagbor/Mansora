import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 1 << 15;
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, { N, r: 8, p: 1, maxmem: MAXMEM });
  return `scrypt$${N}$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function passwordParts(stored: string): { salt: Buffer; expected: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(N) || parts[2] !== '8' || parts[3] !== '1') return null;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length !== 16 || expected.length !== 32) return null;
  return { salt, expected };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = passwordParts(stored);
  if (!parts) return false;
  const actual = scryptSync(password.normalize('NFKC'), parts.salt, 32, { N, r: 8, p: 1, maxmem: MAXMEM });
  return timingSafeEqual(actual, parts.expected);
}

// Unknown accounts do the same expensive work as valid accounts. Never block
// the HTTP event loop or allow an unbounded libuv queue of password checks.
const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'));
let passwordChecks = 0;
export async function verifyLoginPassword(password: string, stored?: string): Promise<boolean> {
  if (passwordChecks >= 4) httpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please wait and try again.');
  passwordChecks++;
  try {
    const parsed = stored ? passwordParts(stored) : null;
    const parts = parsed ?? passwordParts(dummyPasswordHash)!;
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password.normalize('NFKC'), parts.salt, 32, { N, r: 8, p: 1, maxmem: MAXMEM }, (err, key) => err ? reject(err) : resolve(key));
    });
    return timingSafeEqual(actual, parts.expected) && parsed !== null;
  } finally {
    passwordChecks--;
  }
}

/** Random bearer secret. Only its SHA-256 is stored, so a database leak does not leak usable tokens. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Human-typable activation code, e.g. MNS-7KQ2-XW9D-P4HT (60 bits of entropy, single use, expires). */
export function newActivationCode(): string {
  const b = randomBytes(12);
  const chars = [...b].map((x) => ALPHABET[x % 32]);
  return `MNS-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}
export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const httpError = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

/** Tiny fixed-window limiter for login and activation attempts. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private max: number, private windowMs: number, private maxKeys = 10_000) {}
  check(key: string): void {
    const now = Date.now();
    // Expire old entries and fail closed when the bounded map is full.
    for (const [k, hit] of this.hits) if (hit.reset <= now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h && this.hits.size >= this.maxKeys) httpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please wait and try again.');
    if (!h || h.reset <= now) return void this.hits.set(key, { count: 1, reset: now + this.windowMs });
    if (++h.count > this.max) httpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please wait and try again.');
  }
  clear(key: string): void {
    this.hits.delete(key);
  }
}

// RFC 4648 base32 (authenticator apps use an unpadded secret).
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer): string {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += BASE32[(value >>> bits) & 31]; }
  }
  if (bits) result += BASE32[(value << (5 - bits)) & 31];
  return result;
}
function decodeBase32(secret: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of secret) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid authenticator secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); }
  }
  return Buffer.from(out);
}

/** RFC 6238, SHA-1, 30-second steps. Eight digits are used only by RFC vector tests. */
export function totpCode(secret: string, time = Date.now(), digits: 6 | 8 = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}

/** Return the accepted step, strictly newer than the last accepted step. */
export function matchTotp(secret: string, code: string, lastStep: number, time = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(time / 30_000);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (step < 0) continue;
    const valid = timingSafeEqual(Buffer.from(totpCode(secret, step * 30_000)), Buffer.from(code));
    if (valid && step > lastStep) matched = step;
  }
  return matched;
}

export function adminTotpKey(): Buffer {
  const encoded = process.env.ADMIN_TOTP_KEY ?? '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) httpError(503, 'TOTP_UNAVAILABLE', 'Administrator two-factor authentication is unavailable. Contact your server administrator.');
  return key;
}

/** AES-256-GCM with administrator-bound authenticated data; never log these values. */
export function encryptTotpSecret(secret: string, adminId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', adminTotpKey(), iv);
  cipher.setAAD(Buffer.from(`mansora:admin-totp:${adminId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decryptTotpSecret(encrypted: string, adminId: string): string {
  const key = adminTotpKey();
  try {
    const [version, iv, tag, ciphertext] = encrypted.split('.');
    if (version !== 'v1') throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(`mansora:admin-totp:${adminId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return httpError(503, 'TOTP_UNAVAILABLE', 'Administrator two-factor authentication is unavailable. Contact your server administrator.');
  }
}
export const normaliseRecoveryCode = (code: string) => code.trim().toUpperCase().replace(/[\s-]/g, '');
export const newRecoveryCode = () => base32(randomBytes(10)).match(/.{4}/g)!.join('-');
