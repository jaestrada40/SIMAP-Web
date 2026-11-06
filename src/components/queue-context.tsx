import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { accionCola, iniciarColaServidor, obtenerCola, type AccionCola, type Cola } from "@/services/api";
import type { TipoActualizacion } from "@/types";

export type { Cola, EstadoItem, ItemCola } from "@/services/api";

interface QueueCtx {
  cola: Cola | null;
  imagenObjetivo: string | null;
  activa: boolean;
  iniciar: (tipo: TipoActualizacion, ids: string[], simulacion: boolean, confirmacion: Record<string, string>) => Promise<void>;
  reintentar: () => void;
  saltar: () => void;
  volverAtras: (confirmacion: string) => void;
  detener: () => void;
  limpiar: () => void;
}

const Ctx = createContext<QueueCtx | null>(null);

// La cola vive en el servidor: aquí solo se consulta cada segundo (así sigue aunque se cierre o recargue la pestaña).
export function QueueProvider({ children }: { children: ReactNode }) {
  const [cola, setCola] = useState<Cola | null>(null);
  const [imagenObjetivo, setImagenObjetivo] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const r = await obtenerCola();
      setCola(r.cola);
      setImagenObjetivo(r.imagenObjetivo);
    } catch {
      /* un fallo puntual de red no debe borrar lo que ya se está viendo */
    }
  }, []);

  useEffect(() => {
    void refrescar();
    const t = setInterval(() => void refrescar(), 1000);
    return () => clearInterval(t);
  }, [refrescar]);

  const aviso = (e: unknown) => toast.error(e instanceof Error ? e.message : "No se pudo completar la acción");
  const accion = (a: AccionCola) => (confirmacion?: string) => accionCola(a, confirmacion).then(setCola).catch(aviso);

  const activa = cola?.estado === "en_curso" || cola?.estado === "detenida_error";

  return (
    <Ctx.Provider
      value={{
        cola,
        imagenObjetivo,
        activa,
        iniciar: async (tipo, ids, simulacion, confirmacion) => {
          try {
            setCola(await iniciarColaServidor(tipo, ids, simulacion, confirmacion));
          } catch (e) {
            aviso(e);
          }
        },
        reintentar: () => accion("reintentar")(),
        saltar: () => accion("saltar")(),
        volverAtras: accion("volver"),
        detener: () => accion("detener")(),
        limpiar: () => accion("limpiar")(),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCola() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCola fuera de QueueProvider");
  return c;
}
