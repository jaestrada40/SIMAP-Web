import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cerrarSesion, EVENTO_SESION_VENCIDA, obtenerSesion, type UsuarioSesion, type VenceSesion } from "@/services/api";

interface AuthCtx {
  usuario: UsuarioSesion | null;
  listo: boolean;
  establecer: (u: UsuarioSesion | null) => void;
  /** Actualiza solo los plazos de la sesión (tras un latido). */
  establecerVence: (v: VenceSesion) => void;
  salir: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    obtenerSesion()
      .catch(() => null) // si el backend no responde, se muestra el login
      .then((u) => {
        setUsuario(u);
        setListo(true);
      });
  }, []);
  const establecerVence = useCallback((vence: VenceSesion) => setUsuario((u) => (u ? { ...u, vence } : u)), []);

  // La sesión venció en el servidor: se limpia lo local y el Layout manda al login (no se llama a /api/logout: ya no hay sesión).
  useEffect(() => {
    const vencida = () => {
      try { localStorage.removeItem("simap.sesion"); sessionStorage.removeItem("simap.pasoMfa"); } catch { /* almacenamiento bloqueado */ }
      setUsuario((u) => {
        if (u) toast.info("Su sesión venció. Entre de nuevo.", { id: "sesion-vencida", duration: 8000 });
        return null;
      });
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, vencida);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, vencida);
  }, []);
  return (
    <Ctx.Provider
      value={{
        usuario,
        listo,
        establecer: setUsuario,
        establecerVence,
        salir: () => {
          void cerrarSesion();
          setUsuario(null);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}
