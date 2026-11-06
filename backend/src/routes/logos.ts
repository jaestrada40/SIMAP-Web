import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth.js';
import { query } from '../db.js';
import { requireRole } from './auth.js';

const MAX_BYTES = 512 * 1024;
const TIPOS = ['image/png', 'image/jpeg', 'image/webp'] as const;
const lugarSchema = z.enum(['sidebar', 'login']);

// Se comprueba el contenido real, no solo lo que dice el navegador. SVG no se acepta: puede llevar scripts.
export function tipoReal(b: Buffer): (typeof TIPOS)[number] | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export async function logosRoutes(app: FastifyInstance) {
  app.addContentTypeParser([...TIPOS], { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));

  // Públicos a propósito: el login (sin sesión) necesita mostrar su logo. No contienen nada sensible.
  app.get('/api/logos', async () => {
    const f = await query<{ lugar: string; actualizado_en: Date }>('SELECT lugar, actualizado_en FROM logos');
    return { sidebar: f.find((x) => x.lugar === 'sidebar')?.actualizado_en.getTime() ?? null, login: f.find((x) => x.lugar === 'login')?.actualizado_en.getTime() ?? null };
  });

  app.get<{ Params: { lugar: string } }>('/api/logos/:lugar', async (req, reply) => {
    const lugar = lugarSchema.safeParse(req.params.lugar);
    if (!lugar.success) return reply.code(404).send({ error: 'No existe' });
    const f = (await query<{ tipo: string; datos: Buffer }>('SELECT tipo, datos FROM logos WHERE lugar = $1', [lugar.data]))[0];
    if (!f) return reply.code(404).send({ error: 'Sin logo' });
    return reply.header('content-type', f.tipo).header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff').send(f.datos);
  });

  app.put<{ Params: { lugar: string } }>('/api/logos/:lugar', { bodyLimit: MAX_BYTES }, async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const lugar = lugarSchema.safeParse(req.params.lugar);
    if (!lugar.success) return reply.code(404).send({ error: 'No existe' });
    const cuerpo = req.body;
    if (!Buffer.isBuffer(cuerpo)) return reply.code(415).send({ error: 'Suba una imagen PNG, JPG o WebP.' });
    const tipo = tipoReal(cuerpo);
    if (!tipo || tipo !== req.headers['content-type']) return reply.code(415).send({ error: 'El archivo no es una imagen PNG, JPG o WebP válida.' });
    await query(
      `INSERT INTO logos (lugar, tipo, datos) VALUES ($1, $2, $3)
       ON CONFLICT (lugar) DO UPDATE SET tipo = $2, datos = $3, actualizado_en = now()`, [lugar.data, tipo, cuerpo]);
    await audit('logo_cambiado', { userId: s.userId, username: s.username, ip: req.ip, detail: { lugar: lugar.data, tipo, bytes: cuerpo.length } });
    return { ok: true };
  });

  app.delete<{ Params: { lugar: string } }>('/api/logos/:lugar', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const lugar = lugarSchema.safeParse(req.params.lugar);
    if (!lugar.success) return reply.code(404).send({ error: 'No existe' });
    await query('DELETE FROM logos WHERE lugar = $1', [lugar.data]);
    await audit('logo_quitado', { userId: s.userId, username: s.username, ip: req.ip, detail: { lugar: lugar.data } });
    return { ok: true };
  });
}
