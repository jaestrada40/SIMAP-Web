import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// Sin auditoría real, sin tocar OpenShift: el respaldo, la verificación y la revisión están simulados; la cola se controla desde aquí.
const sim = vi.hoisted(() => ({ colaActiva: false, discoOk: true, respaldos: 0, demasiado: false }));
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
vi.mock('./collector.js', async (original) => ({ ...(await original<typeof import('./collector.js')>()), revisar: async () => 1, revisionEnCurso: () => false }));
vi.mock('./cola.js', async (original) => ({ ...(await original<typeof import('./cola.js')>()), colaActiva: () => sim.colaActiva }));
vi.mock('./comunes.js', async (original) => ({
  ...(await original<typeof import('./comunes.js')>()),
  verificarDiscoYBase: async () => (sim.discoOk ? { ok: true, log: ['disco ok'] } : { ok: false, log: ['Disco al 95 %: supera el umbral.'] }),
  respaldar: async () => { sim.respaldos++; return { ok: true, log: ['respaldo ok'] }; },
  ubicar: async () => 'pod-x',
}));
vi.mock('./k8s.js', async (original) => ({
  ...(await original<typeof import('./k8s.js')>()),
  leerArchivoRespaldo: async () => { if (sim.demasiado) throw new Error('El respaldo supera el límite de descarga'); return Buffer.from('-- volcado ñ\nINSERT INTO t VALUES (1);\n'); },
}));
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { gunzipSync } from 'node:zlib';
import { createSession, hashPassword } from './auth.js';

const app = buildServer();
const sufijo = randomBytes(4).toString('hex');
const nombres = { admin: `t_radmin_${sufijo}`, lector: `t_rlector_${sufijo}` };
const idPortal = `t-resp-${sufijo}`;
const post = (url: string, c = '') => app.inject({ method: 'POST', url, payload: {}, ...(c ? { headers: { cookie: `sid=${c}` } } : {}) });

let admin = '', lector = '';
beforeAll(async () => {
  const hash = await hashPassword('clave-de-prueba-123');
  const a = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'administrador') RETURNING id", [nombres.admin, hash]))[0]!.id;
  const l = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'lector') RETURNING id", [nombres.lector, hash]))[0]!.id;
  admin = await createSession(a, false);
  lector = await createSession(l, false);
  await query("INSERT INTO portales (id, nombre, proyecto, deployment) VALUES ($1, 'Portal respaldo', $2, 'wordpress-x')", [idPortal, `t-proy-${sufijo}`]);
});
afterAll(async () => {
  // Solo los contadores de MIS usuarios: los otros archivos de prueba corren en paralelo y usan los suyos.
  await query("DELETE FROM auth_rate_limits WHERE rate_key IN (SELECT 'descarga:127.0.0.1:' || id FROM users WHERE username = ANY($1))", [Object.values(nombres)]);
  await query('DELETE FROM portales WHERE id = $1', [idPortal]);
  await query('DELETE FROM users WHERE username = ANY($1)', [Object.values(nombres)]);
  await app.close();
  await pool.end();
});

test('respaldo a pedido: permisos, portal inexistente, cola en curso y disco lleno no respaldan', async () => {
  expect((await post(`/api/portales/${idPortal}/respaldo`)).statusCode).toBe(401);
  expect((await post(`/api/portales/${idPortal}/respaldo`, lector)).statusCode).toBe(403);
  expect((await post('/api/portales/no-existe/respaldo', admin)).statusCode).toBe(404);
  sim.colaActiva = true;
  expect((await post(`/api/portales/${idPortal}/respaldo`, admin)).statusCode).toBe(409);
  sim.colaActiva = false;
  sim.discoOk = false;
  const lleno = await post(`/api/portales/${idPortal}/respaldo`, admin);
  expect(lleno.statusCode).toBe(409);
  expect(lleno.json().error).toMatch(/Disco/);
  expect(sim.respaldos).toBe(0);
});

test('respaldo a pedido: con todo en orden se hace una vez y se puede repetir', async () => {
  sim.discoOk = true;
  const ok = await post(`/api/portales/${idPortal}/respaldo`, admin);
  expect(ok.statusCode).toBe(200);
  expect(ok.json().log).toEqual(['disco ok', 'respaldo ok']);
  expect(sim.respaldos).toBe(1);
  expect((await post(`/api/portales/${idPortal}/respaldo`, admin)).statusCode).toBe(200); // el candado se libera
  expect(sim.respaldos).toBe(2);
});

const descargar = (c: string, password?: string) =>
  app.inject({ method: 'POST', url: `/api/portales/${idPortal}/respaldo/descargar`, payload: password === undefined ? {} : { password }, headers: { cookie: `sid=${c}` } });

test('descarga: solo administrador, con la contraseña otra vez, y nunca con una cola en curso', async () => {
  expect((await app.inject({ method: 'POST', url: `/api/portales/${idPortal}/respaldo/descargar`, payload: { password: 'x' } })).statusCode).toBe(401);
  expect((await descargar(lector, 'clave-de-prueba-123')).statusCode).toBe(403);
  expect((await descargar(admin)).statusCode).toBe(400);
  const antes = sim.respaldos;
  expect((await descargar(admin, 'clave-equivocada-1')).statusCode).toBe(403);
  expect(sim.respaldos).toBe(antes); // con la contraseña mal no se exporta nada
  sim.colaActiva = true;
  expect((await descargar(admin, 'clave-de-prueba-123')).statusCode).toBe(409);
  sim.colaActiva = false;
  sim.discoOk = false;
  expect((await descargar(admin, 'clave-de-prueba-123')).statusCode).toBe(409);
  sim.discoOk = true;
  sim.demasiado = true;
  const grande = await descargar(admin, 'clave-de-prueba-123');
  expect(grande.statusCode).toBe(409);
  expect(grande.json().error).toMatch(/límite/);
  sim.demasiado = false;
});

test('descarga: entrega el SQL comprimido, con nombre de archivo y sin caché', async () => {
  const ok = await descargar(admin, 'clave-de-prueba-123');
  expect(ok.statusCode).toBe(200);
  expect(ok.headers['content-type']).toBe('application/gzip');
  expect(ok.headers['content-disposition']).toMatch(/^attachment; filename="respaldo-t-resp-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.sql\.gz"$/);
  expect(ok.headers['cache-control']).toBe('no-store');
  expect(gunzipSync(ok.rawPayload).toString('utf8')).toBe('-- volcado ñ\nINSERT INTO t VALUES (1);\n'); // los caracteres multibyte llegan intactos
});

test('descarga: intentos de contraseña limitados', async () => {
  for (let i = 0; i < 8; i++) await descargar(admin, `mal-${i}-123456`);
  const r = await descargar(admin, 'clave-de-prueba-123'); // aunque ahora sea la correcta, está bloqueado
  expect(r.statusCode).toBe(429);
});
