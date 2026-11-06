// Uso: npm run revisar [-- <id-del-portal>]   — una revisión de solo lectura desde la terminal.
import { pool, query } from './db.js';
import { revisar } from './collector.js';

const n = await revisar(process.argv[2]);
console.log(`Revisados: ${n}`);
for (const r of await query<{ portal_id: string; estado: string; mensaje: string | null; datos: Record<string, unknown> }>(
  'SELECT portal_id, estado, mensaje, datos FROM portal_estado ORDER BY portal_id')) {
  const { plugins, ...resto } = r.datos as { plugins?: { versionNueva: string | null }[] };
  console.log(r.portal_id, r.estado, r.mensaje ?? '', JSON.stringify({ ...resto, pluginsTotal: plugins?.length, pluginsPendientes: plugins?.filter((p) => p.versionNueva).length }));
}
await pool.end();
