/**
 * Capa única de acceso a datos de SIMAP-Web: todo habla con la API real del servidor (backend/).
 */
import type { Configuracion, EstadoPaso, Portal, RegistroAuditoria, Rol, TipoActualizacion, Usuario } from "@/types";

// ---------- Autenticación (API real: backend/) ----------
export interface UsuarioSesion {
  usuario: string;
  nombre: string;
  rol: Rol;
  /** Tiene una clave temporal: solo puede cambiarla (el servidor lo exige). */
  debeCambiar: boolean;
  /** Cuándo vence la sesión (ms desde 1970): el tope de 8 h y la inactividad. Solo en memoria; el servidor es quien decide. */
  vence?: VenceSesion;
}
/** Plazos que da el servidor, en segundos que quedan. */
export interface VentanasSesion { absolutaS: number; inactividadS: number }
export interface VenceSesion { absolutoEn: number; inactividadEn: number }
const aVence = (v?: VentanasSesion): VenceSesion | undefined => (v ? { absolutoEn: Date.now() + v.absolutaS * 1000, inactividadEn: Date.now() + v.inactividadS * 1000 } : undefined);

export const EVENTO_SESION_VENCIDA = "simap:sesion-vencida";
const SIN_AVISO_401 = ["/api/login", "/api/mfa/", "/api/me", "/api/logout"];

async function llamar<T>(url: string, cuerpo?: object, metodo = "POST"): Promise<{ estado: number; datos: T & { error?: string } }> {
  const r = await fetch(
    url,
    cuerpo
      ? { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo), credentials: "same-origin" }
      : { credentials: "same-origin" },
  );
  // 401 en una pantalla ya abierta = la sesión venció (duran 8 horas): se avisa para volver al login en vez de seguir consultando.
  // Quedan fuera las llamadas que usan el 401 como respuesta normal (clave o código incorrectos, comprobar si hay sesión).
  if (r.status === 401 && !SIN_AVISO_401.some((p) => url.startsWith(p)) && typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
  return { estado: r.status, datos: await r.json().catch(() => ({})) };
}

// Copia solo para mostrar el nombre y auditar los datos de ejemplo; el acceso real lo decide la cookie del servidor.
function recordarUsuario(username: string, rol: Rol, debeCambiar: boolean, sesion?: VentanasSesion): UsuarioSesion {
  const s: UsuarioSesion = { usuario: username, nombre: username, rol, debeCambiar };
  localStorage.setItem("simap.sesion", JSON.stringify(s));
  const vence = aVence(sesion);
  return vence ? { ...s, vence } : s;
}

/** Latido: avisa al servidor que la persona sigue ahí (reinicia la inactividad; el tope de 8 h no se mueve). null si ya no hay sesión. */
export async function latido(): Promise<VenceSesion | null> {
  const { estado, datos } = await llamar<{ sesion: VentanasSesion }>("/api/sesion/latido", {});
  return estado === 200 ? (aVence(datos.sesion) ?? null) : null;
}

export async function iniciarSesion(usuario: string, clave: string): Promise<{ ok: true } | { ok: false; error: string; bloqueado?: boolean }> {
  const { estado, datos } = await llamar<{ step: "mfa" | "enroll" }>("/api/login", { username: usuario, password: clave });
  if (estado === 200) {
    sessionStorage.setItem("simap.pasoMfa", datos.step); // solo orienta a la pantalla; el servidor decide
    return { ok: true };
  }
  return { ok: false, bloqueado: estado === 429, error: datos.error ?? "No se pudo iniciar sesión." };
}

export function pasoMfa(): "mfa" | "enroll" | null {
  return sessionStorage.getItem("simap.pasoMfa") as "mfa" | "enroll" | null;
}

export async function iniciarAltaMfa(): Promise<{ uri: string; secret: string } | null> {
  const { estado, datos } = await llamar<{ uri: string; secret: string }>("/api/mfa/enroll", {});
  return estado === 200 ? datos : null;
}

export async function verificarMfa(codigo: string): Promise<UsuarioSesion | null> {
  const { estado, datos } = await llamar<{ user: { username: string; role: Rol; debeCambiar: boolean }; sesion: VentanasSesion }>("/api/mfa/verify", { code: codigo });
  if (estado !== 200) return null;
  sessionStorage.removeItem("simap.pasoMfa");
  return recordarUsuario(datos.user.username, datos.user.role, datos.user.debeCambiar, datos.sesion);
}

