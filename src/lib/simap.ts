import type { Portal, Rol, Semaforo } from "@/types";

export function compararVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function pluginsPendientes(p: Portal) {
  return p.plugins.filter((x) => x.versionNueva).length;
}

/** El núcleo tiene versión nueva solo si el servidor pudo consultarla (vacío = sin dato). */
export const nucleoPendiente = (p: Portal) => !!p.wordpressDisponible && compararVersion(p.wordpress, p.wordpressDisponible) < 0;

export function semaforo(p: Portal, phpMinimo = "8.3", umbral = 90): Semaforo {
  if (p.estadoHttp >= 500 || p.estadoHttp === 0) return "caido";
  if (compararVersion(p.php, phpMinimo) < 0 || p.discoUsadoPct > umbral) return "error";
  if (pluginsPendientes(p) > 0 || nucleoPendiente(p)) return "pendiente";
  return "al_dia";
}

export type NivelRespaldo = "ok" | "local" | "viejo" | "sin" | "desconocido";

/**
 * Qué tan protegido está el portal:
 *  ok = UpdraftPlus guarda fuera del portal y la copia es reciente · local = solo hay copias dentro del mismo volumen
 *  viejo = hay copia externa pero antigua · sin = ninguna · desconocido = aún no se ha revisado.
 */
export function estadoRespaldo(p: Portal, maxDias = 10): { nivel: NivelRespaldo; texto: string; detalle: string } {
  const u = p.respaldoUpdraft;
  if (!u) return { nivel: "desconocido", texto: "Sin dato", detalle: "Haga una revisión para leer el estado del respaldo." };
  const propio = p.ultimoRespaldo ? "Hay un respaldo de la base hecho por SIMAP-Web, pero dentro del mismo volumen del portal." : "";
  if (!u.activo || !u.ultimo) {
    return p.ultimoRespaldo
      ? { nivel: "local", texto: "Solo en el portal", detalle: `${u.activo ? "UpdraftPlus no tiene ningún respaldo disponible (sin archivos en el portal o con error)." : "UpdraftPlus no está activo."} ${propio}` }
      : { nivel: "sin", texto: "Sin respaldo", detalle: u.activo ? "UpdraftPlus no tiene un respaldo exitoso registrado." : "UpdraftPlus no está activo y no hay respaldo hecho por SIMAP-Web." };
  }
  const dias = Math.max(0, Math.floor((Date.now() - new Date(u.ultimo).getTime()) / 86_400_000));
  if (!u.remoto) return { nivel: "local", texto: "Solo en el portal", detalle: `UpdraftPlus guarda las copias dentro del mismo volumen del portal (última hace ${dias} d): si el volumen falla, se pierden con el sitio.` };
  return dias <= maxDias
    ? { nivel: "ok", texto: `Externo, hace ${dias} d`, detalle: "UpdraftPlus guarda las copias fuera del portal y la última es reciente." }
    : { nivel: "viejo", texto: `Antiguo: ${dias} d`, detalle: `La última copia externa tiene ${dias} días (máximo aceptable: ${maxDias}).` };
}

export const CLASE_RESPALDO: Record<NivelRespaldo, string> = { ok: "status-ok", local: "status-warn", viejo: "status-warn", sin: "status-error", desconocido: "status-neutral" };

const MODO_EUM: Record<string, string> = { automatic: "automática", on: "manual", off: "desactivada" };
const modoEum = (m: string | null) => (m ? (MODO_EUM[m] ?? m) : "—");

/** Resumen corto para el panel: "Sí" si el portal se actualiza solo (núcleo, plugins o temas en automático). */
export function autoActualizacionCorto(p: Portal): "si" | "no" | "desconocido" {
  const a = p.autoActualizacion;
  if (!a) return "desconocido";
  if (a.todoDesactivado) return "no";
  return a.plugin && [a.nucleo, a.plugins, a.temas].includes("automatic") ? "si" : "no";
}

export function autoActualizacionTexto(p: Portal): string {
  const a = p.autoActualizacion;
  if (!a) return "Sin datos (haga una revisión)";
  if (!a.plugin) return "Easy Updates Manager no está activo (solo el núcleo menor, que WordPress actualiza por defecto)";
  if (a.todoDesactivado) return "Todas las actualizaciones desactivadas (interruptor general de Easy Updates Manager)";
  return `Núcleo: ${modoEum(a.nucleo)} · Plugins: ${modoEum(a.plugins)} · Temas: ${modoEum(a.temas)}`;
}

export const fechaHora = (iso: string) =>
  iso ? new Date(iso).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "—";

export const digestCorto = (d: string) => `${d.slice(0, 19)}…`;

export const puede = {
  actualizar: (r?: Rol) => r === "administrador" || r === "operador",
  administrar: (r?: Rol) => r === "administrador",
};

export const ROL_TEXTO: Record<Rol, string> = {
  administrador: "Administrador",
  operador: "Operador",
  lector: "Lector",
};
