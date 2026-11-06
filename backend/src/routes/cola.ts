import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { accionCola, colaActiva, estadoCola, iniciarCola } from '../cola.js';
import { revisionEnCurso } from '../collector.js';
import { imagenObjetivo, revertirImagen } from '../nucleo.js';
import { requireRole } from './auth.js';
import { copiaCorriendoEn } from './updraft.js';

const iniciarBody = z.object({
  tipo: z.enum(['plugins', 'nucleo_php']),
  ids: z.array(z.string().min(1).max(100)).min(1).max(50).refine((a) => new Set(a).size === a.length, 'Portales repetidos'),
  simulacion: z.boolean(),
  confirmacion: z.record(z.string(), z.string()).optional(), // id del portal → lo que escribió la persona
});
const accionBody = z.object({ accion: z.enum(['reintentar', 'saltar', 'volver', 'detener', 'limpiar']), confirmacion: z.string().optional() });
const volverBody = z.object({ confirmacion: z.string().optional() }).default({});
const NO_CONFIRMADO = 'Confirmación incorrecta: escriba exactamente el nombre del portal.';

export async function colaRoutes(app: FastifyInstance) {
  app.get('/api/cola', async (req, reply) => {
    if (!(await requireRole(req, reply, ['administrador', 'operador', 'lector']))) return;
    return { cola: estadoCola(), imagenObjetivo: imagenObjetivo() };
  });

  app.post('/api/cola', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    const body = iniciarBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos inválidos' });
    if (body.data.tipo === 'nucleo_php' && !body.data.simulacion && !imagenObjetivo()) return reply.code(400).send({ error: 'Falta configurar IMAGEN_OBJETIVO en el servidor (debe terminar en @sha256:…).' });
    if (colaActiva()) return reply.code(409).send({ error: 'Ya hay una cola en curso.' });
    if (revisionEnCurso()) return reply.code(409).send({ error: 'Hay una revisión en curso; espere a que termine.' });
    // Escribir el nombre de cada portal es obligatorio en toda cola real (en simulación no cambia nada). No basta con la pantalla.
    if (!body.data.simulacion && !body.data.ids.every((id) => body.data.confirmacion?.[id] === id)) return reply.code(400).send({ error: NO_CONFIRMADO });
    const existentes = await query<{ id: string }>('SELECT id FROM portales WHERE activo AND id = ANY($1)', [body.data.ids]);
    if (existentes.length !== body.data.ids.length) return reply.code(400).send({ error: 'Algún portal no existe.' });
    if (!body.data.simulacion) {
      const ocupados = await copiaCorriendoEn(body.data.ids);
      if (ocupados.length) return reply.code(409).send({ error: `UpdraftPlus está haciendo una copia en: ${ocupados.join(', ')}. Espere a que termine para no actualizar encima.` });
    }
    return { cola: iniciarCola(body.data.tipo, body.data.ids, body.data.simulacion, { userId: s.userId, username: s.username, ip: req.ip }) };
  });

  // Vuelta atrás suelta (fuera de una cola), desde la ficha del portal.
  app.post<{ Params: { id: string } }>('/api/portales/:id/volver', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    if (colaActiva()) return reply.code(409).send({ error: 'Hay una cola en curso; termínela o deténgala primero.' });
    const b = volverBody.safeParse(req.body ?? {});
    if (!b.success || b.data.confirmacion !== req.params.id) return reply.code(400).send({ error: NO_CONFIRMADO });
    const r = await revertirImagen(req.params.id, { userId: s.userId, username: s.username, ip: req.ip });
    return r.ok ? { ok: true, log: r.log } : reply.code(409).send({ error: r.log.at(-1) ?? 'No se pudo volver a la imagen anterior', log: r.log });
  });

  app.post('/api/cola/accion', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    const body = accionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const c = estadoCola();
    if (body.data.accion === 'volver' && body.data.confirmacion !== c?.items[c.indice]?.portalId) return reply.code(400).send({ error: NO_CONFIRMADO });
    try {
      return { cola: accionCola(body.data.accion, { userId: s.userId, username: s.username, ip: req.ip }) };
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : 'Acción no permitida' });
    }
  });
}