export async function obtenerSesion(): Promise<UsuarioSesion | null> {
  const { estado, datos } = await llamar<{ username: string; role: Rol; debeCambiar: boolean; sesion: VentanasSesion }>("/api/me");
  if (estado !== 200) {
    localStorage.removeItem("simap.sesion");
    return null;
  }
  return recordarUsuario(datos.username, datos.role, datos.debeCambiar, datos.sesion);
}

export async function cerrarSesion() {
  await llamar("/api/logout", {}).catch(() => {});
  localStorage.removeItem("simap.sesion");
  sessionStorage.removeItem("simap.pasoMfa");
}

// ---------- Portales ----------
export async function listarPortales(): Promise<Portal[]> {
  const { estado, datos } = await llamar<Portal[]>("/api/portales");
  if (estado !== 200) throw new Error("No se pudo leer la lista de portales");
  return datos;
}

export async function obtenerPortal(id: string): Promise<Portal | null> {
  const { estado, datos } = await llamar<Portal>(`/api/portales/${encodeURIComponent(id)}`);
  if (estado === 404) return null;
  if (estado !== 200) throw new Error("No se pudo leer el portal");
  return datos;
}

export async function obtenerUltimaRevision(): Promise<string> {
  const { datos } = await llamar<{ ultima: string | null }>("/api/revision");
  return datos.ultima ?? "";
}

// Solo lectura en los portales: el backend consulta cada pod y guarda el resultado.
export async function revisarAhora(portalId?: string): Promise<void> {
  const { estado, datos } = await llamar<object>("/api/portales/revisar", portalId ? { id: portalId } : {});
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo completar la revisión");
}

export interface DatosPortal {
  nombre: string;
  proyecto: string;
  deployment: string;
  contenedor: string;
  url: string;
}
/** Resultado de la primera revisión de solo lectura que el servidor hace al guardar (para avisar enseguida si no hay permiso). */
export interface ResultadoPortal {
  id: string;
  estado: string;
  mensaje: string | null;
}

export const crearPortal = (p: DatosPortal) => accionServidor<ResultadoPortal>("/api/portales", p, "POST", "No se pudo agregar el portal");

export const editarPortal = (id: string, p: DatosPortal) =>
  accionServidor<ResultadoPortal>(`/api/portales/${encodeURIComponent(id)}`, p, "PATCH", "No se pudo guardar el portal");

/** Baja: deja de monitorearse, pero no se borra (queda su historial y se puede volver a agregar). Pide el identificador exacto. */
export const darDeBajaPortal = (id: string, confirmacion: string) =>
  accionServidor<object>(`/api/portales/${encodeURIComponent(id)}/baja`, { confirmacion }, "POST", "No se pudo dar de baja el portal");

/** Respaldo de la base a pedido; sobrescribe el .sql anterior del portal. */
export async function respaldarAhora(portalId: string): Promise<void> {
  const { estado, datos } = await llamar<object>(`/api/portales/${encodeURIComponent(portalId)}/respaldo`, {});
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo hacer el respaldo");
}

