import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// Sin auditoría real ni OpenShift real: el pod, los comandos y la cola se simulan desde aquí.
const NOMBRE = 'backup_2026-11-05-1539_Sitio_de186cbe3d14-db.gz';
const DATOS = Buffer.from('DATOS-DE-PRUEBA');
const sim = vi.hoisted(() => ({ colaActiva: false, mb: '250', log: '', listado: true, lanzados: [] as string[], flujo: (() => { throw new Error('sin flujo'); }) as () => { flujo: unknown; cancelar: () => void } }));
vi.mock('./auth.js', async (original) => ({ ...(await original<typeof import('./auth.js')>()), audit: async () => {} }));
vi.mock('./cola.js', async (original) => ({ ...(await original<typeof import('./cola.js')>()), colaActiva: () => sim.colaActiva }));
vi.mock('./comunes.js', async (original) => ({ ...(await original<typeof import('./comunes.js')>()), ubicar: async () => 'pod-x' }));
vi.mock('./k8s.js', async (original) => ({
  ...(await original<typeof import('./k8s.js')>()),
  ejecutar: async (_ns: string, _pod: string, _c: string, nombre: string) => {
    if (nombre === 'updraft_listado') return sim.listado ? `${DATOS.length} 1793900356 ${NOMBRE}\n16 1793900000 index.html\n` : '';
    if (nombre === 'updraft_log') return sim.log;
    if (nombre === 'wpcontent_mb') return `${sim.mb}\n`;
    if (nombre === 'disco') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdb 3023656 352556 2654716 12% /bitnami\n';
    if (nombre === 'prefijo_tablas') return 'Warning: ruido de PHP\nwp_\n';
    if (nombre === 'db_nombre') return 'bitnami_wordpress\n';
    if (nombre === 'siteurl') return 'https://sitio.example.gt\n';
    if (nombre === 'temas') return 'Warning: ruido\n[{"name":"divi","status":"active","version":"4.27"}]';
    return '';
  },
  lanzarUpdraft: async (_ns: string, _pod: string, _c: string, nonce: string) => { sim.lanzados.push(nonce); return ''; },
  transmitirArchivo: () => sim.flujo(),
}));
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { pool, query } from './db.js';
import { createSession, hashPassword } from './auth.js';
import { copiaCorriendoEn } from './routes/updraft.js';

const app = buildServer();
const sufijo = randomBytes(4).toString('hex');
const nombres = { admin2: `t_uadmin2_${sufijo}`, admin: `t_uadmin_${sufijo}`, operador: `t_uoper_${sufijo}`, lector: `t_ulector_${sufijo}` };
const idPortal = `t-upd-${sufijo}`;
const CLAVE = 'clave-de-prueba-123';
const con = (c: string) => ({ headers: { cookie: `sid=${c}` } });
const get = (url: string, c = '') => app.inject({ method: 'GET', url, ...(c ? con(c) : {}) });
const post = (url: string, payload: object, c = '') => app.inject({ method: 'POST', url, payload, ...(c ? con(c) : {}) });

let admin = '', admin2 = '', operador = '', lector = '';
beforeAll(async () => {
  const hash = await hashPassword(CLAVE);
  const mk = async (u: string, rol: string) => createSession((await query<{ id: number }>('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id', [u, hash, rol]))[0]!.id, false);
  admin = await mk(nombres.admin, 'administrador');
  admin2 = await mk(nombres.admin2, 'administrador');
  operador = await mk(nombres.operador, 'operador');
  lector = await mk(nombres.lector, 'lector');
  await query("INSERT INTO portales (id, nombre, proyecto, deployment) VALUES ($1, 'Portal upd', $2, 'wordpress-x')", [idPortal, `t-proy-${sufijo}`]);
});
afterAll(async () => {
  // Solo los contadores de MIS usuarios: los otros archivos de prueba corren en paralelo y usan los suyos.
  await query("DELETE FROM auth_rate_limits WHERE rate_key IN (SELECT 'descarga:127.0.0.1:' || id FROM users WHERE username = ANY($1))", [Object.values(nombres)]);
  await query('DELETE FROM portales WHERE id = $1', [idPortal]);
  await query('DELETE FROM users WHERE username = ANY($1)', [Object.values(nombres)]);
  await app.close();
  await pool.end();
});

