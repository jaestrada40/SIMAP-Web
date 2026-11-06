import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// La auditoría real es de solo inserción: estas pruebas no deben dejar filas falsas en ella.
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { createSession, hashPassword } from './auth.js';
import { dejaSinAdmin } from './routes/usuarios.js';

const app = buildServer();
const sufijo = randomBytes(4).toString('hex');
const nombres = { admin: `t_admin_${sufijo}`, lector: `t_lector_${sufijo}`, nuevo: `t_nuevo_${sufijo}` };
const password = 'clave-de-prueba-123';

const con = (cookie: string) => ({ headers: { cookie: `sid=${cookie}` } });
const get = (url: string, cookie = '') => app.inject({ method: 'GET', url, ...(cookie ? con(cookie) : {}) });
const enviar = (method: 'POST' | 'PATCH', url: string, payload: object, cookie = '') => app.inject({ method, url, payload, ...(cookie ? con(cookie) : {}) });

let admin = '', lector = '', idAdmin = 0, idLector = 0;

beforeAll(async () => {
  const hash = await hashPassword(password);
  idAdmin = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'administrador') RETURNING id", [nombres.admin, hash]))[0]!.id;
  idLector = (await query<{ id: number }>("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'lector') RETURNING id", [nombres.lector, hash]))[0]!.id;
  admin = await createSession(idAdmin, false);
  lector = await createSession(idLector, false);
});
afterAll(async () => {
  await query('DELETE FROM users WHERE username = ANY($1)', [Object.values(nombres)]);
  await query('DELETE FROM auth_rate_limits WHERE rate_key LIKE $1', [`clave:%:${idAdmin}`]);
  await app.close();
  await pool.end();
});

test('solo el administrador ve y gestiona usuarios', async () => {
  expect((await get('/api/usuarios')).statusCode).toBe(401);
  expect((await get('/api/usuarios', lector)).statusCode).toBe(403);
  expect((await enviar('POST', '/api/usuarios', { usuario: 'x', nombre: 'X', correo: 'x@y.gt', rol: 'lector' }, lector)).statusCode).toBe(403);
  const lista = await get('/api/usuarios', admin);
  expect(lista.statusCode).toBe(200);
  expect(lista.json().find((u: { usuario: string }) => u.usuario === nombres.admin)).toMatchObject({ rol: 'administrador', activo: true, mfa: false });
  expect(JSON.stringify(lista.json())).not.toMatch(/password|hash|secret/i); // nunca salen claves ni secretos
});

test('crear usuario: valida datos, no repite y entrega una clave temporal que obliga a cambiarla', async () => {
  const datos = { usuario: nombres.nuevo.toUpperCase(), nombre: 'Persona Nueva', correo: 'nueva@mfp.gob.gt', rol: 'operador' };
  expect((await enviar('POST', '/api/usuarios', { ...datos, correo: 'no-es-correo' }, admin)).statusCode).toBe(400);
  expect((await enviar('POST', '/api/usuarios', { ...datos, usuario: 'a b' }, admin)).statusCode).toBe(400);
  expect((await enviar('POST', '/api/usuarios', { ...datos, rol: 'dios' }, admin)).statusCode).toBe(400);
  const ok = await enviar('POST', '/api/usuarios', datos, admin);
  expect(ok.statusCode).toBe(200);
  const { claveTemporal, id } = ok.json();
  expect(claveTemporal.length).toBeGreaterThanOrEqual(12);
  expect((await enviar('POST', '/api/usuarios', datos, admin)).statusCode).toBe(409);

  // Con la clave temporal entra, pero solo puede cambiar la clave.
  const login = await enviar('POST', '/api/login', { username: nombres.nuevo, password: claveTemporal });
  expect(login.statusCode).toBe(200);
  const token = await createSession(Number(id), false);
  const me = await get('/api/me', token);
  expect(me.json()).toMatchObject({ username: nombres.nuevo, role: 'operador', debeCambiar: true });
  const bloqueado = await get('/api/portales', token);
  expect(bloqueado.statusCode).toBe(403);
  expect(bloqueado.json().codigo).toBe('cambiar_clave');

  // Cambiar la clave: exige la actual, mínimo 12 caracteres y distinta; libera el acceso y cierra las otras sesiones.
  const otra = await createSession(Number(id), false);
  expect((await enviar('POST', '/api/cambiar-clave', { actual: 'incorrecta-123456', nueva: 'otra-clave-larga-1' }, token)).statusCode).toBe(403);
  expect((await enviar('POST', '/api/cambiar-clave', { actual: claveTemporal, nueva: 'corta' }, token)).statusCode).toBe(400);
  expect((await enviar('POST', '/api/cambiar-clave', { actual: claveTemporal, nueva: claveTemporal }, token)).statusCode).toBe(400);
  expect((await enviar('POST', '/api/cambiar-clave', { actual: claveTemporal, nueva: 'otra-clave-larga-1' })).statusCode).toBe(401);
  expect((await enviar('POST', '/api/cambiar-clave', { actual: claveTemporal, nueva: 'otra-clave-larga-1' }, token)).statusCode).toBe(200);
  expect((await get('/api/me', token)).json().debeCambiar).toBe(false);
  expect((await get('/api/me', otra)).statusCode).toBe(401);
  expect((await enviar('POST', '/api/login', { username: nombres.nuevo, password: claveTemporal })).statusCode).toBe(401);
  expect((await enviar('POST', '/api/login', { username: nombres.nuevo, password: 'otra-clave-larga-1' })).statusCode).toBe(200);
});

