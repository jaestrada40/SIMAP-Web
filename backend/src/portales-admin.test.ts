import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// La auditoría real es de solo inserción, y la revisión consultaría OpenShift de verdad: ninguna de las dos debe ocurrir en pruebas.
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
vi.mock('./collector.js', async (original) => ({ ...(await original<typeof import('./collector.js')>()), revisar: async () => 1, revisionEnCurso: () => false }));
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { createSession, hashPassword } from './auth.js';
import { idDesdeNombre } from './routes/portales-admin.js';

const app = buildServer();
const sufijo = randomBytes(4).toString('hex');
const nombres = { admin: `t_padmin_${sufijo}`, lector: `t_plector_${sufijo}` };
const proyecto = `t-proy-${sufijo}`;
const nombrePortal = `Prueba Portal ${sufijo}`;
const idPortal = `prueba-portal-${sufijo}`;
const valido = { nombre: nombrePortal, proyecto, deployment: 'wordpress-a', contenedor: 'wordpress', url: 'https://sitio-a.example.gt' };

const con = (c: string) => ({ headers: { cookie: `sid=${c}` } });
const enviar = (method: 'POST' | 'PATCH', url: string, payload: object, c = '') => app.inject({ method, url, payload, ...(c ? con(c) : {}) });
const lista = async (c: string) => (await app.inject({ method: 'GET', url: '/api/portales', ...con(c) })).json() as { id: string }[];

let admin = '', lector = '';
beforeAll(async () => {
  const hash = await hashPassword('clave-de-prueba-123');
  const a = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'administrador') RETURNING id", [nombres.admin, hash]))[0]!.id;
  const l = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'lector') RETURNING id", [nombres.lector, hash]))[0]!.id;
  admin = await createSession(a, false);
  lector = await createSession(l, false);
});
afterAll(async () => {
  await query('DELETE FROM portales WHERE proyecto = $1', [proyecto]);
  await query('DELETE FROM users WHERE username = ANY($1)', [Object.values(nombres)]);
  await app.close();
  await pool.end();
});

test('idDesdeNombre: sin acentos ni símbolos', () => {
  expect(idDesdeNombre('Dotación (prueba)')).toBe('dotacion-prueba');
  expect(idDesdeNombre('  Sala de Prensa  ')).toBe('sala-de-prensa');
  expect(idDesdeNombre('¡¡¡')).toBe('');
  expect(idDesdeNombre('a'.repeat(100)).length).toBe(60);
});

test('solo el administrador gestiona portales', async () => {
  expect((await enviar('POST', '/api/portales', valido)).statusCode).toBe(401);
  expect((await enviar('POST', '/api/portales', valido, lector)).statusCode).toBe(403);
  expect((await enviar('PATCH', `/api/portales/${idPortal}`, valido, lector)).statusCode).toBe(403);
  expect((await enviar('POST', `/api/portales/${idPortal}/baja`, { confirmacion: idPortal }, lector)).statusCode).toBe(403);
});

test('alta: valida los datos que luego se usan contra OpenShift y contra la red', async () => {
  const malo = (c: object) => enviar('POST', '/api/portales', { ...valido, ...c }, admin);
  expect((await malo({ nombre: '   ' })).statusCode).toBe(400);
  expect((await malo({ nombre: '!!!' })).statusCode).toBe(400);
  expect((await malo({ proyecto: 'Proyecto Raro' })).statusCode).toBe(400);
  expect((await malo({ deployment: 'a/../b' })).statusCode).toBe(400);
  expect((await malo({ contenedor: '' })).statusCode).toBe(400);
  expect((await malo({ url: 'http://sitio.example.gt' })).statusCode).toBe(400); // solo https
  expect((await malo({ url: 'https://usuario:clave@sitio.example.gt' })).statusCode).toBe(400);
  expect((await malo({ url: 'no-es-url' })).statusCode).toBe(400);
  expect((await malo({ url: 'file:///etc/passwd' })).statusCode).toBe(400);
  expect((await lista(admin)).some((p) => p.id === idPortal)).toBe(false);
});