test('listar: administrador y operador; el lector no', async () => {
  expect((await get(`/api/portales/${idPortal}/updraft`)).statusCode).toBe(401);
  expect((await get(`/api/portales/${idPortal}/updraft`, lector)).statusCode).toBe(403);
  expect((await get('/api/portales/no-existe/updraft', admin)).statusCode).toBe(404);
  const r = await get(`/api/portales/${idPortal}/updraft`, operador);
  expect(r.statusCode).toBe(200);
  expect(r.json().copias).toHaveLength(1);
  expect(r.json().copias[0].piezas[0]).toMatchObject({ nombre: NOMBRE, tipo: 'db', bytes: DATOS.length });
  expect(r.json().avance.estado).toBe('sin_actividad');
});

test('lanzar copia: permisos, UpdraftPlus activo, cola, espacio y una sola a la vez', async () => {
  const url = `/api/portales/${idPortal}/updraft/lanzar`;
  expect((await post(url, {})).statusCode).toBe(401);
  expect((await post(url, {}, lector)).statusCode).toBe(403);
  // Sin revisión previa / UpdraftPlus no activo
  expect((await post(url, {}, operador)).statusCode).toBe(409);
  await query("INSERT INTO portal_estado (portal_id, estado, datos) VALUES ($1, 'ok', $2)", [idPortal, JSON.stringify({ respaldoUpdraft: { activo: true } })]);
  // Cola en curso
  sim.colaActiva = true;
  expect((await post(url, {}, operador)).statusCode).toBe(409);
  sim.colaActiva = false;
  // Sin espacio: no se lanza nada
  sim.mb = '9200';
  const lleno = await post(url, {}, operador);
  expect(lleno.statusCode).toBe(409);
  expect(lleno.json().error).toMatch(/espacio/);
  expect(sim.lanzados).toHaveLength(0);
  // Con espacio: se lanza con un identificador de 12 hex
  sim.mb = '250';
  const ok = await post(url, {}, operador);
  expect(ok.statusCode).toBe(200);
  expect(sim.lanzados).toHaveLength(1);
  expect(sim.lanzados[0]).toMatch(/^[0-9a-f]{12}$/);
  // Mientras no aparezca su registro (o esté en curso), no se lanza otra
  expect((await post(url, {}, operador)).statusCode).toBe(409);
  expect(sim.lanzados).toHaveLength(1);
  const av = await get(`/api/portales/${idPortal}/updraft`, operador);
  expect(av.json().avance.estado).toBe('iniciando');
  // Aparece el registro de ESA copia y termina
  const ahora = Math.floor(Date.now() / 1000);
  sim.log = [`/bitnami/wordpress/wp-content/updraft/log.${sim.lanzados[0]}.txt`, String(ahora), '0035.371 (0) The backup succeeded and is now complete'].join('\n');
  expect((await get(`/api/portales/${idPortal}/updraft`, operador)).json().avance).toMatchObject({ estado: 'terminada', nonce: sim.lanzados[0] });
  // Terminada: ya se puede lanzar otra
  expect((await post(url, {}, operador)).statusCode).toBe(200);
});

test('la cola de actualizaciones no arranca encima de una copia de UpdraftPlus en curso', async () => {
  // Del test anterior queda una copia recién lanzada (todavía sin registro): "iniciando"
  expect(await copiaCorriendoEn([idPortal])).toEqual([idPortal]);
  expect(await copiaCorriendoEn([])).toEqual([]);
  const r = await post('/api/cola', { tipo: 'plugins', ids: [idPortal], simulacion: false, confirmacion: { [idPortal]: idPortal } }, admin);
  expect(r.statusCode).toBe(409);
  expect(r.json().error).toMatch(/UpdraftPlus está haciendo una copia/);
  expect(r.json().error).toContain(idPortal);
  // Cuando la copia termina, ya no estorba
  const ahora = Math.floor(Date.now() / 1000);
  sim.log = [`/bitnami/wordpress/wp-content/updraft/log.${sim.lanzados.at(-1)}.txt`, String(ahora), '0035.371 (0) The backup succeeded and is now complete'].join('\n');
  expect(await copiaCorriendoEn([idPortal])).toEqual([]);
});

