import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/password-input";
import { descargarPiezaUpdraft, lanzarCopiaUpdraft, listarCopiasUpdraft, revisarAhora } from "@/services/api";

const NOMBRE_PIEZA: Record<string, string> = {
  db: "Base de datos", plugins: "Plugins", themes: "Temas", uploads: "Archivos subidos", others: "Otros archivos", wpcore: "Núcleo de WordPress",
};

function tamano(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** Copias completas de UpdraftPlus de un portal: hacer una nueva en segundo plano, ver su avance y descargar cada pieza. */
export function CopiasUpdraft({ portalId, nombre, remoto, puedeLanzar, puedeDescargar }: { portalId: string; nombre: string; remoto: boolean; puedeLanzar: boolean; puedeDescargar: boolean }) {
  const qc = useQueryClient();
  const [lanzando, setLanzando] = useState(false);
  const [pieza, setPieza] = useState<string | null>(null);
  const [clave, setClave] = useState("");
  const [bajando, setBajando] = useState(false);
  const q = useQuery({
    queryKey: ["updraft", portalId],
    queryFn: () => listarCopiasUpdraft(portalId),
    // Mientras hay una copia corriendo se consulta cada 3 segundos; si no, no hace falta
    refetchInterval: (consulta) => (["iniciando", "en_curso"].includes(consulta.state.data?.avance.estado ?? "") ? 3000 : false),
  });
  const avance = q.data?.avance;
  const corriendo = avance?.estado === "iniciando" || avance?.estado === "en_curso";

  // Aviso al terminar (solo si la vimos correr: no al abrir la pantalla con una copia vieja ya terminada)
  const antes = useRef<string | undefined>(undefined);
  useEffect(() => {
    const ahora = avance?.estado;
    if (antes.current && ["iniciando", "en_curso"].includes(antes.current)) {
      if (ahora === "terminada") {
        toast.success("Copia completa terminada");
        // Una revisión de solo lectura para que el estado de respaldo del panel y de la ficha refleje la copia nueva
        void revisarAhora(portalId).catch(() => null).finally(() => { void qc.invalidateQueries(); });
      }
      if (ahora === "detenida") toast.error("La copia se detuvo o no llegó a arrancar. Revise el registro de UpdraftPlus en el portal.", { duration: 12000 });
    }
    antes.current = ahora;
  }, [avance?.estado, portalId, qc]);

  async function lanzar() {
    setLanzando(true);
    try {
      await lanzarCopiaUpdraft(portalId);
      toast.success("Copia lanzada: corre en segundo plano");
      await q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo lanzar la copia");
    } finally {
      setLanzando(false);
    }
  }

  async function bajar() {
    if (!pieza) return;
    const archivo = pieza, password = clave;
    setClave("");
    setPieza(null);
    setBajando(true);
    try {
      await descargarPiezaUpdraft(portalId, archivo, password);
      toast.success("Descarga iniciada: revise la barra de descargas del navegador");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo descargar");
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">Copias completas de UpdraftPlus</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Cada copia trae la base de datos, plugins, temas, archivos subidos y otros. Se descargan por pieza y sirven para reconstruir el portal (ver GUIA-RECONSTRUCCION.md).
        {!remoto && " Hoy están guardadas dentro del mismo volumen del portal: descárguelas para tener una copia fuera."}
      </p>

      {puedeLanzar && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={lanzando || corriendo}>
              {corriendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} {corriendo ? "Copia en curso…" : "Hacer copia completa ahora"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Hacer una copia completa de {nombre}?</AlertDialogTitle>
              <AlertDialogDescription>
                Corre en segundo plano dentro del portal y puede tardar desde menos de un minuto hasta mucho más en portales con muchos archivos; el portal puede ir algo más lento mientras tanto. Antes de lanzarla se comprueba que el volumen tenga espacio suficiente. UpdraftPlus conserva solo las copias que tenga configuradas (en los portales revisados, 1): <b>la nueva puede reemplazar a la anterior</b>. Si quiere conservar la actual, descárguela primero.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={lanzar}>Hacer la copia</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {avance && avance.estado !== "sin_actividad" && (
        <p className="mt-2 text-xs" aria-live="polite">
          {corriendo && <><b>En curso{avance.hace !== null ? "" : "…"}</b>: {avance.ultimaLinea || "iniciando…"}</>}
          {avance.estado === "terminada" && <>Última copia registrada: <b>terminada</b>.</>}
          {avance.estado === "detenida" && <span className="text-destructive"><b>Detenida</b>: {avance.ultimaLinea || "el registro dejó de avanzar."}</span>}
        </p>
      )}

      <div className="mt-3">
        {q.isLoading ? <p className="text-xs text-muted-foreground">Leyendo las copias del portal…</p>
          : q.isError ? <p className="text-xs text-destructive">{q.error instanceof Error ? q.error.message : "No se pudo leer"}</p>
          : q.data && q.data.copias.length === 0 ? <p className="text-xs text-muted-foreground">El portal no tiene archivos de copia de UpdraftPlus.</p>
          : q.data?.copias.map((c) => (
            <div key={c.nonce} className="mb-2 rounded-md bg-muted/50 p-2">
              <p className="text-xs font-medium">
                {c.fecha} {c.hora} · {tamano(c.bytes)}{" "}
                <span className={`status-pill ${c.completa ? "status-ok" : "status-warn"}`}>{c.completa ? "Completa" : "Incompleta"}</span>
              </p>
              <ul className="mt-1 space-y-0.5">
                {c.piezas.map((p) => (
                  <li key={p.nombre} className="flex items-center justify-between gap-2 text-xs">
                    <span>{NOMBRE_PIEZA[p.tipo] ?? p.tipo} <span className="text-muted-foreground">({tamano(p.bytes)})</span></span>
                    {puedeDescargar && (
                      <Button size="sm" variant="ghost" className="h-6 px-2" disabled={bajando} onClick={() => { setClave(""); setPieza(p.nombre); }} aria-label={`Descargar ${NOMBRE_PIEZA[p.tipo] ?? p.tipo}`}>
                        <Download className="h-3 w-3" /> Descargar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      <AlertDialog open={!!pieza} onOpenChange={(o) => !o && setPieza(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descargar este archivo?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="break-all font-mono text-xs">{pieza}</span><br />
              Contiene datos del sitio (según la pieza, personas, contraseñas cifradas y archivos): guárdelo en un lugar seguro. Por seguridad, escriba su contraseña; el enlace de descarga vale un solo uso y 1 minuto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <label htmlFor="c-pieza" className="text-xs">Su contraseña</label>
            <PasswordInput id="c-pieza" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!clave} onClick={bajar}>Descargar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
