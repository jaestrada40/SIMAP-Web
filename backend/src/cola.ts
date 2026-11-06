import { audit } from './auth.js';
import { EXCLUIDOS, leerPlugins } from './collector.js';
import { cargarPortal, etiquetar, respaldar, type ResultadoPaso, ubicar, verificarDiscoYBase, verificarSitio } from './comunes.js';
import { actualizarPlugin, ejecutar } from './k8s.js';
import { pasoNucleo, revertirImagen } from './nucleo.js';

export type { ResultadoPaso };

// Misma forma que la cola del frontend (src/components/queue-context.tsx) para no rehacer la pantalla.
export type EstadoPaso = 'pendiente' | 'en_curso' | 'listo' | 'error';
export type EstadoItem = 'espera' | 'en_curso' | 'listo' | 'error' | 'saltado' | 'detenido';
export type Tipo = 'plugins' | 'nucleo_php';
export type Item = { portalId: string; pasos: EstadoPaso[]; log: string[]; estado: EstadoItem };
export type Cola = {
  tipo: Tipo; simulacion: boolean; items: Item[]; indice: number;
  estado: 'en_curso' | 'detenida_error' | 'finalizada' | 'detenida_usuario';
};
export type Quien = { userId?: number; username?: string; ip?: string };
export type EjecutarPaso = (portalId: string, paso: number, simulacion: boolean) => Promise<ResultadoPaso>;

export const PASOS = ['Verificar disco', 'Respaldo', 'Aplicar', 'Reinicio', 'Verificación del sitio'] as const;

// --- Los 5 pasos de plugins. En simulación solo se omiten las escrituras (respaldo y actualización). ---
// shortcut: exclusiones por variable de entorno (slugs separados por coma); pasar a Configuración cuando exista en el backend.

export const pasoPlugins: EjecutarPaso = async (portalId, paso, simulacion) => {
  const l = etiquetar(simulacion);
  try {
    const { p, dbEsperado } = await cargarPortal(portalId);
    switch (paso) {
      case 0: return await verificarDiscoYBase(p, dbEsperado, l);
      case 1: return await respaldar(p, simulacion, l);
      case 2: {
        const pod = await ubicar(p);
        const pendientes = leerPlugins(await ejecutar(p.proyecto, pod, p.contenedor, 'plugins')).filter((x) => x.versionNueva && !EXCLUIDOS.has(x.slug));
        if (pendientes.length === 0) return { ok: true, log: [l('No hay plugins pendientes (o están excluidos).')] };
        const log: string[] = [];
        for (const x of pendientes) {
          if (simulacion) { log.push(l(`Haría: wp plugin update ${x.slug} (${x.versionActual} → ${x.versionNueva})`)); continue; }
          const salida = await actualizarPlugin(p.proyecto, pod, p.contenedor, x.slug); // si falla, lanza y el paso termina en error
          log.push(l(`${x.slug}: ${x.versionActual} → ${x.versionNueva}`), ...salida.trim().split('\n').slice(-3).map((s) => `    ${s}`));
        }
        if (!simulacion) log.push(l('Aviso: algunos plugins piden actualizar su propia base de datos (aparece un aviso con un botón en wp-admin). El sistema no puede verlo ni hacerlo: revise el panel de WordPress de este portal.'));
        return { ok: true, log };
      }
      case 3: return { ok: true, log: [l('No aplica: actualizar plugins no reinicia el pod.')] };
      default: return await verificarSitio(p, simulacion, l);
    }
  } catch (e) {
    return { ok: false, log: [l(`ERROR: ${e instanceof Error ? e.message : String(e)}`)] };
  }
};

// --- Máquina de estados de la cola: de uno en uno, se detiene al primer fallo. Una sola cola a la vez, en memoria. ---
// shortcut: la cola vive en memoria; si el backend se reinicia a mitad, se pierde (el respaldo y el portal quedan como estaban).
let cola: Cola | null = null;
let quien: Quien = {};
let pedirDetener = false;
let sustituto: EjecutarPaso | undefined;

export const usarPasos = (f: EjecutarPaso | undefined) => { sustituto = f; }; // solo para pruebas
const pasoDe = (t: Tipo): EjecutarPaso => sustituto ?? (t === 'plugins' ? pasoPlugins : pasoNucleo);
export const estadoCola = () => cola;
export const colaActiva = () => cola?.estado === 'en_curso' || cola?.estado === 'detenida_error';

const evento = (accion: string, portalId: string, detalle: object = {}) => audit(accion, { ...quien, detail: { portal: portalId, ...detalle } }).catch(() => {});
const detenerResto = (c: Cola) => c.items.forEach((it) => { if (it.estado === 'espera') it.estado = 'detenido'; });