/** Ficha de reconstrucción del portal (Markdown, sin contraseñas ni wp-config). */
export async function descargarFicha(portalId: string): Promise<void> {
  const r = await fetch(`/api/portales/${encodeURIComponent(portalId)}/ficha-reconstruccion`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo generar la ficha");
  const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `ficha-${portalId}.md`;
  const url = URL.createObjectURL(await r.blob());
  const e = document.createElement("a");
  e.href = url;
  e.download = nombre;
  e.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Copias completas de UpdraftPlus (API real) ----------
export interface PiezaCopia { nombre: string; tipo: string; bytes: number; modificado: string }
export interface CopiaUpdraft { nonce: string; fecha: string; hora: string; piezas: PiezaCopia[]; bytes: number; completa: boolean }
export type EstadoCopia = "sin_actividad" | "iniciando" | "en_curso" | "terminada" | "detenida";
export interface AvanceCopia { estado: EstadoCopia; nonce: string | null; ultimaLinea: string; hace: number | null }

export async function listarCopiasUpdraft(portalId: string): Promise<{ copias: CopiaUpdraft[]; avance: AvanceCopia }> {
  const { estado, datos } = await llamar<{ copias: CopiaUpdraft[]; avance: AvanceCopia }>(`/api/portales/${encodeURIComponent(portalId)}/updraft`);
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo leer las copias de UpdraftPlus");
  return datos;
}

/** Lanza la copia completa en segundo plano (el servidor comprueba antes que haya espacio). */
export async function lanzarCopiaUpdraft(portalId: string): Promise<void> {
  const { estado, datos } = await llamar<object>(`/api/portales/${encodeURIComponent(portalId)}/updraft/lanzar`, {});
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo lanzar la copia");
}

/** Pide la contraseña y devuelve un enlace de UN solo uso (1 minuto) para bajar un archivo; el navegador lo descarga directo. */
export async function descargarPiezaUpdraft(portalId: string, nombre: string, password: string): Promise<void> {
  const { estado, datos } = await llamar<{ url: string }>(`/api/portales/${encodeURIComponent(portalId)}/updraft/descarga`, { nombre, password });
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo preparar la descarga");
  window.location.assign(datos.url);
}

/** Hace un respaldo nuevo de la base y lo descarga comprimido (.sql.gz). Pide la contraseña otra vez; solo administrador. */
export async function descargarRespaldo(portalId: string, password: string): Promise<void> {
  const r = await fetch(`/api/portales/${encodeURIComponent(portalId)}/respaldo/descargar`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), credentials: "same-origin",
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo descargar el respaldo");
  const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `respaldo-${portalId}.sql.gz`;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Real: el servidor restaura la imagen guardada, espera el reinicio y comprueba el sitio (puede tardar minutos).
export async function volverImagenAnterior(portalId: string, confirmacion: string): Promise<void> {
  const { estado, datos } = await llamar<object>(`/api/portales/${encodeURIComponent(portalId)}/volver`, { confirmacion });
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo volver a la imagen anterior");
}

// ---------- Cola de actualización (API real: la cola vive en el servidor) ----------
export type EstadoItem = "espera" | "en_curso" | "listo" | "error" | "saltado" | "detenido";
export interface ItemCola {
  portalId: string;
  pasos: EstadoPaso[];
  log: string[];
  estado: EstadoItem;
}
export interface Cola {
  tipo: TipoActualizacion;
  simulacion: boolean;
  items: ItemCola[];
  indice: number;
  estado: "en_curso" | "detenida_error" | "finalizada" | "detenida_usuario";
}
export type AccionCola = "reintentar" | "saltar" | "volver" | "detener" | "limpiar";

async function respuestaCola(estado: number, datos: { cola?: Cola | null; error?: string }, mensaje: string): Promise<Cola | null> {
  if (estado !== 200) throw new Error(datos.error ?? mensaje);
  return datos.cola ?? null;
}

export async function obtenerCola(): Promise<{ cola: Cola | null; imagenObjetivo: string | null }> {
  const { estado, datos } = await llamar<{ cola: Cola | null; imagenObjetivo: string | null }>("/api/cola");
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo leer la cola");
  return { cola: datos.cola ?? null, imagenObjetivo: datos.imagenObjetivo ?? null };
}

export async function iniciarColaServidor(tipo: TipoActualizacion, ids: string[], simulacion: boolean, confirmacion: Record<string, string>): Promise<Cola | null> {
  const { estado, datos } = await llamar<{ cola: Cola }>("/api/cola", { tipo, ids, simulacion, confirmacion });
  return respuestaCola(estado, datos, "No se pudo iniciar la cola");
}

export async function accionCola(accion: AccionCola, confirmacion?: string): Promise<Cola | null> {
  const { estado, datos } = await llamar<{ cola: Cola | null }>("/api/cola/accion", { accion, confirmacion });
  return respuestaCola(estado, datos, "No se pudo completar la acción");
}

// ---------- Logos (API real; ver y subir son públicos/administrador en el servidor) ----------
export type LugarLogo = "sidebar" | "login";
export async function obtenerLogos(): Promise<Record<LugarLogo, number | null>> {
  const { estado, datos } = await llamar<Record<LugarLogo, number | null>>("/api/logos");
  if (estado !== 200) return { sidebar: null, login: null };
  return { sidebar: datos.sidebar ?? null, login: datos.login ?? null };
}

export async function subirLogo(lugar: LugarLogo, archivo: File): Promise<void> {
  const r = await fetch(`/api/logos/${lugar}`, { method: "PUT", headers: { "content-type": archivo.type }, body: archivo, credentials: "same-origin" });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo subir el logo");
}

export async function quitarLogo(lugar: LugarLogo): Promise<void> {
  const r = await fetch(`/api/logos/${lugar}`, { method: "DELETE", credentials: "same-origin" });
  if (!r.ok) throw new Error("No se pudo quitar el logo");
}

// ---------- Auditoría ----------
// Real: lee la auditoría del servidor (solo inserción). Sin portal, devuelve lo más reciente de todo.
export async function listarAuditoria(portalId?: string): Promise<RegistroAuditoria[]> {
  const { estado, datos } = await llamar<RegistroAuditoria[]>(`/api/auditoria${portalId ? `?portal=${encodeURIComponent(portalId)}` : ""}`);
  if (estado !== 200) throw new Error("No se pudo leer el historial");
  return datos;
}

// ---------- Usuarios (API real, solo administrador) ----------
export async function listarUsuarios(): Promise<Usuario[]> {
  const { estado, datos } = await llamar<Usuario[]>("/api/usuarios");
  if (estado !== 200) throw new Error("No se pudo leer la lista de usuarios");
  return datos;
}

async function accionServidor<T extends object>(url: string, cuerpo: object, metodo: string, mensaje: string): Promise<T> {
  const { estado, datos } = await llamar<T>(url, cuerpo, metodo);
  if (estado !== 200) throw new Error(datos.error ?? mensaje);
  return datos;
}

/** Devuelve la clave temporal: solo se muestra una vez, el servidor no la guarda en claro. */
export const crearUsuario = (u: Pick<Usuario, "usuario" | "nombre" | "correo" | "rol">) =>
  accionServidor<{ usuario: string; claveTemporal: string }>("/api/usuarios", u, "POST", "No se pudo crear el usuario");

export const cambiarEstadoUsuario = (id: string, activo: boolean) =>
  accionServidor<object>(`/api/usuarios/${encodeURIComponent(id)}`, { activo }, "PATCH", "No se pudo cambiar el estado");

export const cambiarRolUsuario = (id: string, rol: Rol) =>
  accionServidor<object>(`/api/usuarios/${encodeURIComponent(id)}`, { rol }, "PATCH", "No se pudo cambiar el rol");

export const editarUsuario = (id: string, datos: { nombre: string; correo: string }) =>
  accionServidor<object>(`/api/usuarios/${encodeURIComponent(id)}`, datos, "PATCH", "No se pudieron guardar los cambios");

/** Borra la cuenta; el servidor exige el nombre de usuario exacto y conserva el historial. */
export const eliminarUsuario = (id: string, confirmacion: string) =>
  accionServidor<object>(`/api/usuarios/${encodeURIComponent(id)}/eliminar`, { confirmacion }, "POST", "No se pudo eliminar el usuario");

export const restablecerClave = (id: string) =>
  accionServidor<{ claveTemporal: string }>(`/api/usuarios/${encodeURIComponent(id)}/restablecer-clave`, {}, "POST", "No se pudo restablecer la contraseña");

export const restablecerMfa = (id: string) =>
  accionServidor<object>(`/api/usuarios/${encodeURIComponent(id)}/restablecer-mfa`, {}, "POST", "No se pudo restablecer el MFA");

// ---------- Configuración ----------
// Real y de solo lectura: los valores salen del .env del servidor.
export async function obtenerConfiguracion(): Promise<Configuracion> {
  const { estado, datos } = await llamar<Omit<Configuracion, "etiquetaImagen" | "correosNotificacion">>("/api/configuracion");
  if (estado !== 200) throw new Error("No se pudo leer la configuración");
  return { ...datos, etiquetaImagen: "", correosNotificacion: [] };
}

// ---------- Seguridad (API real) ----------
export async function cambiarClave(actual: string, nueva: string): Promise<void> {
  const { estado, datos } = await llamar<object>("/api/cambiar-clave", { actual, nueva });
  if (estado !== 200) throw new Error(datos.error ?? "No se pudo cambiar la contraseña");
}
