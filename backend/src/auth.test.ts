import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// La auditoría real es de solo inserción: estas pruebas no deben dejar filas falsas en ella.
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { hashPassword } from './auth.js';
import { totpAt } from './totp.js';

const app = buildServer();
const username = `t_${randomBytes(4).toString('hex')}`;
const password = 'clave-de-prueba-123';
let secret = '';

const sid = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === 'sid')?.value ?? '';
const post = (url: string, payload: object, cookie = '') =>
  app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie: `sid=${cookie}` } : {} });
const login = (pw = password) => post('/api/login', { username, password: pw });

beforeAll(async () => {
  await query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [username, await hashPassword(password), 'operador']);
});
afterAll(async () => {
  await query('DELETE FROM users WHERE username = $1', [username]); // las sesiones caen por CASCADE
  await query("DELETE FROM auth_rate_limits WHERE rate_key LIKE $1", [`%${username}%`]);
  await app.close();
  await pool.end();
});

test('clave incorrecta => 401 y sin cookie', async () => {
  const res = await login('otra-clave');
  expect(res.statusCode).toBe(401);
  expect(sid(res)).toBe('');
});

test('sesión pendiente no da acceso; el alta de MFA la convierte en completa', async () => {
  const r1 = await login();
  expect(r1.json()).toEqual({ step: 'enroll' });
  const pending = sid(r1);
  expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `sid=${pending}` } })).statusCode).toBe(401);

  secret = (await post('/api/mfa/enroll', {}, pending)).json().secret;
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  expect((await post('/api/mfa/verify', { code: '000000' }, pending)).statusCode).toBe(401);

  const ok = await post('/api/mfa/verify', { code: totpAt(secret) }, pending);
  expect(ok.statusCode).toBe(200);
  const full = sid(ok);
  expect(full).not.toBe(pending); // token nuevo
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `sid=${full}` } });
  expect(me.json()).toMatchObject({ username, role: 'operador', debeCambiar: false });

  await post('/api/logout', {}, full);
  expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `sid=${full}` } })).statusCode).toBe(401);
});

test('un código MFA ya usado no se acepta otra vez', async () => {
  const r = await login();
  expect(r.json()).toEqual({ step: 'mfa' });
  expect((await post('/api/mfa/verify', { code: totpAt(secret) }, sid(r))).statusCode).toBe(401);
});

test('el secreto MFA queda cifrado en la base', async () => {
  const [row] = await query<{ mfa_secret: string }>('SELECT mfa_secret FROM users WHERE username = $1', [username]);
  expect(row?.mfa_secret.startsWith('v1:')).toBe(true);
  expect(row?.mfa_secret).not.toContain(secret);
});

test('un origen distinto en una escritura se rechaza', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password }, headers: { origin: 'https://malo.example', host: 'simap.local' } });
  expect(res.statusCode).toBe(403);
});

test('8 claves malas bloquean el login, incluso con la clave correcta', async () => {
  for (let i = 0; i < 8; i++) await login('mala');
  const res = await login();
  expect(res.statusCode).toBe(429);
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
});
