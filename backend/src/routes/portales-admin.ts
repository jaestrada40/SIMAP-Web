import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth.js';
import { colaActiva } from '../cola.js';
import { NOMBRE_K8S, revisar, revisionEnCurso } from '../collector.js';
import { query } from '../db.js';
import { requireRole } from './auth.js';

const k8sNombre = z.string().trim().min(1).max(63).regex(NOMBRE_K8S, 'Solo minúsculas, números y guiones (así se llaman en OpenShift).');
// Solo https y sin usuario/clave dentro de la dirección: el servidor consulta esta URL, no debe poder apuntar a cualquier cosa.
const urlHttps = z.string().trim().max(300).refine((u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password; } catch { return false; }
}, 'La URL debe empezar con https:// y no llevar usuario ni clave.');

const datos = z.object({
  nombre: z.string().trim().min(1, 'Escriba un nombre.').max(120),
  proyecto: k8sNombre,
  deployment: k8sNombre,
  contenedor: k8sNombre,
  url: urlHttps,
});
const bajaBody = z.object({ confirmacion: z.string().max(100).optional() }).default({});

/** Identificador estable a partir del nombre: "Dotación (prueba)" -> "dotacion-prueba". */
export function idDesdeNombre(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

const mensajeZod = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${String(i.path[0])}: ` : ''}${i.message}` : 'Datos inválidos';
};

export async function portalesAdminRoutes(app: FastifyInstance) {
  // Una revisión de solo lectura para saber enseguida si el portal es alcanzable (permisos, nombres, etc.).
  async function revisarYResumir(id: string, quien: { userId?: number; username?: string; ip?: string }) {
    if (!revisionEnCurso()) await revisar(id, quien).catch(() => null);
    const r = (await query<{ estado: string; mensaje: string | null }>('SELECT estado, mensaje FROM portal_estado WHERE portal_id = $1', [id]))[0];
    return { estado: r?.estado ?? 'sin_datos', mensaje: r?.mensaje ?? null };
  }
  const limpiarLectura = async (id: string) => {
    await query('DELETE FROM portal_estado WHERE portal_id = $1', [id]);
    await query('DELETE FROM imagen_previa WHERE portal_id = $1', [id]); // la imagen anterior de OTRO deployment sería peligrosa para una vuelta atrás
  };

  app.post('/api/portales', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const b = datos.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: mensajeZod(b.error) });
    const id = idDesdeNombre(b.data.nombre);
    if (id.length < 2) return reply.code(400).send({ error: 'El nombre debe tener al menos 2 letras o números.' });
    const previos = await query<{ id: string; activo: boolean }>('SELECT id, activo FROM portales WHERE id = $1 OR (proyecto = $2 AND deployment = $3)', [id, b.data.proyecto, b.data.deployment]);
    if (previos.some((p) => p.activo)) return reply.code(409).send({ error: 'Ya hay un portal registrado con ese nombre o con ese proyecto y deployment.' });
    if (previos.length > 1) return reply.code(409).send({ error: 'Ese nombre y ese deployment pertenecen a portales dados de baja distintos; use otro nombre.' });
    const quien = { userId: s.userId, username: s.username, ip: req.ip };
    const destino = previos[0]?.id ?? id;
    if (previos[0]) { // estaba dado de baja: se reactiva con los datos nuevos y sin lecturas viejas
      await query('UPDATE portales SET nombre = $2, proyecto = $3, deployment = $4, contenedor = $5, url = $6, activo = true WHERE id = $1',
        [destino, b.data.nombre, b.data.proyecto, b.data.deployment, b.data.contenedor, b.data.url]);
      await limpiarLectura(destino);
    } else {
      await query('INSERT INTO portales (id, nombre, proyecto, deployment, contenedor, url) VALUES ($1, $2, $3, $4, $5, $6)',
        [destino, b.data.nombre, b.data.proyecto, b.data.deployment, b.data.contenedor, b.data.url]);
    }
    await audit('portal_creado', { ...quien, detail: { portal: destino, nombre: b.data.nombre, proyecto: b.data.proyecto, deployment: b.data.deployment, reactivado: !!previos[0] } });
    return { id: destino, ...(await revisarYResumir(destino, quien)) };
  });

  app.patch<{ Params: { id: string } }>('/api/portales/:id', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const b = datos.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: mensajeZod(b.error) });
    const p = (await query<{ proyecto: string; deployment: string; contenedor: string }>('SELECT proyecto, deployment, contenedor FROM portales WHERE id = $1 AND activo', [req.params.id]))[0];
    if (!p) return reply.code(404).send({ error: 'El portal no existe.' });
    if (colaActiva()) return reply.code(409).send({ error: 'Hay una cola en curso; termínela o deténgala antes de editar portales.' });
    try {
      await query('UPDATE portales SET nombre = $2, proyecto = $3, deployment = $4, contenedor = $5, url = $6 WHERE id = $1',
        [req.params.id, b.data.nombre, b.data.proyecto, b.data.deployment, b.data.contenedor, b.data.url]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Ya hay otro portal con ese proyecto y deployment.' });
      throw e;
    }
    const cambioDeDestino = p.proyecto !== b.data.proyecto || p.deployment !== b.data.deployment || p.contenedor !== b.data.contenedor;
    if (cambioDeDestino) await limpiarLectura(req.params.id);
    const quien = { userId: s.userId, username: s.username, ip: req.ip };
    await audit('portal_modificado', { ...quien, detail: { portal: req.params.id, destinoCambiado: cambioDeDestino } });
    return { id: req.params.id, ...(await revisarYResumir(req.params.id, quien)) };
  });

  // "Baja": el portal deja de monitorearse y de aparecer, pero no se borra (queda su historial y se puede volver a agregar).
  app.post<{ Params: { id: string } }>('/api/portales/:id/baja', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const b = bajaBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const existe = (await query('SELECT 1 FROM portales WHERE id = $1 AND activo', [req.params.id])).length > 0;
    if (!existe) return reply.code(404).send({ error: 'El portal no existe.' });
    if (b.data.confirmacion !== req.params.id) return reply.code(400).send({ error: 'Confirmación incorrecta: escriba exactamente el identificador del portal.' });
    if (colaActiva()) return reply.code(409).send({ error: 'Hay una cola en curso; termínela o deténgala antes de dar de baja un portal.' });
    await query('UPDATE portales SET activo = false WHERE id = $1', [req.params.id]);
    await audit('portal_baja', { userId: s.userId, username: s.username, ip: req.ip, detail: { portal: req.params.id } });
    return { ok: true };
  });
}
