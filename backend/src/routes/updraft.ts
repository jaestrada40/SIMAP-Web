import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, checkPassword, clearFailures, lockedSeconds, recordFailure, type Session } from '../auth.js';
import { colaActiva } from '../cola.js';
import { cargarPortal, ubicar } from '../comunes.js';
import { query } from '../db.js';
import { ejecutar, lanzarUpdraft, transmitirArchivo } from '../k8s.js';
import { CARPETA_UPDRAFT, estadoDesdeLog, libreKb, motivoSinEspacio, nombreValido, parsearListado, type AvanceCopia } from '../updraft.js';
import { requireRole } from './auth.js';

const SIN_ARRANCAR_S = 120; // si en 2 minutos no aparece el registro de la copia, no arrancó (p. ej. el plugin no respondió)
const VIDA_TOKEN_S = 60;
const MAX_DESCARGAS = 2;

const descargaBody = z.object({ nombre: z.string().min(1).max(200), password: z.string().min(1).max(256) });
const ahoraS = () => Math.floor(Date.now() / 1000);

// Copias lanzadas desde SIMAP-Web (en memoria; si el servidor se reinicia, el avance se sigue leyendo del registro del plugin).
const lanzamientos = new Map<string, { nonce: string; desdeS: number }>();
// Permisos de descarga de un solo uso: se piden con la contraseña y vencen en 1 minuto.
const permisos = new Map<string, { userId: number; portalId: string; nombre: string; vence: number }>();
let descargasActivas = 0;

async function avance(portalId: string, p: { proyecto: string; contenedor: string }, pod: string): Promise<AvanceCopia> {
  const esperado = lanzamientos.get(portalId);
  const a = estadoDesdeLog(await ejecutar(p.proyecto, pod, p.contenedor, 'updraft_log').catch(() => ''), ahoraS(), esperado);
  if (esperado && a.estado === 'iniciando' && ahoraS() - esperado.desdeS > SIN_ARRANCAR_S) return { ...a, estado: 'detenida', ultimaLinea: 'La copia no llegó a arrancar.' };
  if (esperado && (a.estado === 'terminada' || a.estado === 'detenida')) lanzamientos.delete(portalId);
  return a;
}


/** IDs de los portales (de los pedidos) donde UpdraftPlus está haciendo una copia ahora: la cola de actualizaciones no debe arrancar encima. */
export async function copiaCorriendoEn(ids: string[]): Promise<string[]> {
  const ocupados: string[] = [];
  for (const id of ids) {
    const activo = (await query<{ a: string | null }>("SELECT datos->'respaldoUpdraft'->>'activo' AS a FROM portal_estado WHERE portal_id = $1", [id]))[0]?.a;
    if (activo !== 'true') continue;
    try {
      const { p } = await cargarPortal(id);
      const a = await avance(id, p, await ubicar(p));
      if (a.estado === 'en_curso' || a.estado === 'iniciando') ocupados.push(id);
    } catch { /* portal apagado o inalcanzable: la propia cola lo dirá en su primer paso */ }
  }
  return ocupados;
}

