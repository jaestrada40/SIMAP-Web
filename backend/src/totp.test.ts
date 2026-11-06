import { expect, test } from 'vitest';
import { matchTotp, totpAt } from './totp.js';

// Vector oficial del RFC 6238 (secreto ASCII "12345678901234567890", t = 59 s => 94287082; los 6 últimos dígitos).
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('coincide con el vector del RFC 6238', () => {
  expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
  expect(totpAt(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
});

test('tolera un paso de desfase pero no dos', () => {
  const t = 1_111_111_109_000;
  expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, t - 30_000), t)).not.toBeNull();
  expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, t - 60_000), t)).toBeNull();
  expect(matchTotp(RFC_SECRET, 'abc123', t)).toBeNull();
});
