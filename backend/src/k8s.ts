import { AppsV1Api, CoreV1Api, Exec, KubeConfig, PatchStrategy, setHeaderOptions, type V1Status } from '@kubernetes/client-node';
import { PassThrough } from 'node:stream';

// loadFromDefault: en tu máquina usa la sesión de `oc login`; dentro de OpenShift usa el token de la ServiceAccount.
let cliente: { apps: AppsV1Api; core: CoreV1Api; exec: Exec } | undefined;
export function k8s() {
  if (!cliente) {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    cliente = { apps: kc.makeApiClient(AppsV1Api), core: kc.makeApiClient(CoreV1Api), exec: new Exec(kc) };
  }
  return cliente;
}

const WP = '/opt/bitnami/wordpress';
const UPDRAFT_ESTADO_PHP = [
  '$u = get_option("updraft_last_backup"); $d = get_option("updraft_dir");',
  '$dir = ($d && $d[0] === "/") ? $d : WP_CONTENT_DIR . "/" . ($d ?: "updraft");',
  '$a = (is_array($u) && isset($u["backup_array"])) ? (array)$u["backup_array"] : [];',
  '$p = []; foreach (["db","plugins","themes","uploads","others"] as $k) { $v = isset($a[$k]) ? array_filter((array)$a[$k], "is_string") : []; $p[$k] = ["registrados" => count($v), "presentes" => count(array_filter($v, function ($n) use ($dir) { return $n !== "" && file_exists($dir . "/" . $n); }))]; }',
  'echo json_encode(["backup_time" => is_array($u) ? ($u["backup_time"] ?? 0) : 0, "success" => is_array($u) ? ($u["success"] ?? null) : null, "errores" => (is_array($u) && !empty($u["errors"])) ? count((array)$u["errors"]) : 0, "servicio" => get_option("updraft_service"), "piezas" => $p]);',
].join(' ');
// Único archivo de respaldo por portal: cada actualización lo sobrescribe (queda el de la última).
export const ARCHIVO_RESPALDO = '/bitnami/simap-respaldo.sql';

// Lista CERRADA de comandos que se pueden correr dentro de un pod. Nada viene de una entrada de usuario
// y no hay shell de por medio: cada comando es un arreglo de argumentos.
export const COMANDOS = {
  wp_version: ['wp', `--path=${WP}`, 'core', 'version'],
  php_version: ['/opt/bitnami/php/bin/php', '-r', 'echo PHP_VERSION;'],
  plugins: ['wp', `--path=${WP}`, 'plugin', 'list', '--fields=name,title,status,version,update,update_version', '--format=json'],
  disco: ['df', '-Pk', '/bitnami'],
  db_host: ['wp', `--path=${WP}`, 'config', 'get', 'DB_HOST'],
  eum_config: ['wp', `--path=${WP}`, 'option', 'get', 'MPSUM', '--format=json'], // ajustes de Easy Updates Manager (solo lectura)
  core_update: ['wp', `--path=${WP}`, 'core', 'check-update', '--fields=version,update_type', '--format=json'], // versión nueva del núcleo (solo lectura)
  db_simulacro: ['wp', `--path=${WP}`, 'core', 'update-db', '--dry-run'], // ¿necesita WordPress actualizar su base? (no modifica nada)
  db_actualizar: ['wp', `--path=${WP}`, 'core', 'update-db'], // lo mismo que hace el botón "Actualizar base de datos" de wp-admin
  respaldo_fecha: ['stat', '-c', '%Y', ARCHIVO_RESPALDO], // fecha del último respaldo (falla si no existe)
  // Estado de UpdraftPlus (solo lectura, PHP fijo y sin entradas externas): último respaldo, dónde guarda las copias y,
  // por pieza, cuántos archivos registrados existen DE VERDAD en disco (el registro puede sobrevivir a los archivos, p. ej. al clonar un portal).
  updraft_estado: ['wp', `--path=${WP}`, 'eval', UPDRAFT_ESTADO_PHP],
  // Copias de UpdraftPlus (solo lectura). Carpeta por defecto del plugin; texto fijo, sin entradas externas.
  updraft_listado: ['sh', '-c', 'cd /bitnami/wordpress/wp-content/updraft 2>/dev/null && stat -c "%s %Y %n" backup_* 2>/dev/null; true'],
  updraft_log: ['sh', '-c', 'f=$(ls -t /bitnami/wordpress/wp-content/updraft/log.*.txt 2>/dev/null | head -1); if [ -n "$f" ]; then echo "$f"; stat -c %Y "$f"; tail -n 6 "$f"; fi'],
  // Datos no secretos para la ficha de reconstrucción (solo lectura)
  prefijo_tablas: ['wp', `--path=${WP}`, 'config', 'get', 'table_prefix', '--type=variable'],
  db_nombre: ['wp', `--path=${WP}`, 'config', 'get', 'DB_NAME'],
  siteurl: ['wp', `--path=${WP}`, 'option', 'get', 'siteurl'],
  temas: ['wp', `--path=${WP}`, 'theme', 'list', '--fields=name,status,version', '--format=json'],
  wpcontent_mb: ['sh', '-c', 'du -sm --exclude=updraft /bitnami/wordpress/wp-content | cut -f1'], // lo que habría que copiar, para saber si cabe
} as const;
export type Comando = keyof typeof COMANDOS;
const SLUG_PLUGIN = /^[a-z0-9][a-z0-9_-]{0,99}$/;

