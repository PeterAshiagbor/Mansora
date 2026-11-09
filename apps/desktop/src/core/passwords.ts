import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

/** scrypt password hash: `scrypt$N$r$p$salt$hash` (base64). Verified locally so login works offline. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  if (n !== String(N) || r !== String(R) || p !== String(P)) return false;
  const saltBytes = Buffer.from(salt, 'base64');
  const expected = Buffer.from(hash, 'base64');
  if (saltBytes.length !== 16 || expected.length !== KEYLEN) return false;
  const actual = scryptSync(password.normalize('NFKC'), saltBytes, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return timingSafeEqual(actual, expected);
}

export function checkPasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 200) return 'Password is too long';
  return null;
}
