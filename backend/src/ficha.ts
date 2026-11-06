// Ficha de reconstrucción de un portal: lo que hay que saber para volver a levantarlo desde una copia.
// SOLO datos no secretos: nunca contraseñas, claves, wp-config ni valores de variables de entorno.
import type { RespaldoUpdraft } from './collector.js';

export type DatosFicha = {
  generada: Date;
  portal: { id: string; nombre: string; proyecto: string; deployment: string; contenedor: string; url: string };
  imagenActual: string; imagenAnterior: string;
  wordpress: string; php: string;
  dbHost: string; dbNombre: string; prefijoTablas: string; siteurl: string;
  plugins: { slug: string; nombre: string; versionActual: string; estado: string }[];
  temas: { name: string; status: string; version: string }[];
  wpContentMb: number | null; discoTotalGb: number | null;
  updraft: RespaldoUpdraft | null;
};

const o = (v: string | number | null | undefined, vacio = '(no disponible)') => (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? vacio : String(v));
// Los textos vienen del portal: se aplanan para que no puedan inyectar formato ni saltos de línea.
const limpio = (v: string) => v.replace(/[\r\n`|]/g, ' ').slice(0, 200);

export function fichaMarkdown(d: DatosFicha): string {
  const u = d.updraft;
  const filas = (xs: string[][], cab: string[]) => [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...xs.map((r) => `| ${r.map(limpio).join(' | ')} |`)].join('\n');
  return [
    `# Ficha de reconstrucción: ${limpio(d.portal.nombre)}`,
    '',
    `Generada por SIMAP-Web el ${d.generada.toISOString().slice(0, 16).replace('T', ' ')} UTC. Sirve para volver a levantar este portal desde una copia (ver GUIA-RECONSTRUCCION.md).`,
    '',
    '> **Esta ficha no trae contraseñas ni el `wp-config.php`.** Al reconstruir se crean credenciales nuevas para la base de datos; las sesiones de los usuarios dejarán de valer.',
    '',
    '## Dónde vive',
    '',
    `- Proyecto de OpenShift: \`${limpio(d.portal.proyecto)}\``,
    `- Deployment: \`${limpio(d.portal.deployment)}\` (contenedor \`${limpio(d.portal.contenedor)}\`)`,
    `- URL del sitio: ${limpio(d.portal.url)}`,
    `- URL configurada en WordPress (\`siteurl\`): ${o(d.siteurl)}`,
    '',
    '## Imagen (usar exactamente la misma)',
    '',
    `- Imagen actual: \`${o(d.imagenActual)}\``,
    `- Imagen anterior guardada: \`${o(d.imagenAnterior, '(ninguna)')}\``,
    `- WordPress: ${o(d.wordpress)} · PHP: ${o(d.php)}`,
    '',
    '## Base de datos',
    '',
    `- Servidor: \`${o(d.dbHost)}\` · nombre de la base: \`${o(d.dbNombre)}\``,
    `- **Prefijo de las tablas: \`${o(d.prefijoTablas)}\`** (debe ser el mismo en el WordPress nuevo: variable \`WORDPRESS_TABLE_PREFIX\`)`,
    '',
    '## Tamaño (para dimensionar los volúmenes nuevos)',
    '',
    `- \`wp-content\` sin copias: ${o(d.wpContentMb)} MB · volumen del portal: ${o(d.discoTotalGb)} GB`,
    '',
    `## Plugins (${d.plugins.length})`,
    '',
    filas(d.plugins.map((p) => [p.nombre, p.slug, p.versionActual, p.estado]), ['Plugin', 'Carpeta', 'Versión', 'Estado']),
    '',
    `## Temas (${d.temas.length})`,
    '',
    filas(d.temas.map((t) => [t.name, t.version, t.status]), ['Tema', 'Versión', 'Estado']),
    '',
    '## Respaldos',
    '',
    !u || !u.activo
      ? '- UpdraftPlus no está activo en este portal: no hay copia completa de archivos.'
      : [
        `- Última copia de UpdraftPlus: ${u.ultimo ? u.ultimo.slice(0, 16).replace('T', ' ') + ' UTC' : '**ninguna disponible**'}`,
        `- Guarda las copias fuera del portal: **${u.remoto ? 'sí' : 'NO (están en el mismo volumen: si el volumen se pierde, se pierden con él)'}**`,
        u.ultimo ? `- Incluye base de datos: ${u.incluyeBase ? 'sí' : 'no'} · archivos subidos: ${u.incluyeArchivos ? 'sí' : 'no'}` : '',
      ].filter(Boolean).join('\n'),
    '',
  ].join('\n');
}