async function procesar(desdePaso: number) {
  let primero = true;
  while (cola && cola.indice < cola.items.length) {
    const c = cola;
    if (pedirDetener) {
      c.estado = 'detenida_usuario';
      detenerResto(c);
      return;
    }
    const item = c.items[c.indice]!;
    const inicio = primero ? desdePaso : 0;
    primero = false;
    item.estado = 'en_curso';
    if (inicio === 0) await evento('actualizacion_iniciada', item.portalId, { tipo: c.tipo, simulacion: c.simulacion });
    for (let p = inicio; p < PASOS.length; p++) {
      item.pasos[p] = 'en_curso';
      item.log.push(`── ${PASOS[p]} ──`);
      const r = await pasoDe(c.tipo)(item.portalId, p, c.simulacion).catch((e): ResultadoPaso => ({ ok: false, log: [`ERROR: ${e instanceof Error ? e.message : String(e)}`] }));
      item.log.push(...r.log);
      item.pasos[p] = r.ok ? 'listo' : 'error';
      if (!r.ok) {
        item.estado = 'error';
        c.estado = 'detenida_error';
        await evento('actualizacion_fallida', item.portalId, { tipo: c.tipo, paso: PASOS[p], detalle: r.log.at(-1) });
        return;
      }
    }
    item.estado = 'listo';
    c.indice++;
    await evento('actualizacion_completada', item.portalId, { tipo: c.tipo, simulacion: c.simulacion });
  }
  if (cola) cola.estado = 'finalizada';
}

export function iniciarCola(tipo: Tipo, ids: string[], simulacion: boolean, q: Quien): Cola {
  if (colaActiva()) throw new Error('Ya hay una cola en curso.');
  quien = q;
  pedirDetener = false;
  cola = {
    tipo, simulacion, indice: 0, estado: 'en_curso',
    items: ids.map((portalId) => ({ portalId, pasos: PASOS.map(() => 'pendiente' as EstadoPaso), log: [], estado: 'espera' as EstadoItem })),
  };
  void procesar(0);
  return cola;
}

export type Accion = 'reintentar' | 'saltar' | 'volver' | 'detener' | 'limpiar';

export function accionCola(a: Accion, q: Quien, revertir: typeof revertirImagen = revertirImagen): Cola | null {
  const c = cola;
  if (!c) throw new Error('No hay ninguna cola.');
  quien = q;
  if (a === 'limpiar') {
    if (colaActiva()) throw new Error('La cola sigue activa: deténgala primero.');
    cola = null;
    return null;
  }
  if (a === 'detener') {
    if (c.estado === 'detenida_error') {
      c.estado = 'detenida_usuario';
      detenerResto(c);
    } else if (c.estado === 'en_curso') pedirDetener = true; // termina el portal actual y no empieza el siguiente
    else throw new Error('La cola ya terminó.');
    return c;
  }
  if (c.estado !== 'detenida_error') throw new Error('La cola no está detenida por un error.');
  const item = c.items[c.indice]!;
  if (a === 'volver') {
    if (c.tipo !== 'nucleo_php') throw new Error('Para plugins no hay vuelta atrás automática; el respaldo de la base está en el volumen del portal.');
    if (c.simulacion) throw new Error('En simulación no se cambió nada: no hay nada que revertir.');
    c.estado = 'en_curso'; // mientras revierte no se puede pulsar otra cosa
    item.log.push('⟲ Volviendo a la imagen anterior…');
    void revertir(item.portalId, q).then((r) => {
      item.log.push(...r.log);
      if (r.ok) {
        // Tras revertir un portal se detiene toda la cola: si falló por la imagen, el siguiente portal fallaría igual.
        item.estado = 'saltado';
        item.log.push('⟲ Portal revertido. La cola se detuvo para no repetir el problema en los demás.');
        c.estado = 'detenida_usuario';
        detenerResto(c);
      } else c.estado = 'detenida_error'; // no se pudo revertir: sigue esperando una decisión
    });
    return c;
  }
  if (a === 'reintentar') {
    const desde = Math.max(0, item.pasos.findIndex((p) => p === 'error'));
    void evento('reintento', item.portalId, { desdePaso: PASOS[desde] });
    item.log.push('↻ Reintentando…');
    c.estado = 'en_curso';
    void procesar(desde);
  } else {
    item.estado = 'saltado';
    item.log.push('⏭ Portal saltado por el usuario.');
    c.indice++;
    c.estado = 'en_curso';
    void procesar(0);
  }
  return c;
}
