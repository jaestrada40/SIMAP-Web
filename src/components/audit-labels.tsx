import { CheckCircle2, Info, XCircle } from "lucide-react";
import type { AccionAuditoria, RegistroAuditoria } from "@/types";

export const ACCION_TEXTO: Record<AccionAuditoria, string> = {
  inicio_sesion: "Inicio de sesión",
  revision: "Revisión",
  actualizacion_iniciada: "Actualización iniciada",
  actualizacion_completada: "Actualización completada",
  actualizacion_fallida: "Actualización fallida",
  reintento: "Reintento",
  vuelta_atras: "Vuelta atrás",
  cambio_configuracion: "Cambio de configuración",
  cierre_sesion: "Cierre de sesión",
  cambio_logo: "Cambio de logo",
  respaldo: "Respaldo a pedido",
  cambio_usuario: "Gestión de usuarios",
  cambio_clave: "Cambio de contraseña",
  otro: "Otro",
};

export const RESULTADO_TEXTO: Record<RegistroAuditoria["resultado"], string> = { exito: "Éxito", fallo: "Fallo", info: "Información" };

export function ResultadoBadge({ r }: { r: RegistroAuditoria["resultado"] }) {
  if (r === "exito") return <span className="status-pill status-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Éxito</span>;
  if (r === "fallo") return <span className="status-pill status-error"><XCircle className="h-3.5 w-3.5" aria-hidden />Fallo</span>;
  return <span className="status-pill status-info"><Info className="h-3.5 w-3.5" aria-hidden />Información</span>;
}
