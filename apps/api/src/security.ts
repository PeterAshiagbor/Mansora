import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 1 << 15;
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, { N, r: 8, p: 1, maxmem: MAXMEM });
  return `scrypt$${N}$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(N) || parts[2] !== '8' || parts[3] !== '1') return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = scryptSync(password.normalize('NFKC'), salt, 32, { N, r: 8, p: 1, maxmem: MAXMEM });
  return timingSafeEqual(actual, expected);
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
