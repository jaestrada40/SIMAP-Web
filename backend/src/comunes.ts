import { query } from './db.js';
import { chequearHttp, leerDisco, localizarPod, revisar, type PortalFila } from './collector.js';
import { ARCHIVO_RESPALDO, ejecutar, respaldarBase } from './k8s.js';

// Pasos que comparten la cola de plugins y la de núcleo/PHP. Los dos primeros y el último son idénticos en las dos.
export type ResultadoPaso = { ok: boolean; log: string[] };

export const UMBRAL_DISCO = Number(process.env.UMBRAL_DISCO ?? 90);
export const PHP_MINIMO = process.env.PHP_MINIMO ?? '8.3';
export const hora = () => new Date().toLocaleTimeString('es-GT');
export const etiquetar = (simulacion: boolean) => (m: string) => `${hora()} ${simulacion ? '[SIMULACIÓN] ' : ''}${m}`;

export async function cargarPortal(id: string): Promise<{ p: PortalFila; dbEsperado: string | null }> {
  const f = (await query<PortalFila & { db: string | null }>(
    `SELECT p.id, p.nombre, p.proyecto, p.deployment, p.contenedor, p.url, e.datos->>'dbHost' AS db
       FROM portales p LEFT JOIN portal_estado e ON e.portal_id = p.id WHERE p.activo AND p.id = $1`, [id]))[0];
  if (!f) throw new Error('El portal no existe o está dado de baja.');
  return { p: f, dbEsperado: f.db };
}

export async function ubicar(p: PortalFila): Promise<string> {
  const loc = await localizarPod(p);
  if (loc.fallo) throw new Error(loc.fallo === 'apagado' ? 'El deployment está apagado (0 réplicas).' : 'No hay ningún pod listo.');
  return loc.pod;
}

export async function verificarDiscoYBase(p: PortalFila, dbEsperado: string | null, l: (m: string) => string): Promise<ResultadoPaso> {
  const pod = await ubicar(p);
  const d = leerDisco(await ejecutar(p.proyecto, pod, p.contenedor, 'disco'));
  if (d.discoUsadoPct > UMBRAL_DISCO) return { ok: false, log: [l(`Disco al ${d.discoUsadoPct} %: supera el umbral de ${UMBRAL_DISCO} %. Actualización bloqueada.`)] };
  const db = (await ejecutar(p.proyecto, pod, p.contenedor, 'db_host')).trim();
  // La base que usa el portal debe ser la que se vio en la última revisión; si no, se podría respaldar/tocar la equivocada.
  if (!dbEsperado) return { ok: false, log: [l('No hay una revisión previa de este portal. Haga "Revisar" primero.')] };
  if (db !== dbEsperado) return { ok: false, log: [l(`DB_HOST es "${db}" pero en la última revisión era "${dbEsperado}". Detenido por seguridad.`)] };
  return { ok: true, log: [l(`Disco al ${d.discoUsadoPct} % de ${d.discoTotalGb} GB. Correcto.`), l(`Base de datos ${db}: coincide con la última revisión.`)] };
}

export async function respaldar(p: PortalFila, simulacion: boolean, l: (m: string) => string): Promise<ResultadoPaso> {
  if (simulacion) return { ok: true, log: [l(`Haría: wp db export ${ARCHIVO_RESPALDO}`)] };
  await respaldarBase(p.proyecto, await ubicar(p), p.contenedor);
  return { ok: true, log: [l(`Respaldo de la base guardado en ${ARCHIVO_RESPALDO} (dentro del volumen del portal).`)] };
}

export async function verificarSitio(p: PortalFila, simulacion: boolean, l: (m: string) => string): Promise<ResultadoPaso> {
  let h = await chequearHttp(p.url);
  // tras un reinicio el router tarda unos segundos en enviar tráfico al pod nuevo: reintenta hasta 60 s
  for (let i = 0; i < 12 && !simulacion && (h.estadoHttp < 200 || h.estadoHttp >= 400); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    h = await chequearHttp(p.url);
  }
  if (h.estadoHttp < 200 || h.estadoHttp >= 400) return { ok: false, log: [l(`GET ${p.url} → HTTP ${h.estadoHttp}. El sitio no responde bien.`)] };
  if (!simulacion) await revisar(p.id).catch(() => {}); // refresca el panel con lo nuevo; si hay otra revisión en curso, no importa
  return { ok: true, log: [l(`GET ${p.url} → HTTP ${h.estadoHttp} en ${h.tiempoRespuestaMs} ms.`)] };
}