async function correr(ns: string, pod: string, contenedor: string, argv: readonly string[], etiqueta: string, tiempoMaxMs: number): Promise<string> {
  const out = new PassThrough();
  const err = new PassThrough();
  let so = '', se = '';
  out.on('data', (d) => (so += d));
  err.on('data', (d) => (se += d));
  const nombre = etiqueta;

  const estado = await new Promise<V1Status>((resolve, reject) => {
    const reloj = setTimeout(() => reject(new Error(`Tiempo agotado ejecutando ${nombre}`)), tiempoMaxMs);
    k8s().exec
      .exec(ns, pod, contenedor, [...argv], out, err, null, false, (s) => { clearTimeout(reloj); resolve(s); })
      .then((ws) => ws.on('error', (e: Error) => { clearTimeout(reloj); reject(e); }))
      .catch((e) => { clearTimeout(reloj); reject(e); });
  });
  await new Promise((r) => setImmediate(r)); // deja que los streams entreguen lo último
  if (estado.status !== 'Success') throw new Error(`${nombre} falló: ${se.trim() || estado.message || 'sin detalle'}`);
  return so;
}

/**
 * Lee el archivo de respaldo del pod como bytes (el SQL puede tener caracteres multibyte: no se decodifica por trozos).
 * Se corta si supera maxBytes para no llenar la memoria del servidor.
 */
export async function leerArchivoRespaldo(ns: string, pod: string, contenedor: string, maxBytes: number): Promise<Buffer> {
  const out = new PassThrough();
  const err = new PassThrough();
  const trozos: Buffer[] = [];
  let total = 0, se = '';
  let abortar: ((m: string) => void) | undefined;
  out.on('data', (d: Buffer) => {
    total += d.length;
    if (total > maxBytes) abortar?.(`El respaldo supera el límite de descarga (${Math.round(maxBytes / 1024 / 1024)} MB). Use el respaldo de la plataforma.`);
    else trozos.push(d);
  });
  err.on('data', (d) => (se += d));
  const estado = await new Promise<V1Status>((resolve, reject) => {
    let ws: { close: () => void } | undefined;
    const reloj = setTimeout(() => abortar?.('Tiempo agotado leyendo el respaldo'), 180_000);
    abortar = (m) => { clearTimeout(reloj); try { ws?.close(); } catch { /* ya cerrado */ } reject(new Error(m)); };
    k8s().exec
      .exec(ns, pod, contenedor, ['cat', ARCHIVO_RESPALDO], out, err, null, false, (s) => { clearTimeout(reloj); resolve(s); })
      .then((w) => { ws = w; w.on('error', (e: Error) => abortar?.(e.message)); })
      .catch((e) => abortar?.(e instanceof Error ? e.message : String(e)));
  });
  await new Promise((r) => setImmediate(r));
  if (estado.status !== 'Success') throw new Error(`leer el respaldo falló: ${se.trim() || estado.message || 'sin detalle'}`);
  return Buffer.concat(trozos);
}

export const ejecutar = (ns: string, pod: string, contenedor: string, nombre: Comando) =>
  correr(ns, pod, contenedor, COMANDOS[nombre], nombre, 30_000);

// --- Comandos que ESCRIBEN en el portal (solo los usa la cola de actualizaciones) ---
export const respaldarBase = (ns: string, pod: string, contenedor: string) =>
  correr(ns, pod, contenedor, ['wp', `--path=${WP}`, 'db', 'export', ARCHIVO_RESPALDO], 'respaldo de la base', 300_000);

