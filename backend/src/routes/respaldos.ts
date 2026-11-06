import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { audit, checkPassword, clearFailures, lockedSeconds, recordFailure } from '../auth.js';
import { colaActiva } from '../cola.js';
import { revisar, revisionEnCurso } from '../collector.js';
import { cargarPortal, etiquetar, respaldar, ubicar, verificarDiscoYBase } from '../comunes.js';
import { query } from '../db.js';
import { leerArchivoRespaldo } from '../k8s.js';
import { requireRole } from './auth.js';

const comprimir = promisify(gzip);
const MAX_DESCARGA = 300 * 1024 * 1024; // el SQL sin comprimir; más allá, el respaldo de la plataforma es la vía correcta
const descargaBody = z.object({ password: z.string().min(1).max(256) });

export async function respaldosRoutes(app: FastifyInstance) {
  // Un solo respaldo o descarga a la vez: son exportaciones pesadas de la base.
  let ocupado = false;

  async function antes(reply: FastifyReply, id: string) {
    if (colaActiva()) { reply.code(409).send({ error: 'Hay una cola en curso; espere a que termine.' }); return null; }
    if (revisionEnCurso() || ocupado) { reply.code(409).send({ error: 'Hay una revisión o un respaldo en curso; espere a que termine.' }); return null; }
    const cargado = await cargarPortal(id).catch(() => null);
    if (!cargado) { reply.code(404).send({ error: 'El portal no existe.' }); return null; }
    return cargado;
  }

  // Respaldo de la base a pedido (por ejemplo antes de pulsar a mano un "Update Database" de un plugin). Sobrescribe el .sql anterior.
  app.post<{ Params: { id: string } }>('/api/portales/:id/respaldo', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    const cargado = await antes(reply, req.params.id);
    if (!cargado) return;
    ocupado = true;
    try {
      const l = etiquetar(false);
      const previo = await verificarDiscoYBase(cargado.p, cargado.dbEsperado, l);
      if (!previo.ok) return reply.code(409).send({ error: previo.log.at(-1) ?? 'No se pudo verificar el portal.', log: previo.log });
      const r = await respaldar(cargado.p, false, l);
      await audit('respaldo_manual', { userId: s.userId, username: s.username, ip: req.ip, detail: { portal: cargado.p.id } });
      await revisar(cargado.p.id).catch(() => null); // refresca "último respaldo" en la ficha
      return { ok: true, log: [...previo.log, ...r.log] };
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : 'No se pudo hacer el respaldo.' });
    } finally {
      ocupado = false;
    }
  });

  // Descarga del respaldo de la base: hace uno nuevo y lo entrega comprimido. Solo administrador y con la contraseña pedida otra vez:
  // el archivo contiene datos de personas y los hashes de contraseñas de WordPress.
  app.post<{ Params: { id: string } }>('/api/portales/:id/respaldo/descargar', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const b = descargaBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Escriba su contraseña para descargar el respaldo.' });
    const limite = `descarga:${req.ip}:${s.userId}`;
    const bloqueado = await lockedSeconds(limite);
    if (bloqueado !== null) return reply.code(429).header('Retry-After', String(bloqueado)).send({ error: `Demasiados intentos. Intente de nuevo en ${bloqueado} segundos.` });
    const hash = (await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [s.userId]))[0]?.password_hash;
    if (!(await checkPassword(hash, b.data.password))) {
      await recordFailure(limite);
      return reply.code(403).send({ error: 'La contraseña es incorrecta.' });
    }
    await clearFailures(limite);
    const cargado = await antes(reply, req.params.id);
    if (!cargado) return;
    ocupado = true;
    try {
      const l = etiquetar(false);
      const previo = await verificarDiscoYBase(cargado.p, cargado.dbEsperado, l);
      if (!previo.ok) return reply.code(409).send({ error: previo.log.at(-1) ?? 'No se pudo verificar el portal.' });
      await respaldar(cargado.p, false, l); // siempre uno fresco: lo que se descarga es el estado de ahora
      const sql = await leerArchivoRespaldo(cargado.p.proyecto, await ubicar(cargado.p), cargado.p.contenedor, MAX_DESCARGA);
      const zip = await comprimir(sql);
      await audit('respaldo_descargado', { userId: s.userId, username: s.username, ip: req.ip, detail: { portal: cargado.p.id, bytes: zip.length } });
      const fecha = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'application/gzip')
        .header('content-disposition', `attachment; filename="respaldo-${cargado.p.id}-${fecha}.sql.gz"`)
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send(zip);
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : 'No se pudo preparar el respaldo.' });
    } finally {
      ocupado = false;
    }
  });
}
