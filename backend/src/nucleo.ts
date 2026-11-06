import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import { audit } from './auth.js';
import { query } from './db.js';
import type { PortalFila } from './collector.js';
import { ARCHIVO_RESPALDO, cambiarImagen, ejecutar, IMAGEN_CON_DIGEST, k8s } from './k8s.js';
import { cargarPortal, etiquetar, respaldar, type ResultadoPaso, ubicar, verificarDiscoYBase, verificarSitio } from './comunes.js';

// La imagen objetivo la fija el servidor (nunca el navegador): cambiar la imagen de un deployment es la acción más delicada.
export const imagenObjetivo = (): string | null => {
  const i = process.env.IMAGEN_OBJETIVO ?? '';
  return IMAGEN_CON_DIGEST.test(i) ? i : null;
};

const ESPERA_ROLLOUT_MS = Number(process.env.ROLLOUT_MAX_S ?? 300) * 1000;
const CADA_MS = 5_000;

// Mismo criterio que `oc rollout status`, más: el deployment pide justo esta imagen y NINGÚN pod vivo usa otra.
// Así se detecta el caso "el trigger no aplicó el cambio" y el de pods viejos que siguen corriendo.
export function rolloutCompleto(dep: V1Deployment, pods: V1Pod[], contenedor: string, imagen: string): boolean {
  const quiere = dep.spec?.replicas ?? 0;
  const s = dep.status;
  const imagenSpec = dep.spec?.template.spec?.containers.find((c) => c.name === contenedor)?.image;
  const vivos = pods.filter((x) => !x.metadata?.deletionTimestamp);
  return (
    imagenSpec === imagen &&
    (s?.observedGeneration ?? 0) >= (dep.metadata?.generation ?? 0) &&
    (s?.updatedReplicas ?? 0) === quiere && (s?.availableReplicas ?? 0) === quiere && (s?.replicas ?? 0) === quiere &&
    vivos.length === quiere &&
    vivos.every((x) => x.spec?.containers.find((c) => c.name === contenedor)?.image === imagen && x.status?.phase === 'Running' && !!x.status.containerStatuses?.every((c) => c.ready))
  );
}

