import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { audit } from './auth.js';
import { query } from './db.js';
import { ejecutar, k8s } from './k8s.js';

export type PortalFila = { id: string; nombre: string; proyecto: string; deployment: string; contenedor: string; url: string };
export type PluginInfo = { slug: string; nombre: string; versionActual: string; versionNueva: string | null; estado: 'activo' | 'inactivo'; excluido: boolean };
// Auto-actualización del portal. Solo estos 4 datos: la opción MPSUM también trae correos y no se guardan.
// `todoDesactivado`: interruptor general de EUM (all_updates = "off" es "Desactivar todas las actualizaciones"); manda sobre los otros tres.
export type AutoActualizacion = { plugin: boolean; todoDesactivado: boolean; nucleo: string | null; plugins: string | null; temas: string | null };
export const SLUG_EUM = 'stops-core-theme-and-plugin-updates'; // Easy Updates Manager

// Plugins que la cola de plugins nunca toca (por ahora solo desde el servidor: PLUGINS_EXCLUIDOS=slug1,slug2).
export const EXCLUIDOS = new Set((process.env.PLUGINS_EXCLUIDOS ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// Estado del respaldo de UpdraftPlus (solo lectura). `remoto`: guarda las copias fuera del portal (si no, quedan en el mismo volumen).
export type RespaldoUpdraft = { activo: boolean; ultimo: string; remoto: boolean; incluyeBase: boolean | null; incluyeArchivos: boolean | null };

export type Datos = {
  respaldoUpdraft: RespaldoUpdraft;
  autoActualizacion: AutoActualizacion;
  wordpressDisponible: string; // versión más nueva del núcleo según WordPress (= la instalada si está al día); ausente si no se pudo consultar
  ultimoRespaldo: string; // ISO; vacío si el portal aún no tiene respaldo de SIMAP
  imagen: string; nodo: string; php: string; wordpress: string; plugins: PluginInfo[];
  discoUsadoPct: number; discoTotalGb: number; estadoHttp: number; tiempoRespuestaMs: number; dbHost: string;
};
export type Resultado = { estado: 'ok' | 'apagado' | 'sin_acceso' | 'error'; datos: Partial<Datos>; mensaje: string | null };

export const NOMBRE_K8S = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/; // así se llaman los proyectos, deployments y contenedores

// --- Lectura de la salida de los comandos (funciones puras, con prueba) ---
export function leerPlugins(salida: string): PluginInfo[] {
  const ini = salida.indexOf('['); // WP-CLI a veces antepone avisos de PHP
  const filas = JSON.parse(salida.slice(ini)) as { name: string; title?: string; status: string; version: string; update: string; update_version?: string }[];
  return filas.map((f) => ({
    slug: f.name,
    nombre: f.title || f.name,
    versionActual: f.version,
    versionNueva: f.update === 'available' ? (f.update_version ?? null) : null,
    estado: f.status === 'active' || f.status === 'active-network' ? 'activo' : 'inactivo',
    excluido: EXCLUIDOS.has(f.name),
  }));
}

// `wp core check-update`: lista vacía si el núcleo está al día. Devuelve la versión más alta ofrecida, o la instalada.
export function leerNucleoDisponible(salida: string, instalada: string): string {
  const ini = salida.indexOf('[');
  const filas = ini < 0 ? [] : (JSON.parse(salida.slice(ini)) as { version: string }[]);
  const nums = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const mayor = (a: string, b: string) => {
    const [x, y] = [nums(a), nums(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
  };
  return filas.reduce((m, f) => (mayor(f.version, m) ? f.version : m), instalada);
}

export function leerFechaRespaldo(salida: string | null): string {
  const s = Number(salida?.trim());
  return Number.isFinite(s) && s > 0 ? new Date(s * 1000).toISOString() : '';
}

const ultimaLinea = (s: string) => s.trim().split('\n').at(-1) ?? ''; // WP-CLI a veces antepone avisos de PHP

/**
 * Lee la salida del comando `updraft_estado`. Una copia solo cuenta si de verdad existe: si UpdraftPlus guarda fuera del portal se confía
 * en su registro (el archivo local puede haberse borrado tras subirlo); si no, tiene que haber archivos en el disco del portal.
 */
/**
 * ¿Es UpdraftPlus? Por su nombre real y no solo por la carpeta: alguien puede haber renombrado la carpeta (p. ej. a `updraftplus-off`
 * para apagarlo) y el plugin sigue funcionando igual. `UpdraftCentral` y otros no coinciden.
 */
export const esUpdraft = (x: { slug: string; nombre: string }) => /^updraftplus/i.test(x.slug) || /updraftplus/i.test(x.nombre);

export function leerRespaldoUpdraft(activo: boolean, salida: string | null): RespaldoUpdraft {
  const nada: RespaldoUpdraft = { activo, ultimo: '', remoto: false, incluyeBase: null, incluyeArchivos: null };
  if (!activo || !salida) return nada;
  try {
    const e = JSON.parse(ultimaLinea(salida)) as {
      backup_time?: unknown; success?: unknown; errores?: unknown; servicio?: unknown;
      piezas?: Record<string, { registrados?: number; presentes?: number }>;
    };
    const servicios = Array.isArray(e.servicio) ? e.servicio : [e.servicio];
    const remoto = servicios.some((x) => typeof x === 'string' && x !== '' && x !== 'none');
    const hay = (k: string) => ((remoto ? e.piezas?.[k]?.registrados : e.piezas?.[k]?.presentes) ?? 0) > 0;
    const fallo = e.success === 0 || e.success === false || (typeof e.errores === 'number' && e.errores > 0);
    const vigente = ['db', 'plugins', 'themes', 'uploads', 'others'].some(hay);
    const ok = !fallo && vigente && typeof e.backup_time === 'number' && e.backup_time > 0;
    return {
      activo: true, remoto,
      ultimo: ok ? new Date((e.backup_time as number) * 1000).toISOString() : '',
      incluyeBase: ok ? hay('db') : null, incluyeArchivos: ok ? hay('uploads') : null,
    };
  } catch {
    return nada; // sin dato legible: no se inventa
  }
}

export function leerAutoActualizacion(activo: boolean, salida: string | null): AutoActualizacion {
  const nada = { plugin: activo, todoDesactivado: false, nucleo: null, plugins: null, temas: null };
  if (!activo || !salida) return nada;
  try {
    const core = (JSON.parse(salida.slice(salida.indexOf('{'))) as { core?: Record<string, unknown> }).core ?? {};
    const v = (k: string) => (typeof core[k] === 'string' ? (core[k] as string) : null);
    return { plugin: true, todoDesactivado: v('all_updates') === 'off', nucleo: v('core_updates'), plugins: v('plugin_updates'), temas: v('theme_updates') };
  } catch {
    return nada; // una opción ilegible no debe tumbar toda la revisión
  }
}

export function leerDisco(salida: string): { discoUsadoPct: number; discoTotalGb: number } {
  const c = salida.trim().split('\n').at(-1)?.split(/\s+/) ?? [];
  const totalKb = Number(c[1]), pct = Number(c[4]?.replace('%', ''));
  if (!Number.isFinite(totalKb) || !Number.isFinite(pct)) throw new Error(`Salida de df no reconocida: ${salida.trim()}`);
  return { discoUsadoPct: pct, discoTotalGb: Math.round((totalKb / 1024 / 1024) * 10) / 10 };
}

// El router de OpenShift usa una CA interna que Node no conoce: se agrega (HTTP_EXTRA_CA_FILE) a las CA normales.
// La verificación TLS nunca se desactiva.
const caExtra = process.env.HTTP_EXTRA_CA_FILE ? readFileSync(process.env.HTTP_EXTRA_CA_FILE, 'utf8') : undefined;

export function chequearHttp(url: string): Promise<{ estadoHttp: number; tiempoRespuestaMs: number }> {
  const fallo = { estadoHttp: 0, tiempoRespuestaMs: 0 };
  if (!/^https?:\/\//.test(url)) return Promise.resolve(fallo);
  const t0 = Date.now();
  return new Promise((resolve) => {
    // shortcut: no sigue redirecciones; el estado es el de la URL tal cual (un 301/302 cuenta como "responde"). Seguirlas si hace falta.
    const req = request(url, { method: 'GET', timeout: 10_000, ca: caExtra ? [...rootCertificates, caExtra] : undefined }, (res) => {
      res.resume();
      resolve({ estadoHttp: res.statusCode ?? 0, tiempoRespuestaMs: Date.now() - t0 });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(fallo));
    req.end();
  });
}

const codigoHttp = (e: unknown) => (e as { code?: number }).code;

export type UbicacionPod = { fallo?: never; imagen: string; pod: string; nodo: string } | { fallo: 'apagado'; imagen: string } | { fallo: 'sin_pod'; imagen: string };

// Encuentra el pod listo del deployment (lo usan la revisión y la cola de actualizaciones).
export async function localizarPod(p: PortalFila): Promise<UbicacionPod> {
  const { apps, core } = k8s();
  const dep = await apps.readNamespacedDeployment({ name: p.deployment, namespace: p.proyecto });
  const imagen = dep.spec?.template.spec?.containers.find((c) => c.name === p.contenedor)?.image ?? '';
  if ((dep.spec?.replicas ?? 0) === 0) return { fallo: 'apagado', imagen };
  const selector = Object.entries(dep.spec?.selector.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`).join(',');
  const pods = await core.listNamespacedPod({ namespace: p.proyecto, labelSelector: selector });
  const pod = pods.items.find((x) => x.status?.phase === 'Running' && !x.metadata?.deletionTimestamp && x.status.containerStatuses?.every((c) => c.ready));
  if (!pod?.metadata?.name) return { fallo: 'sin_pod', imagen };
  return { imagen, pod: pod.metadata.name, nodo: pod.spec?.nodeName ?? '' };
}

export async function recolectarPortal(p: PortalFila): Promise<Resultado> {
  if (![p.proyecto, p.deployment, p.contenedor].every((n) => NOMBRE_K8S.test(n))) return { estado: 'error', datos: {}, mensaje: 'Nombre de proyecto, deployment o contenedor inválido.' };
  try {
    const loc = await localizarPod(p);
    if (loc.fallo === 'apagado') return { estado: 'apagado', datos: { imagen: loc.imagen }, mensaje: 'El deployment está apagado (0 réplicas).' };
    if (loc.fallo === 'sin_pod') return { estado: 'error', datos: { imagen: loc.imagen }, mensaje: 'No hay ningún pod listo.' };
    const { imagen, pod } = loc;

    const ns = p.proyecto, nombre = pod, c = p.contenedor;
    const [wp, php, plugins, disco, dbHost, http] = await Promise.all([
      ejecutar(ns, nombre, c, 'wp_version'), ejecutar(ns, nombre, c, 'php_version'), ejecutar(ns, nombre, c, 'plugins'),
      ejecutar(ns, nombre, c, 'disco'), ejecutar(ns, nombre, c, 'db_host'), chequearHttp(p.url),
    ]);
    const listaPlugins = leerPlugins(plugins);
    const eumActivo = listaPlugins.some((x) => x.slug === SLUG_EUM && x.estado === 'activo');
    const eum = eumActivo ? await ejecutar(ns, nombre, c, 'eum_config').catch(() => null) : null;
    // Si alguna de estas dos consultas falla, el dato queda ausente (el panel dice "sin datos"), nunca inventado.
    const [nucleo, respaldo] = await Promise.all([
      ejecutar(ns, nombre, c, 'core_update').catch(() => null), ejecutar(ns, nombre, c, 'respaldo_fecha').catch(() => null),
    ]);
    const updraftActivo = listaPlugins.some((x) => esUpdraft(x) && x.estado === 'activo');
    const updEstado = updraftActivo ? await ejecutar(ns, nombre, c, 'updraft_estado').catch(() => null) : null;
    let disponible: string | undefined;
    try { disponible = nucleo === null ? undefined : leerNucleoDisponible(nucleo, wp.trim()); } catch { /* salida ilegible: queda sin dato */ }
    return {
      estado: 'ok',
      mensaje: http.estadoHttp === 0 ? 'No se pudo comprobar el sitio por HTTP.' : null,
      datos: {
        imagen, nodo: loc.nodo, php: php.trim(), wordpress: wp.trim(), plugins: listaPlugins, ...leerDisco(disco), ...http,
        dbHost: dbHost.trim(), autoActualizacion: leerAutoActualizacion(eumActivo, eum),
        respaldoUpdraft: leerRespaldoUpdraft(updraftActivo, updEstado),
        ...(disponible ? { wordpressDisponible: disponible } : {}), ultimoRespaldo: leerFechaRespaldo(respaldo),
      },
    };
  } catch (e) {
    const codigo = codigoHttp(e);
    if (codigo === 403 || codigo === 401) return { estado: 'sin_acceso', datos: {}, mensaje: 'La cuenta no tiene permiso en este proyecto.' };
    if (codigo === 404) return { estado: 'error', datos: {}, mensaje: 'No existe el deployment en ese proyecto.' };
    return { estado: 'error', datos: {}, mensaje: e instanceof Error ? e.message : String(e) };
  }
}

// --- Una sola revisión a la vez ---
let enCurso = false;
export const revisionEnCurso = () => enCurso;

// shortcut: la petición espera a que termine; con ~29 portales (varios minutos) pasar a segundo plano y consultar el avance.
export async function revisar(idPortal?: string, quien?: { userId?: number; username?: string; ip?: string }): Promise<number> {
  if (enCurso) throw new Error('Ya hay una revisión en curso.');
  enCurso = true;
  try {
    const portales = await query<PortalFila>(
      `SELECT id, nombre, proyecto, deployment, contenedor, url FROM portales WHERE activo AND ($1::text IS NULL OR id = $1) ORDER BY nombre`, [idPortal ?? null]);
    for (const p of portales) {
      const r = await recolectarPortal(p);
      await query(
        `INSERT INTO portal_estado (portal_id, estado, datos, mensaje, revisado_en) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (portal_id) DO UPDATE SET estado = $2, datos = $3, mensaje = $4, revisado_en = now()`,
        [p.id, r.estado, JSON.stringify(r.datos), r.mensaje]);
      await audit('revision', { ...quien, detail: { portal: p.id, estado: r.estado } });
    }
    return portales.length;
  } finally {
    enCurso = false;
  }
}
