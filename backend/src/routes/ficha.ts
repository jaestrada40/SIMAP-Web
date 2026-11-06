import type { FastifyInstance } from 'fastify';
import { cargarPortal, ubicar } from '../comunes.js';
import { query } from '../db.js';
import type { Datos } from '../collector.js';
import { ejecutar } from '../k8s.js';
import { fichaMarkdown } from '../ficha.js';
import { requireRole } from './auth.js';

const ultima = (s: string) => s.trim().split('\n').at(-1) ?? ''; // WP-CLI a veces antepone avisos de PHP

export async function fichaRoutes(app: FastifyInstance) {
  // Ficha de reconstrucción (Markdown, sin secretos). Mezcla lo guardado en la última revisión con lecturas frescas de solo lectura.
  app.get<{ Params: { id: string } }>('/api/portales/:id/ficha-reconstruccion', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador']);
    if (!s) return;
    const cargado = await cargarPortal(req.params.id).catch(() => null);
    if (!cargado) return reply.code(404).send({ error: 'El portal no existe.' });
    const { p } = cargado;
    const fila = (await query<{ datos: Partial<Datos> | null; previa: string | null }>(
      `SELECT e.datos, i.imagen AS previa FROM portales q LEFT JOIN portal_estado e ON e.portal_id = q.id LEFT JOIN imagen_previa i ON i.portal_id = q.id WHERE q.id = $1`, [p.id]))[0];
    const d = fila?.datos ?? {};
    // Lecturas en vivo; si el portal no responde, la ficha sale con lo guardado y lo que falte se marca "(no disponible)".
    let pod = '';
    try { pod = await ubicar(p); } catch { /* apagado o sin pod listo */ }
    const vivo = async (c: Parameters<typeof ejecutar>[3]) => (pod ? ultima(await ejecutar(p.proyecto, pod, p.contenedor, c).catch(() => '')) : '');
    const [prefijo, dbNombre, siteurl, mb] = await Promise.all([vivo('prefijo_tablas'), vivo('db_nombre'), vivo('siteurl'), vivo('wpcontent_mb')]);
    let temas: { name: string; status: string; version: string }[] = [];
    try {
      const bruto = pod ? await ejecutar(p.proyecto, pod, p.contenedor, 'temas') : '';
      if (bruto.includes('[')) temas = JSON.parse(bruto.slice(bruto.indexOf('['))) as typeof temas;
    } catch { /* sin temas legibles */ }
    const md = fichaMarkdown({
      generada: new Date(), portal: p,
      imagenActual: d.imagen ?? '', imagenAnterior: fila?.previa ?? '', wordpress: d.wordpress ?? '', php: d.php ?? '',
      dbHost: d.dbHost ?? '', dbNombre, prefijoTablas: prefijo, siteurl,
      plugins: (d.plugins ?? []).map((x) => ({ slug: x.slug, nombre: x.nombre, versionActual: x.versionActual, estado: x.estado })), temas,
      wpContentMb: mb === '' ? null : Number(mb), discoTotalGb: d.discoTotalGb ?? null, updraft: d.respaldoUpdraft ?? null,
    });
    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="ficha-${p.id}-${new Date().toISOString().slice(0, 10)}.md"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(md);
  });
}