async function leerDespliegue(p: PortalFila) {
  const { apps, core } = k8s();
  const dep = await apps.readNamespacedDeployment({ name: p.deployment, namespace: p.proyecto });
  const selector = Object.entries(dep.spec?.selector.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`).join(',');
  const pods = (await core.listNamespacedPod({ namespace: p.proyecto, labelSelector: selector })).items;
  return { dep, pods };
}

// Salida de `wp core update-db --dry-run`: si no dice que ya está al día, WordPress necesita migrar la base.
export const baseAlDia = (salida: string) => /already at (the )?latest db version/i.test(salida);

const imagenDeSpec = (dep: V1Deployment, contenedor: string) => dep.spec?.template.spec?.containers.find((c) => c.name === contenedor)?.image ?? '';

async function esperarRollout(p: PortalFila, imagen: string, maxMs = ESPERA_ROLLOUT_MS, cadaMs = CADA_MS): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const { dep, pods } = await leerDespliegue(p);
    if (rolloutCompleto(dep, pods, p.contenedor, imagen)) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > maxMs) throw new Error(`El reinicio no terminó en ${Math.round(maxMs / 1000)} s. El portal puede estar caído: use "Volver atrás".`);
    await new Promise((r) => setTimeout(r, cadaMs));
  }
}

export async function pasoNucleo(portalId: string, paso: number, simulacion: boolean): Promise<ResultadoPaso> {
  const l = etiquetar(simulacion);
  try {
    const { p, dbEsperado } = await cargarPortal(portalId);
    switch (paso) {
      case 0: {
        const objetivo = imagenObjetivo();
        if (!objetivo) return { ok: false, log: [l('IMAGEN_OBJETIVO no está configurada en el servidor (debe terminar en @sha256:…).')] };
        const r = await verificarDiscoYBase(p, dbEsperado, l);
        if (r.ok) r.log.push(l(`Imagen objetivo: ${objetivo}`));
        return r;
      }
      case 1:
        return respaldar(p, simulacion, l);
      case 2: {
        const objetivo = imagenObjetivo();
        if (!objetivo) return { ok: false, log: [l('IMAGEN_OBJETIVO no está configurada en el servidor.')] };
        const actual = imagenDeSpec((await leerDespliegue(p)).dep, p.contenedor);
        if (actual === objetivo) return { ok: true, log: [l('El deployment ya usa la imagen objetivo; no hay nada que cambiar.')] };
        if (simulacion) return { ok: true, log: [l(`Haría: cambiar la imagen ${actual || '(ninguna)'} → ${objetivo}`)] };
        // Se guarda la anterior ANTES de cambiar: sin ella no hay vuelta atrás.
        await query(
          `INSERT INTO imagen_previa (portal_id, imagen) VALUES ($1, $2)
           ON CONFLICT (portal_id) DO UPDATE SET imagen = $2, guardada_en = now(), base_actualizada = false`, [p.id, actual]);
        await cambiarImagen(p.proyecto, p.deployment, p.contenedor, objetivo);
        return { ok: true, log: [l(`Imagen anterior guardada: ${actual}`), l(`Imagen cambiada a: ${objetivo}`)] };
      }
      case 3: {
        if (simulacion) return { ok: true, log: [l('No se espera el reinicio: no se cambió nada.'), l('Haría: wp core update-db solo si WordPress lo necesita.')] };
        const objetivo = imagenObjetivo();
        if (!objetivo) return { ok: false, log: [l('IMAGEN_OBJETIVO no está configurada en el servidor.')] };
        const s = await esperarRollout(p, objetivo);
        const log = [l(`Reinicio completo en ${s} s: el pod nuevo está listo y usa la imagen objetivo.`)];
        // WordPress no migra su base al cambiar la imagen (sí lo hace al actualizar desde wp-admin): se hace aquí si hace falta.
        const pod = await ubicar(p);
        if (baseAlDia(await ejecutar(p.proyecto, pod, p.contenedor, 'db_simulacro'))) {
          log.push(l('Base de datos: WordPress no necesita actualizarla.'));
        } else {
          const salida = await ejecutar(p.proyecto, pod, p.contenedor, 'db_actualizar');
          await query('UPDATE imagen_previa SET base_actualizada = true WHERE portal_id = $1', [p.id]);
          log.push(l('Base de datos actualizada por WordPress (wp core update-db):'), ...salida.trim().split('\n').slice(-3).map((x) => `    ${x}`));
        }
        return { ok: true, log };
      }
      default:
        return verificarSitio(p, simulacion, l);
    }
  } catch (e) {
    return { ok: false, log: [l(`ERROR: ${e instanceof Error ? e.message : String(e)}`)] };
  }
}

// "Volver atrás": restaura la imagen anterior guardada. NO restaura la base de datos (para un cambio de núcleo menor no hace falta;
// el respaldo queda en el volumen por si una migración lo exigiera).
export async function revertirImagen(portalId: string, quien: { userId?: number; username?: string; ip?: string }): Promise<ResultadoPaso> {
  const l = etiquetar(false);
  try {
    const { p } = await cargarPortal(portalId);
    const fila = (await query<{ imagen: string; base_actualizada: boolean }>('SELECT imagen, base_actualizada FROM imagen_previa WHERE portal_id = $1', [p.id]))[0];
    const previa = fila?.imagen;
    if (!previa) return { ok: false, log: [l('No hay una imagen anterior guardada para este portal.')] };
    const actual = imagenDeSpec((await leerDespliegue(p)).dep, p.contenedor);
    const log: string[] = [];
    if (fila?.base_actualizada) log.push(l(`ATENCIÓN: en esa actualización WordPress migró la base de datos. Si el sitio no funciona con la imagen anterior, restaure el respaldo: wp db import ${ARCHIVO_RESPALDO}`));
    if (actual === previa) log.push(l('El deployment ya usa la imagen anterior.'));
    else {
      await cambiarImagen(p.proyecto, p.deployment, p.contenedor, previa);
      log.push(l(`Imagen restaurada a: ${previa}`));
    }
    log.push(l(`Reinicio completo en ${await esperarRollout(p, previa)} s.`));
    const sitio = await verificarSitio(p, false, l);
    await audit('vuelta_atras', { ...quien, detail: { portal: p.id, desde: actual, hacia: previa, sitio_ok: sitio.ok } }).catch(() => {});
    return { ok: sitio.ok, log: [...log, ...sitio.log] };
  } catch (e) {
    return { ok: false, log: [l(`ERROR: ${e instanceof Error ? e.message : String(e)}`)] };
  }
}
