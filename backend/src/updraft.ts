// Lectura de las copias de UpdraftPlus y de su avance. Todo son funciones puras (con prueba): lo que viene del pod se valida aquí.

export const CARPETA_UPDRAFT = '/bitnami/wordpress/wp-content/updraft';

// Nombre que genera UpdraftPlus: backup_2026-11-05-1539_Sitio_de186cbe3d14-plugins.zip  /  …-db.gz  /  …-uploads2.zip
// Se valida con una expresión estricta antes de usarlo como ruta: nunca se concatena algo que no pase por aquí.
const NOMBRE = /^backup_(\d{4}-\d{2}-\d{2})-(\d{4})_([A-Za-z0-9_.-]{1,100})_([0-9a-f]{12})-([a-z][a-z0-9-]*?)(\d*)\.(zip|gz)$/;

export type Pieza = { nombre: string; tipo: string; bytes: number; modificado: string };
export type Copia = { nonce: string; fecha: string; hora: string; piezas: Pieza[]; bytes: number; completa: boolean };

export const nombreValido = (n: string) => NOMBRE.test(n);

/** Salida de `stat -c "%s %Y %n" backup_*`: una línea por archivo. Ignora todo lo que no tenga la forma exacta de UpdraftPlus. */
export function parsearListado(salida: string): Copia[] {
  const porNonce = new Map<string, Copia>();
  for (const linea of salida.split('\n')) {
    const m = /^(\d+) (\d+) (.+)$/.exec(linea.trim());
    if (!m) continue;
    const [, bytes, mtime, nombre] = m as unknown as [string, string, string, string];
    const n = NOMBRE.exec(nombre);
    if (!n) continue;
    const [, fecha, hora, , nonce, tipo] = n as unknown as [string, string, string, string, string, string];
    const c = porNonce.get(nonce) ?? { nonce, fecha, hora: `${hora.slice(0, 2)}:${hora.slice(2)}`, piezas: [], bytes: 0, completa: false };
    c.piezas.push({ nombre, tipo, bytes: Number(bytes), modificado: new Date(Number(mtime) * 1000).toISOString() });
    c.bytes += Number(bytes);
    porNonce.set(nonce, c);
  }
  const copias = [...porNonce.values()];
  for (const c of copias) {
    c.piezas.sort((a, b) => a.nombre.localeCompare(b.nombre));
    // Completa = trae la base y al menos una pieza de archivos (si no, no alcanza para reconstruir el sitio).
    c.completa = c.piezas.some((p) => p.tipo === 'db') && c.piezas.some((p) => ['plugins', 'themes', 'uploads', 'others'].includes(p.tipo));
  }
  return copias.sort((a, b) => `${b.fecha}${b.hora}`.localeCompare(`${a.fecha}${a.hora}`));
}

export type EstadoCopia = 'sin_actividad' | 'iniciando' | 'en_curso' | 'terminada' | 'detenida';
export type AvanceCopia = { estado: EstadoCopia; nonce: string | null; ultimaLinea: string; hace: number | null };

const FIN_OK = /The backup succeeded and is now complete|La copia de seguridad se ha realizado correctamente/i;
const SIN_MOVIMIENTO_S = 600; // un registro quieto 10 minutos sin haber terminado = la copia se cortó

/**
 * Salida del comando `updraft_log`: ruta del registro más reciente, su fecha (epoch) y sus últimas líneas.
 * `esperado` = la copia que SIMAP-Web lanzó (nonce y hora): mientras el registro de ESA copia no aparezca, no se da por buena
 * la copia anterior que ya estaba terminada.
 */
export function estadoDesdeLog(salida: string, ahoraS: number, esperado?: { nonce: string; desdeS: number }): AvanceCopia {
  const l = salida.trim().split('\n');
  const ruta = l[0] ?? '';
  const nonce = /log\.([0-9a-f]{12})\.txt$/.exec(ruta)?.[1] ?? null;
  const mtime = Number(l[1]);
  if (!nonce || !Number.isFinite(mtime)) return { estado: esperado ? 'iniciando' : 'sin_actividad', nonce: null, ultimaLinea: '', hace: null };
  const cola = l.slice(2).filter(Boolean);
  const ultimaLinea = (cola.at(-1) ?? '').replace(/^\d+\.\d+ \(\d+\) /, '').slice(0, 300);
  const hace = Math.max(0, ahoraS - mtime);
  if (esperado && nonce !== esperado.nonce) return { estado: 'iniciando', nonce: null, ultimaLinea: '', hace: null };
  if (cola.some((x) => FIN_OK.test(x))) return { estado: 'terminada', nonce, ultimaLinea, hace };
  return { estado: hace > SIN_MOVIMIENTO_S ? 'detenida' : 'en_curso', nonce, ultimaLinea, hace };
}

/**
 * ¿Cabe la copia? Una copia de UpdraftPlus ocupa más o menos lo que pesa wp-content (las imágenes ya vienen comprimidas) más la base.
 * Si el volumen se llena, el sitio se cae: por eso se exige un margen. Devuelve null si cabe, o el motivo si no.
 */
export function motivoSinEspacio(wpContentMb: number, libreKb: number): string | null {
  const necesarioMb = Math.ceil(wpContentMb * 1.15) + 100; // 15 % de margen + la base y el registro
  const libreMb = Math.floor(libreKb / 1024);
  if (!Number.isFinite(wpContentMb) || !Number.isFinite(libreMb)) return 'No se pudo medir el espacio del portal.';
  return libreMb >= necesarioMb ? null : `No hay espacio suficiente: la copia necesita unos ${necesarioMb} MB y el volumen tiene ${libreMb} MB libres. Una copia sin espacio podría tumbar el sitio.`;
}

/** Espacio libre (KB) de `df -Pk /bitnami`. */
export function libreKb(salidaDf: string): number {
  const c = salidaDf.trim().split('\n').at(-1)?.split(/\s+/) ?? [];
  return Number(c[3]);
}
