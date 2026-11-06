import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { revisar, revisionEnCurso, type Datos } from '../collector.js';
import { requireRole } from './auth.js';

type Fila = {
  id: string; nombre: string; proyecto: string; deployment: string; contenedor: string; url: string;
  estado: string | null; datos: Partial<Datos> | null; mensaje: string | null; revisado_en: Date | null; previa: string | null; base_actualizada: boolean | null;
};

const SQL = `SELECT p.id, p.nombre, p.proyecto, p.deployment, p.contenedor, p.url, e.estado, e.datos, e.mensaje, e.revisado_en, i.imagen AS previa, i.base_actualizada
               FROM portales p LEFT JOIN portal_estado e ON e.portal_id = p.id LEFT JOIN imagen_previa i ON i.portal_id = p.id WHERE p.activo`;

// Misma forma que `Portal` del frontend, para no tocar las pantallas. Lo que aún no se recolecta va vacío.
function aPortal(f: Fila) {
  const d = f.datos ?? {};
  return {
    id: f.id, nombre: f.nombre, proyecto: f.proyecto, deployment: f.deployment, contenedor: f.contenedor, url: f.url,
    php: d.php ?? '0', wordpress: d.wordpress ?? '0', wordpressDisponible: d.wordpressDisponible ?? '',
    plugins: d.plugins ?? [], estadoHttp: d.estadoHttp ?? 0, tiempoRespuestaMs: d.tiempoRespuestaMs ?? 0,
    discoUsadoPct: d.discoUsadoPct ?? 0, discoTotalGb: d.discoTotalGb ?? 0,
    ultimaRevision: f.revisado_en?.toISOString() ?? '', imagenActual: d.imagen ?? '', imagenAnterior: f.previa ?? '', baseActualizada: f.base_actualizada ?? false, nodo: d.nodo ?? '', ultimoRespaldo: d.ultimoRespaldo ?? '',
    autoActualizacion: d.autoActualizacion ?? null, respaldoUpdraft: d.respaldoUpdraft ?? null,
    estadoRecoleccion: f.estado ?? 'sin_datos', mensaje: f.mensaje,
  };
}

const revisarBody = z.object({ id: z.string().min(1).max(100).optional() }).default({});

export async function portalesRoutes(app: FastifyInstance) {
  app.get('/api/portales', async (req, reply) => {
    if (!(await requireRole(req, reply, ['administrador', 'operador', 'lector']))) return;
    return (await query<Fila>(`${SQL} ORDER BY p.nombre`)).map(aPortal);
  });

  app.get<{ Params: { id: string } }>('/api/portales/:id', async (req, reply) => {
    if (!(await requireRole(req, reply, ['administrador', 'operador', 'lector']))) return;
    const f = (await query<Fila>(`${SQL} AND p.id = $1`, [req.params.id]))[0];
    return f ? aPortal(f) : reply.code(404).send({ error: 'El portal no existe' });
  });

  app.get('/api/revision', async (req, reply) => {
    if (!(await requireRole(req, reply, ['administrador', 'operador', 'lector']))) return;
    const r = (await query<{ ultima: Date | null }>('SELECT max(revisado_en) AS ultima FROM portal_estado'))[0];
    return { enCurso: revisionEnCurso(), ultima: r?.ultima?.toISOString() ?? null };
  });

  // Solo lectura en los portales, pero gasta recursos del clúster: solo administrador y operador.
  app.post('/api/portales/revisar', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    const body = revisarBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Datos inválidos' });
    if (revisionEnCurso()) return reply.code(409).send({ error: 'Ya hay una revisión en curso.' });
    const n = await revisar(body.data.id, { userId: s.userId, username: s.username, ip: req.ip });
    return { revisados: n };
  });
}