export async function updraftRoutes(app: FastifyInstance) {
  async function datosDelPod(id: string, reply: FastifyReply) {
    const cargado = await cargarPortal(id).catch(() => null);
    if (!cargado) { reply.code(404).send({ error: 'El portal no existe.' }); return null; }
    try {
      return { p: cargado.p, pod: await ubicar(cargado.p) };
    } catch (e) {
      reply.code(409).send({ error: e instanceof Error ? e.message : 'No se pudo ubicar el portal.' });
      return null;
    }
  }

  async function confirmarClave(req: FastifyRequest, reply: FastifyReply, s: Session, password: string) {
    const limite = `descarga:${req.ip}:${s.userId}`;
    const bloqueado = await lockedSeconds(limite);
    if (bloqueado !== null) { reply.code(429).header('Retry-After', String(bloqueado)).send({ error: `Demasiados intentos. Intente de nuevo en ${bloqueado} segundos.` }); return false; }
    const hash = (await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [s.userId]))[0]?.password_hash;
    if (!(await checkPassword(hash, password))) {
      await recordFailure(limite);
      reply.code(403).send({ error: 'La contraseña es incorrecta.' });
      return false;
    }
    await clearFailures(limite);
    return true;
  }

  // Copias que UpdraftPlus ya tiene en el portal y el avance de la que esté corriendo.
  app.get<{ Params: { id: string } }>('/api/portales/:id/updraft', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    const d = await datosDelPod(req.params.id, reply);
    if (!d) return;
    const [listado, av] = await Promise.all([
      ejecutar(d.p.proyecto, d.pod, d.p.contenedor, 'updraft_listado').catch(() => ''),
      avance(req.params.id, d.p, d.pod),
    ]);
    return { copias: parsearListado(listado), avance: av };
  });

  // Hacer una copia completa AHORA (base + plugins + temas + archivos + otros), en segundo plano.
  app.post<{ Params: { id: string } }>('/api/portales/:id/updraft/lanzar', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    if (colaActiva()) return reply.code(409).send({ error: 'Hay una cola en curso; espere a que termine.' });
    const activo = (await query<{ a: string | null }>("SELECT datos->'respaldoUpdraft'->>'activo' AS a FROM portal_estado WHERE portal_id = $1", [req.params.id]))[0]?.a;
    if (activo !== 'true') return reply.code(409).send({ error: 'UpdraftPlus no está activo en este portal (o aún no se ha revisado).' });
    const d = await datosDelPod(req.params.id, reply);
    if (!d) return;
    const actual = await avance(req.params.id, d.p, d.pod);
    if (actual.estado === 'en_curso' || actual.estado === 'iniciando') return reply.code(409).send({ error: 'Ya hay una copia en curso en este portal.' });
    // Sin espacio, una copia puede llenar el volumen y tumbar el sitio: se mide antes.
    const [mb, df] = await Promise.all([ejecutar(d.p.proyecto, d.pod, d.p.contenedor, 'wpcontent_mb'), ejecutar(d.p.proyecto, d.pod, d.p.contenedor, 'disco')]);
    const motivo = motivoSinEspacio(Number(mb.trim()), libreKb(df));
    if (motivo) return reply.code(409).send({ error: motivo });
    const nonce = randomBytes(6).toString('hex');
    try {
      await lanzarUpdraft(d.p.proyecto, d.pod, d.p.contenedor, nonce);
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : 'No se pudo lanzar la copia.' });
    }
    lanzamientos.set(req.params.id, { nonce, desdeS: ahoraS() });
    await audit('respaldo_updraft_iniciado', { userId: s.userId, username: s.username, ip: req.ip, detail: { portal: req.params.id } });
    return { ok: true, nonce };
  });

  // Paso 1 de la descarga: se pide la contraseña y se entrega un permiso de un solo uso (1 minuto) para UN archivo del listado.
  app.post<{ Params: { id: string } }>('/api/portales/:id/updraft/descarga', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const b = descargaBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos inválidos' });
    if (!(await confirmarClave(req, reply, s, b.data.password))) return;
    if (!nombreValido(b.data.nombre)) return reply.code(400).send({ error: 'Nombre de archivo inválido.' });
    const d = await datosDelPod(req.params.id, reply);
    if (!d) return;
    const copias = parsearListado(await ejecutar(d.p.proyecto, d.pod, d.p.contenedor, 'updraft_listado').catch(() => ''));
    const pieza = copias.flatMap((c) => c.piezas).find((x) => x.nombre === b.data.nombre); // solo lo que el propio portal lista
    if (!pieza) return reply.code(404).send({ error: 'Ese archivo ya no existe en el portal.' });
    const ahora = ahoraS();
    for (const [t, v] of permisos) if (v.vence < ahora) permisos.delete(t);
    const token = randomBytes(24).toString('base64url');
    permisos.set(token, { userId: s.userId, portalId: req.params.id, nombre: pieza.nombre, vence: ahora + VIDA_TOKEN_S });
    return { url: `/api/descargas/${token}`, nombre: pieza.nombre, bytes: pieza.bytes };
  });

  // Paso 2: el navegador abre este enlace y el archivo baja directo, sin pasar por la memoria del servidor ni del navegador.
  app.get<{ Params: { token: string } }>('/api/descargas/:token', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const permiso = permisos.get(req.params.token);
    permisos.delete(req.params.token); // un solo uso
    if (!permiso || permiso.vence < ahoraS() || permiso.userId !== s.userId) return reply.code(404).send({ error: 'El enlace de descarga venció o no es válido.' });
    if (descargasActivas >= MAX_DESCARGAS) return reply.code(429).send({ error: 'Hay demasiadas descargas en curso; intente en un momento.' });
    const d = await datosDelPod(permiso.portalId, reply);
    if (!d) return;
    const pieza = parsearListado(await ejecutar(d.p.proyecto, d.pod, d.p.contenedor, 'updraft_listado').catch(() => '')).flatMap((c) => c.piezas).find((x) => x.nombre === permiso.nombre);
    if (!pieza) return reply.code(404).send({ error: 'Ese archivo ya no existe en el portal.' });
    const { flujo, cancelar } = transmitirArchivo(d.p.proyecto, d.pod, d.p.contenedor, `${CARPETA_UPDRAFT}/${pieza.nombre}`);
    descargasActivas++;
    let liberado = false;
    const liberar = () => { if (!liberado) { liberado = true; descargasActivas--; } };
    flujo.on('close', liberar);
    flujo.on('error', liberar);
    reply.raw.on('close', () => { cancelar(); flujo.destroy(); liberar(); }); // si la persona cancela, se corta también en el pod
    await audit('respaldo_updraft_descargado', { userId: s.userId, username: s.username, ip: req.ip, detail: { portal: permiso.portalId, archivo: pieza.nombre, bytes: pieza.bytes } });
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(pieza.bytes))
      .header('content-disposition', `attachment; filename="${pieza.nombre}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(flujo);
  });
}
