import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// La auditoría real es de solo inserción: estas pruebas no deben dejar filas falsas en ella.
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { hashPassword } from './auth.js';
import { totpAt } from './totp.js';

const app = buildServer();
const sufijo = randomBytes(4).toString('hex');
const portalId = `t-portal-${sufijo}`;
const password = 'clave-de-prueba-123';
const usuarios = { lector: `t_lector_${sufijo}`, operador: `t_operador_${sufijo}` };

const sid = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === 'sid')?.value ?? '';
const post = (url: string, payload: object, cookie = '') => app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie: `sid=${cookie}` } : {} });

async function entrar(username: string): Promise<string> {
  const pendiente = sid(await post('/api/login', { username, password }));
  const { secret } = (await post('/api/mfa/enroll', {}, pendiente)).json();
  return sid(await post('/api/mfa/verify', { code: totpAt(secret) }, pendiente));
}
const get = (url: string, cookie = '') => app.inject({ method: 'GET', url, headers: cookie ? { cookie: `sid=${cookie}` } : {} });

let lector = '', operador = '';
beforeAll(async () => {
  const hash = await hashPassword(password);
  await query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3), ($4, $2, $5)', [usuarios.lector, hash, 'lector', usuarios.operador, 'operador']);
  await query("INSERT INTO portales (id, nombre, proyecto, deployment) VALUES ($1, 'Portal de prueba', 'proyecto-x', 'wordpress-x')", [portalId]);
  await query("INSERT INTO portal_estado (portal_id, estado, datos) VALUES ($1, 'ok', $2)", [portalId, JSON.stringify({
    php: '8.4.27', wordpress: '7.1.3', estadoHttp: 200, discoUsadoPct: 10, discoTotalGb: 2.9,
    plugins: [{ slug: 'forminator', nombre: 'Forminator', versionActual: '1.58.2', versionNueva: '1.58.4', estado: 'activo', excluido: false }],
  })]);
  lector = await entrar(usuarios.lector);
  operador = await entrar(usuarios.operador);
});
afterAll(async () => {
  await query('DELETE FROM portales WHERE id = $1', [portalId]);
  await query('DELETE FROM users WHERE username = ANY($1)', [Object.values(usuarios)]);
  await app.close();
  await pool.end();
});

test('sin sesión no se ve nada', async () => {
  expect((await get('/api/portales')).statusCode).toBe(401);
  expect((await get(`/api/portales/${portalId}`)).statusCode).toBe(401);
  expect((await post('/api/portales/revisar', {})).statusCode).toBe(401);
});

test('un lector ve los portales con la forma que espera el frontend', async () => {
  const lista = (await get('/api/portales', lector)).json() as { id: string }[];
  const p = lista.find((x) => x.id === portalId);
  expect(p).toMatchObject({ php: '8.4.27', wordpress: '7.1.3', estadoHttp: 200, discoUsadoPct: 10, estadoRecoleccion: 'ok' });
  expect((p as unknown as { plugins: unknown[] }).plugins).toHaveLength(1);
  expect((await get(`/api/portales/${portalId}`, lector)).statusCode).toBe(200);
  expect((await get('/api/portales/no-existe', lector)).statusCode).toBe(404);
});

test('un lector no puede lanzar una revisión; un id inválido se rechaza', async () => {
  expect((await post('/api/portales/revisar', {}, lector)).statusCode).toBe(403);
  expect((await post('/api/portales/revisar', { id: 123 }, operador)).statusCode).toBe(400);
});
