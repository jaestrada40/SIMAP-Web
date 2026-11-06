export type Rol = "administrador" | "operador" | "lector";

export type Semaforo = "al_dia" | "pendiente" | "error" | "caido";

export interface Plugin {
  slug: string;
  nombre: string;
  versionActual: string;
  versionNueva: string | null;
  estado: "activo" | "inactivo";
  excluido: boolean;
}

/** Qué hace el portal por su cuenta (plugin Easy Updates Manager). null = aún no se ha leído. */
export interface AutoActualizacion {
  plugin: boolean;
  /** Interruptor general de Easy Updates Manager "Desactivar todas las actualizaciones": manda sobre los otros tres. */
  todoDesactivado?: boolean;
  nucleo: string | null;
  plugins: string | null;
  temas: string | null;
}

/** Estado del respaldo de UpdraftPlus en el portal (solo lectura). `remoto`: guarda las copias fuera del portal. */
export interface RespaldoUpdraft {
  activo: boolean;
  ultimo: string;
  remoto: boolean;
  incluyeBase: boolean | null;
  incluyeArchivos: boolean | null;
}

export interface Portal {
  /** null/ausente = aún sin dato (haga una revisión). */
  respaldoUpdraft?: RespaldoUpdraft | null;
  autoActualizacion?: AutoActualizacion | null;
  id: string;
  nombre: string;
  proyecto: string;
  deployment: string;
  contenedor: string;
  url: string;
  php: string;
  wordpress: string;
  wordpressDisponible: string;
  plugins: Plugin[];
  estadoHttp: number;
  tiempoRespuestaMs: number;
  discoUsadoPct: number;
  discoTotalGb: number;
  ultimaRevision: string;
  imagenActual: string;
  imagenAnterior: string;
  /** La última actualización de núcleo migró la base de datos: volver a la imagen anterior puede no bastar. */
  baseActualizada?: boolean;
  nodo: string;
  ultimoRespaldo: string;
}

export type AccionAuditoria =
  | "inicio_sesion"
  | "revision"
  | "actualizacion_iniciada"
  | "actualizacion_completada"
  | "actualizacion_fallida"
  | "reintento"
  | "vuelta_atras"
  | "cambio_configuracion"
  | "cierre_sesion"
  | "cambio_logo"
  | "respaldo"
  | "cambio_usuario"
  | "cambio_clave"
  | "otro";

export interface RegistroAuditoria {
  id: string;
  fecha: string;
  usuario: string;
  portalId: string | null;
  accion: AccionAuditoria;
  resultado: "exito" | "fallo" | "info";
  detalle: string;
}

export interface Usuario {
  id: string;
  usuario: string;
  nombre: string;
  correo: string;
  rol: Rol;
  activo: boolean;
  mfa: boolean;
  ultimoAcceso: string | null;
}

export interface Configuracion {
  imagenObjetivo: string;
  etiquetaImagen: string;
  phpMinimo: string;
  umbralDisco: number;
  respaldoMaxDias: number;
  frecuenciaRevisionMin: number;
  pluginsExcluidos: string[];
  correosNotificacion: string[];
}

export interface Sesion {
  id: string;
  dispositivo: string;
  ip: string;
  inicio: string;
  actual: boolean;
}

export type TipoActualizacion = "nucleo_php" | "plugins";
export type EstadoPaso = "pendiente" | "en_curso" | "listo" | "error";
export const PASOS = ["Verificar disco", "Respaldo", "Aplicar", "Reinicio", "Verificación del sitio"] as const;
