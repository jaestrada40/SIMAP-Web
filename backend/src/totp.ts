// TOTP (RFC 6238 / RFC 4226) con SHA-1, 6 dígitos, 30 s; compatible con Google Authenticator, Authy y 1Password.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32encode(buf: Buffer): string {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function b32decode(s: string): Buffer {
  let bits = '';
  for (const ch of s.toUpperCase()) {
    const i = ALPHA.indexOf(ch);
    if (i >= 0) bits += i.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

export const newSecret = () => b32encode(randomBytes(20));
export const stepOf = (ms = Date.now()) => Math.floor(ms / 30_000);
export const totpAt = (secret: string, ms = Date.now()) => hotp(secret, stepOf(ms));

/** Devuelve el paso de 30 s que coincide (tolera ±1 por desfase de reloj) o null. */
export function matchTotp(secret: string, code: string, ms = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepOf(ms);
  let found: number | null = null;
  for (const d of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secret, now + d));
    if (timingSafeEqual(expected, Buffer.from(code))) found = now + d;
  }
  return found;
}

export function keyUri(username: string, secret: string): string {
  const issuer = 'SIMAP-Web';
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${username}`)}?${params}`;
}