test('modificar: rol y activo; nadie toca su propia cuenta; desactivar cierra sus sesiones', async () => {
  const u = (await query<{ id: number }>('SELECT id FROM users WHERE username = $1', [nombres.nuevo]))[0]!;
  expect((await enviar('PATCH', `/api/usuarios/${idAdmin}`, { activo: false }, admin)).statusCode).toBe(409);
  expect((await enviar('PATCH', `/api/usuarios/${idAdmin}`, { rol: 'lector' }, admin)).statusCode).toBe(409);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, {}, admin)).statusCode).toBe(400);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { rol: 'lector' }, lector)).statusCode).toBe(403);
  expect((await enviar('PATCH', '/api/usuarios/999999', { activo: false }, admin)).statusCode).toBe(404);
  expect((await enviar('PATCH', '/api/usuarios/abc', { activo: false }, admin)).statusCode).toBe(400);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { rol: 'lector' }, admin)).statusCode).toBe(200);
  const sesion = await createSession(u.id, false);
  expect((await get('/api/me', sesion)).json().role).toBe('lector');
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { activo: false }, admin)).statusCode).toBe(200);
  expect((await get('/api/me', sesion)).statusCode).toBe(401);
  expect((await enviar('POST', '/api/login', { username: nombres.nuevo, password: 'otra-clave-larga-1' })).statusCode).toBe(401);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { activo: true }, admin)).statusCode).toBe(200);
});

test('restablecer clave y MFA: solo a otra persona, cierra sesiones y deja clave temporal', async () => {
  const u = (await query<{ id: number }>('SELECT id FROM users WHERE username = $1', [nombres.nuevo]))[0]!;
  expect((await enviar('POST', `/api/usuarios/${idAdmin}/restablecer-clave`, {}, admin)).statusCode).toBe(409);
  expect((await enviar('POST', `/api/usuarios/${idAdmin}/restablecer-mfa`, {}, admin)).statusCode).toBe(409);
  expect((await enviar('POST', `/api/usuarios/${u.id}/restablecer-clave`, {}, lector)).statusCode).toBe(403);
  const sesion = await createSession(u.id, false);
  await query("UPDATE users SET mfa_enabled = true, mfa_secret = 'x' WHERE id = $1", [u.id]);
  const r = await enviar('POST', `/api/usuarios/${u.id}/restablecer-clave`, {}, admin);
  expect(r.statusCode).toBe(200);
  expect(r.json().claveTemporal.length).toBeGreaterThanOrEqual(12);
  expect((await get('/api/me', sesion)).statusCode).toBe(401);
  expect((await enviar('POST', '/api/login', { username: nombres.nuevo, password: r.json().claveTemporal })).statusCode).toBe(200);
  expect((await enviar('POST', `/api/usuarios/${u.id}/restablecer-mfa`, {}, admin)).statusCode).toBe(200);
  const fila = (await query<{ mfa_enabled: boolean; mfa_secret: string | null; debe: boolean }>('SELECT mfa_enabled, mfa_secret, debe_cambiar_clave AS debe FROM users WHERE id = $1', [u.id]))[0]!;
  expect(fila).toEqual({ mfa_enabled: false, mfa_secret: null, debe: true });
  expect((await enviar('POST', '/api/usuarios/999999/restablecer-clave', {}, admin)).statusCode).toBe(404);
});