test('ficha de reconstrucción: solo administrador y operador, sin secretos, con lecturas frescas', async () => {
  const url = `/api/portales/${idPortal}/ficha-reconstruccion`;
  expect((await get(url)).statusCode).toBe(401);
  expect((await get(url, lector)).statusCode).toBe(403);
  expect((await get('/api/portales/no-existe/ficha-reconstruccion', admin)).statusCode).toBe(404);
  const r = await get(url, operador);
  expect(r.statusCode).toBe(200);
  expect(r.headers['content-type']).toMatch(/^text\/markdown/);
  expect(r.headers['content-disposition']).toMatch(/^attachment; filename="ficha-t-upd-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.md"$/);
  expect(r.headers['cache-control']).toBe('no-store');
  const md = r.body;
  expect(md).toContain('# Ficha de reconstrucción: Portal upd');
  expect(md).toContain('`wp_`'); // el aviso de PHP que antecede al valor se descarta
  expect(md).not.toContain('ruido de PHP');
  expect(md).toContain('bitnami_wordpress');
  expect(md).toContain('https://sitio.example.gt');
  expect(md).toMatch(/Divi|divi/);
  expect(md).toContain('250 MB'); // wpcontent_mb simulado
  expect(md).not.toMatch(/passw|secret|token|_KEY/i);
});

test('descarga: contraseña, nombre del listado, permiso de un solo uso y solo administrador', async () => {
  const pedir = `/api/portales/${idPortal}/updraft/descarga`;
  expect((await post(pedir, { nombre: NOMBRE, password: CLAVE })).statusCode).toBe(401);
  expect((await post(pedir, { nombre: NOMBRE, password: CLAVE }, operador)).statusCode).toBe(403); // el operador no descarga
  expect((await post(pedir, { nombre: NOMBRE }, admin)).statusCode).toBe(400);
  expect((await post(pedir, { nombre: NOMBRE, password: 'clave-equivocada-1' }, admin)).statusCode).toBe(403);
  // Nombres que no son de UpdraftPlus o que el portal no lista
  for (const n of ['../../etc/passwd', `${NOMBRE}/../x`, 'index.html', 'log.de186cbe3d14.txt']) expect((await post(pedir, { nombre: n, password: CLAVE }, admin)).statusCode, n).toBe(400);
  expect((await post(pedir, { nombre: 'backup_2026-11-05-1539_Sitio_aaaaaaaaaaaa-db.gz', password: CLAVE }, admin)).statusCode).toBe(404);

  const t = await post(pedir, { nombre: NOMBRE, password: CLAVE }, admin);
  expect(t.statusCode).toBe(200);
  expect(t.json()).toMatchObject({ nombre: NOMBRE, bytes: DATOS.length });
  const url: string = t.json().url;
  expect(url).toMatch(/^\/api\/descargas\/[A-Za-z0-9_-]{30,}$/);

  // El enlace sirve solo con sesión de administrador, y solo para quien lo pidió
  sim.flujo = () => ({ flujo: Readable.from([DATOS]), cancelar: () => {} });
  expect((await get(url)).statusCode).toBe(401);
  expect((await get(url, lector)).statusCode).toBe(403);
  expect((await get(url, admin2)).statusCode).toBe(404); // otro administrador no puede usar el permiso ajeno (y lo consume)
  expect((await get(url, admin)).statusCode).toBe(404); // ya se consumió
  // Permiso nuevo: baja el archivo completo, con su tamaño y nombre
  const t2 = await post(pedir, { nombre: NOMBRE, password: CLAVE }, admin);
  const r = await get(t2.json().url, admin);
  expect(r.statusCode).toBe(200);
  expect(r.rawPayload.equals(DATOS)).toBe(true);
  expect(r.headers['content-length']).toBe(String(DATOS.length));
  expect(r.headers['content-disposition']).toBe(`attachment; filename="${NOMBRE}"`);
  expect(r.headers['content-type']).toBe('application/octet-stream');
  expect(r.headers['cache-control']).toBe('no-store');
  // Un solo uso: repetirlo da 404
  expect((await get(t2.json().url, admin)).statusCode).toBe(404);
  // Si el archivo desaparece del portal entre el permiso y la descarga
  const t3 = await post(pedir, { nombre: NOMBRE, password: CLAVE }, admin);
  sim.listado = false;
  expect((await get(t3.json().url, admin)).statusCode).toBe(404);
  sim.listado = true;
  // Un permiso inventado no sirve
  expect((await get('/api/descargas/inventado', admin)).statusCode).toBe(404);
});

test('descarga: intentos de contraseña limitados', async () => {
  const pedir = `/api/portales/${idPortal}/updraft/descarga`;
  for (let i = 0; i < 8; i++) await post(pedir, { nombre: NOMBRE, password: `mal-${i}-123456` }, admin2);
  expect((await post(pedir, { nombre: NOMBRE, password: CLAVE }, admin2)).statusCode).toBe(429); // ni con la correcta
});