// Solo se aceptan imágenes fijadas por digest: no cambian de contenido y se puede comprobar que el pod realmente usa esa.
export const IMAGEN_CON_DIGEST = /^[a-z0-9][a-z0-9.\-/:]*@sha256:[0-9a-f]{64}$/;
const NOMBRE_K8S = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// Cambia la imagen de UN contenedor de UN deployment. Si el deployment tiene triggers de imagen de OpenShift,
// el trigger podría deshacer el cambio, así que en ese caso se rechaza en vez de arriesgar un resultado engañoso.
export async function cambiarImagen(ns: string, deployment: string, contenedor: string, imagen: string): Promise<void> {
  if (!IMAGEN_CON_DIGEST.test(imagen)) throw new Error('La imagen debe estar fijada por digest (@sha256:…).');
  if (![ns, deployment, contenedor].every((n) => NOMBRE_K8S.test(n))) throw new Error('Nombre de proyecto, deployment o contenedor inválido.');
  const dep = await k8s().apps.readNamespacedDeployment({ name: deployment, namespace: ns });
  if (dep.metadata?.annotations?.['image.openshift.io/triggers']) throw new Error('El deployment tiene triggers de imagen de OpenShift; hay que resolverlos a mano antes.');
  await k8s().apps.patchNamespacedDeployment(
    { name: deployment, namespace: ns, body: { spec: { template: { spec: { containers: [{ name: contenedor, image: imagen }] } } } } },
    setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch),
  );
}

export function actualizarPlugin(ns: string, pod: string, contenedor: string, slug: string) {
  if (!SLUG_PLUGIN.test(slug)) throw new Error(`Nombre de plugin inválido: ${slug}`); // viene del pod, pero nunca se pasa sin validar
  return correr(ns, pod, contenedor, ['wp', `--path=${WP}`, 'plugin', 'update', slug], `actualizar ${slug}`, 180_000);
}

// --- Copias de UpdraftPlus: lanzar en segundo plano y transmitir un archivo ---
export const NONCE_UPDRAFT = /^[0-9a-f]{12}$/;

/**
 * Lanza "hacer copia ahora" de UpdraftPlus DESPUÉS de desprenderse del exec (la copia puede tardar mucho más que cualquier exec).
 * Es lo mismo que hace el botón del plugin: do_action('updraft_backupnow_backup_all', opciones). El nonce (12 hex) se valida aquí
 * y otra vez dentro del PHP; nunca se arma un comando con texto de una persona.
 */
export function lanzarUpdraft(ns: string, pod: string, contenedor: string, nonce: string) {
  if (!NONCE_UPDRAFT.test(nonce)) throw new Error('Identificador de copia inválido.');
  const php = '$n = getenv("SIMAP_NONCE"); if (!preg_match("/^[0-9a-f]{12}$/", $n)) exit(1); do_action("updraft_backupnow_backup_all", apply_filters("updraft_backupnow_options", array("nocloud" => false, "use_nonce" => $n), array()));';
  const guion = `SIMAP_NONCE="$1" nohup wp --path=${WP} eval '${php}' </dev/null >/dev/null 2>&1 &`;
  return correr(ns, pod, contenedor, ['sh', '-c', guion, '_', nonce], 'lanzar copia de UpdraftPlus', 30_000);
}

/**
 * Envía un archivo del pod por flujo (no lo carga en memoria: puede pesar GB). La ruta la arma el servidor con un nombre ya validado.
 * Si falla a mitad, el flujo se destruye (el navegador ve una descarga incompleta, nunca un archivo "bueno" truncado).
 */
export function transmitirArchivo(ns: string, pod: string, contenedor: string, ruta: string): { flujo: PassThrough; cancelar: () => void } {
  const flujo = new PassThrough();
  const err = new PassThrough();
  let se = '';
  let socket: { close: () => void } | undefined;
  err.on('data', (d) => (se += d));
  const cancelar = () => { try { socket?.close(); } catch { /* ya cerrado */ } };
  k8s().exec
    .exec(ns, pod, contenedor, ['cat', ruta], flujo, err, null, false, (s) => {
      if (s.status === 'Success') flujo.end();
      else flujo.destroy(new Error(se.trim() || s.message || 'La transmisión falló'));
    })
    .then((ws) => { socket = ws; ws.on('error', (e: Error) => flujo.destroy(e)); })
    .catch((e) => flujo.destroy(e instanceof Error ? e : new Error(String(e))));
  return { flujo, cancelar };
}