test('editar nombre y correo: valida, y uno mismo puede editarse (pero no su rol)', async () => {
  const u = (await query<{ id: number }>('SELECT id FROM users WHERE username = $1', [nombres.nuevo]))[0]!;
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { correo: 'no-es-correo' }, admin)).statusCode).toBe(400);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { nombre: '   ' }, admin)).statusCode).toBe(400);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { nombre: 'Otro Nombre' }, lector)).statusCode).toBe(403);
  expect((await enviar('PATCH', `/api/usuarios/${u.id}`, { nombre: ' Nombre Nuevo ', correo: 'nuevo@mfp.gob.gt' }, admin)).statusCode).toBe(200);
  const fila = (await get('/api/usuarios', admin)).json().find((x: { usuario: string }) => x.usuario === nombres.nuevo);
  expect(fila).toMatchObject({ nombre: 'Nombre Nuevo', correo: 'nuevo@mfp.gob.gt' });
  expect((await enviar('PATCH', `/api/usuarios/${idAdmin}`, { nombre: 'Mi nombre' }, admin)).statusCode).toBe(200);
  expect((await enviar('PATCH', `/api/usuarios/${idAdmin}`, { nombre: 'Mi nombre', rol: 'lector' }, admin)).statusCode).toBe(409);
});

test('eliminar: pide el nombre exacto, no a uno mismo, y borra también sus sesiones', async () => {
  const u = (await query<{ id: number }>('SELECT id FROM users WHERE username = $1', [nombres.nuevo]))[0]!;
  const sesion = await createSession(u.id, false);
  expect((await enviar('POST', `/api/usuarios/${u.id}/eliminar`, { confirmacion: nombres.nuevo }, lector)).statusCode).toBe(403);
  expect((await enviar('POST', `/api/usuarios/${u.id}/eliminar`, {}, admin)).statusCode).toBe(400);
  expect((await enviar('POST', `/api/usuarios/${u.id}/eliminar`, { confirmacion: 'otro' }, admin)).statusCode).toBe(400);
  expect((await enviar('POST', `/api/usuarios/${idAdmin}/eliminar`, { confirmacion: nombres.admin }, admin)).statusCode).toBe(409);
  expect((await enviar('POST', '/api/usuarios/999999/eliminar', { confirmacion: 'x' }, admin)).statusCode).toBe(404);
  expect((await enviar('POST', `/api/usuarios/${u.id}/eliminar`, { confirmacion: nombres.nuevo }, admin)).statusCode).toBe(200);
  expect((await get('/api/me', sesion)).statusCode).toBe(401);
  expect((await get('/api/usuarios', admin)).json().some((x: { usuario: string }) => x.usuario === nombres.nuevo)).toBe(false);
  expect((await enviar('POST', '/api/login', { username: nombres.nuevo, password: 'otra-clave-larga-1' })).statusCode).toBe(401);
});

test('regla del último administrador (dejaSinAdmin), con casos armados: no se toca al administrador real', () => {
  const adm = (id: number, active = true) => ({ id, role: 'administrador' as const, active });
  const lec = (id: number) => ({ id, role: 'lector' as const, active: true });
  // Un solo administrador activo: nada que lo quite es válido.
  expect(dejaSinAdmin([adm(1), lec(2)], 1, { activo: false })).toBe(true);
  expect(dejaSinAdmin([adm(1), lec(2)], 1, { rol: 'operador' })).toBe(true);
  expect(dejaSinAdmin([adm(1), lec(2)], 1, { eliminar: true })).toBe(true);
  // Cambios que lo dejan igual no cuentan.
  expect(dejaSinAdmin([adm(1)], 1, { activo: true })).toBe(false);
  expect(dejaSinAdmin([adm(1)], 1, { rol: 'administrador' })).toBe(false);
  expect(dejaSinAdmin([adm(1)], 1, {})).toBe(false);
  // Con otro administrador ACTIVO se puede quitar a uno.
  expect(dejaSinAdmin([adm(1), adm(2)], 1, { activo: false })).toBe(false);
  expect(dejaSinAdmin([adm(1), adm(2)], 1, { eliminar: true })).toBe(false);
  // Otro administrador inactivo no sirve.
  expect(dejaSinAdmin([adm(1), adm(2, false)], 1, { activo: false })).toBe(true);
  // Tocar a alguien que no es administrador activo nunca deja al sistema sin ninguno.
  expect(dejaSinAdmin([adm(1), lec(2)], 2, { eliminar: true })).toBe(false);
  expect(dejaSinAdmin([adm(1), adm(2, false)], 2, { eliminar: true })).toBe(false);
  expect(dejaSinAdmin([adm(1)], 99, { eliminar: true })).toBe(false);
});