test('alta, duplicados y listado', async () => {
  const ok = await enviar('POST', '/api/portales', valido, admin);
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toMatchObject({ id: idPortal, estado: 'sin_datos' }); // la revisión está simulada: no hay lectura
  expect((await lista(lector)).some((p) => p.id === idPortal)).toBe(true);
  expect((await enviar('POST', '/api/portales', valido, admin)).statusCode).toBe(409); // mismo nombre
  expect((await enviar('POST', '/api/portales', { ...valido, nombre: `Otro ${sufijo}` }, admin)).statusCode).toBe(409); // mismo proyecto y deployment
});

test('edición: cambiar de destino borra la lectura y la imagen anterior; no se pisa otro portal', async () => {
  await query("INSERT INTO imagen_previa (portal_id, imagen) VALUES ($1, 'x@sha256:aaaa')", [idPortal]);
  await query("INSERT INTO portal_estado (portal_id, estado, datos) VALUES ($1, 'ok', '{}')", [idPortal]);
  // Solo cambia el nombre: lo demás se conserva
  expect((await enviar('PATCH', `/api/portales/${idPortal}`, { ...valido, nombre: `Nombre nuevo ${sufijo}` }, admin)).statusCode).toBe(200);
  expect((await query('SELECT 1 FROM imagen_previa WHERE portal_id = $1', [idPortal])).length).toBe(1);
  expect((await query('SELECT id FROM portales WHERE id = $1', [idPortal])).length).toBe(1); // el id no cambia
  // Cambia el deployment: la imagen anterior de otro deployment sería peligrosa
  expect((await enviar('PATCH', `/api/portales/${idPortal}`, { ...valido, deployment: 'wordpress-b' }, admin)).statusCode).toBe(200);
  expect((await query('SELECT 1 FROM imagen_previa WHERE portal_id = $1', [idPortal])).length).toBe(0);
  expect((await query('SELECT 1 FROM portal_estado WHERE portal_id = $1', [idPortal])).length).toBe(0);
  // Datos inválidos y portal inexistente
  expect((await enviar('PATCH', `/api/portales/${idPortal}`, { ...valido, url: 'http://x.gt' }, admin)).statusCode).toBe(400);
  expect((await enviar('PATCH', '/api/portales/no-existe', valido, admin)).statusCode).toBe(404);
  // Chocar con otro portal
  expect((await enviar('POST', '/api/portales', { ...valido, nombre: `Segundo ${sufijo}`, deployment: 'wordpress-c' }, admin)).statusCode).toBe(200);
  expect((await enviar('PATCH', `/api/portales/${idPortal}`, { ...valido, deployment: 'wordpress-c' }, admin)).statusCode).toBe(409);
});

test('baja: pide el identificador exacto, no borra el historial y se puede volver a agregar', async () => {
  expect((await enviar('POST', `/api/portales/${idPortal}/baja`, {}, admin)).statusCode).toBe(400);
  expect((await enviar('POST', `/api/portales/${idPortal}/baja`, { confirmacion: 'otro' }, admin)).statusCode).toBe(400);
  expect((await enviar('POST', '/api/portales/no-existe/baja', { confirmacion: 'no-existe' }, admin)).statusCode).toBe(404);
  expect((await enviar('POST', `/api/portales/${idPortal}/baja`, { confirmacion: idPortal }, admin)).statusCode).toBe(200);
  expect((await lista(admin)).some((p) => p.id === idPortal)).toBe(false);
  expect((await query<{ activo: boolean }>('SELECT activo FROM portales WHERE id = $1', [idPortal]))[0]?.activo).toBe(false); // sigue en la base
  expect((await enviar('POST', `/api/portales/${idPortal}/baja`, { confirmacion: idPortal }, admin)).statusCode).toBe(404);
  // Volver a agregarlo con el mismo nombre lo reactiva (mismo id)
  const otra = await enviar('POST', '/api/portales', { ...valido, deployment: 'wordpress-d' }, admin);
  expect(otra.statusCode).toBe(200);
  expect(otra.json().id).toBe(idPortal);
  expect((await lista(admin)).some((p) => p.id === idPortal)).toBe(true);
});
