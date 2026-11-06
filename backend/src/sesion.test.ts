import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// La auditoría real es de solo inserción: estas pruebas no deben dejar filas falsas en ella.
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
import { createHash, randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { createSession, hashPassword, purgeExpiredSessions, SESION_ABS_S, SESION_INACTIVIDAD_S } from './auth.js';

const app = buildServer();
const usuario = `t_ses_${randomBytes(4).toString('hex')}`;
let userId = 0;

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const con = (c: string) => ({ headers: { cookie: `sid=${c}` } });
const me = (c: string) => app.inject({ method: 'GET', url: '/api/me', ...con(c) });
const latido = (c = '') => app.inject({ method: 'POST', url: '/api/sesion/latido', payload: {}, ...(c ? con(c) : {}) });
const cerca = (n: number, esperado: number, margen = 20) => Math.abs(n - esperado) <= margen;
/** Mueve la última actividad hacia atrás (minutos) y/o fija el vencimiento absoluto. */
const ajustar = (token: string, o: { inactivoMin?: number; venceEnS?: number }) =>
  query(
    `UPDATE sessions SET last_seen_at = now() - make_interval(mins => $2::int), expires_at = now() + make_interval(secs => $3::int) WHERE token_hash = $1`,
    [sha(token), o.inactivoMin ?? 0, o.venceEnS ?? SESION_ABS_S],
  );
const ultimaActividadS = async (token: string) =>
  Number((await query<{ s: string }>('SELECT EXTRACT(EPOCH FROM last_seen_at)::bigint AS s FROM sessions WHERE token_hash = $1', [sha(token)]))[0]?.s);

beforeAll(async () => {
  userId = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'operador') RETURNING id", [usuario, await hashPassword('clave-de-prueba-123')]))[0]!.id;
});
afterAll(async () => {
  await query('DELETE FROM users WHERE username = $1', [usuario]);
  await app.close();
  await pool.end();
});

test('una sesión nueva trae los dos plazos: 8 h absolutas y la inactividad configurada (30 min por defecto)', async () => {
  expect(SESION_ABS_S).toBe(8 * 3600);
  expect(SESION_INACTIVIDAD_S).toBe(30 * 60);
  const t = await createSession(userId, false);
  const r = await me(t);
  expect(r.statusCode).toBe(200);
  expect(cerca(r.json().sesion.absolutaS, SESION_ABS_S)).toBe(true);
  expect(cerca(r.json().sesion.inactividadS, SESION_INACTIVIDAD_S)).toBe(true);
});

test('el latido reinicia la inactividad, pero NO mueve el tope absoluto', async () => {
  const t = await createSession(userId, false);
  await ajustar(t, { inactivoMin: 25, venceEnS: 600 }); // 25 min sin actividad y 10 min para el tope
  const antes = (await me(t)).json().sesion;
  expect(cerca(antes.inactividadS, 5 * 60)).toBe(true); // quedan ~5 min de 30
  expect(cerca(antes.absolutaS, 600)).toBe(true);
  const l = await latido(t);
  expect(l.statusCode).toBe(200);
  expect(cerca(l.json().sesion.inactividadS, SESION_INACTIVIDAD_S)).toBe(true); // vuelve a 30 min
  expect(cerca(l.json().sesion.absolutaS, 600)).toBe(true); // el tope sigue donde estaba
  const despues = (await me(t)).json().sesion;
  expect(cerca(despues.inactividadS, SESION_INACTIVIDAD_S)).toBe(true);
  expect(cerca(despues.absolutaS, 600)).toBe(true);
});

test('las consultas de fondo (la cola consulta cada segundo) NO cuentan como actividad', async () => {
  const t = await createSession(userId, false);
  await ajustar(t, { inactivoMin: 25 });
  const antes = await ultimaActividadS(t);
  for (let i = 0; i < 4; i++) { await me(t); await app.inject({ method: 'GET', url: '/api/cola', ...con(t) }); await app.inject({ method: 'GET', url: '/api/portales', ...con(t) }); }
  expect(await ultimaActividadS(t)).toBe(antes);
  expect(cerca((await me(t)).json().sesion.inactividadS, 5 * 60)).toBe(true); // sigue corriendo el reloj
});

test('inactiva más del límite: la sesión vence y un latido no la revive', async () => {
  const t = await createSession(userId, false);
  await ajustar(t, { inactivoMin: 31 });
  expect((await me(t)).statusCode).toBe(401);
  expect((await latido(t)).statusCode).toBe(401);
  expect((await app.inject({ method: 'GET', url: '/api/portales', ...con(t) })).statusCode).toBe(401);
  expect((await me(t)).statusCode).toBe(401); // sigue vencida
});

test('pasado el tope absoluto vence aunque haya actividad reciente', async () => {
  const t = await createSession(userId, false);
  await ajustar(t, { inactivoMin: 0, venceEnS: -60 });
  expect((await me(t)).statusCode).toBe(401);
  expect((await latido(t)).statusCode).toBe(401);
});

test('el latido exige una sesión completa; la pendiente de MFA no vence por inactividad (tiene sus 5 min)', async () => {
  expect((await latido()).statusCode).toBe(401);
  const pendiente = await createSession(userId, true);
  expect((await latido(pendiente)).statusCode).toBe(401); // pendiente no es una sesión completa
  await query("UPDATE sessions SET last_seen_at = now() - interval '3 hours' WHERE token_hash = $1", [sha(pendiente)]);
  const r = await app.inject({ method: 'POST', url: '/api/mfa/enroll', payload: {}, ...con(pendiente) });
  expect(r.statusCode).toBe(200); // sigue valida: su vencimiento es el propio de 5 min
});

test('la limpieza borra las sesiones inactivas y conserva las activas', async () => {
  const vieja = await createSession(userId, false);
  const viva = await createSession(userId, false);
  await ajustar(vieja, { inactivoMin: 40 });
  await purgeExpiredSessions();
  const existe = async (t: string) => (await query('SELECT 1 FROM sessions WHERE token_hash = $1', [sha(t)])).length === 1;
  expect(await existe(vieja)).toBe(false);
  expect(await existe(viva)).toBe(true);
});
