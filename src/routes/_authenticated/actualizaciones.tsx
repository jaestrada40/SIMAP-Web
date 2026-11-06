import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertOctagon, ArrowDown, ArrowUp, CheckCircle2, HardDrive, OctagonX, Play, RotateCcw, SkipForward, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StepBadge } from "@/components/status-badge";
import { CargandoTabla, ErrorTabla } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { useAuth } from "@/components/auth-context";
import { useCola, type EstadoItem } from "@/components/queue-context";
import { listarPortales, obtenerConfiguracion } from "@/services/api";
import { CLASE_RESPALDO, estadoRespaldo, pluginsPendientes, puede } from "@/lib/simap";
import { PASOS, type TipoActualizacion } from "@/types";
import { cn } from "@/lib/utils";

interface Busqueda { portales?: string | undefined; tipo?: TipoActualizacion | undefined }

export const Route = createFileRoute("/_authenticated/actualizaciones")({
  validateSearch: (s: Record<string, unknown>): Busqueda => ({
    portales: typeof s["portales"] === "string" ? s["portales"] : undefined,
    tipo: s["tipo"] === "plugins" || s["tipo"] === "nucleo_php" ? s["tipo"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Cola de actualizaciones · SIMAP-Web" },
      { name: "description", content: "Actualice los portales de uno en uno con control de errores." },
      { property: "og:title", content: "Cola de actualizaciones · SIMAP-Web" },
      { property: "og:description", content: "Actualice los portales de uno en uno con control de errores." },
    ],
  }),
  component: Actualizaciones,
});

function Actualizaciones() {
  const { usuario } = useAuth();
  const { cola } = useCola();
  if (!puede.actualizar(usuario?.rol))
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Cola de actualizaciones</h1>
        {cola ? <VistaCola soloLectura /> : <Alert><AlertDescription>Su rol es de solo lectura. No hay ninguna cola activa en este momento.</AlertDescription></Alert>}
      </div>
    );
  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          <b>Cola real.</b> Actualiza los portales de verdad, con respaldo de la base antes de cambiar nada. El modo simulación hace las comprobaciones reales pero no cambia nada. Núcleo y PHP cambia la imagen del portal y tiene "Volver atrás"; plugins no.
        </AlertDescription>
      </Alert>
      {cola ? <VistaCola /> : <Preparar />}
    </div>
  );
}

function Preparar() {
  const search = Route.useSearch();
  const { iniciar, imagenObjetivo } = useCola();
  const portales = useQuery({ queryKey: ["portales"], queryFn: listarPortales });
  const config = useQuery({ queryKey: ["config"], queryFn: obtenerConfiguracion });
  const [tipo, setTipo] = useState<TipoActualizacion>(search.tipo ?? "plugins");
  const [orden, setOrden] = useState<string[]>(search.portales?.split(",").filter(Boolean) ?? []);
  const [sim, setSim] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const pagLista = usePaginacion(portales.data ?? []);

  if (portales.isLoading || config.isLoading) return <CargandoTabla />;
  if (portales.isError || !portales.data || !config.data) return <ErrorTabla reintentar={() => portales.refetch()} />;
  const lista = portales.data;
  const umbral = config.data.umbralDisco;
  const maxDias = config.data.respaldoMaxDias;
  const porId = Object.fromEntries(lista.map((p) => [p.id, p]));
  const seleccion = orden.filter((id) => porId[id]);
  const mover = (i: number, d: number) => {
    const n = [...seleccion];
    [n[i], n[i + d]] = [n[i + d]!, n[i]!];
    setOrden(n);
  };
  const sinRespaldoExterno = seleccion.filter((id) => !["ok"].includes(estadoRespaldo(porId[id]!, maxDias).nivel));
  const confirmado = sim || seleccion.every((id) => nombres[id] === id); // el servidor lo vuelve a validar

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Cola de actualizaciones</h1>
        <p className="text-sm text-muted-foreground">Los portales se actualizan de uno en uno. Si uno falla, la cola se detiene.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader><CardTitle className="text-base">1. Elegir portales</CardTitle></CardHeader>
          <CardContent className="max-h-[560px] space-y-1 overflow-y-auto">
            {pagLista.visibles.map((p) => {
              const marcado = seleccion.includes(p.id);
              const lleno = p.discoUsadoPct > umbral;
              return (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                  <Checkbox checked={marcado} onCheckedChange={(v) => setOrden(v ? [...seleccion, p.id] : seleccion.filter((x) => x !== p.id))} />
                  <span className="flex-1 text-sm font-medium">{p.nombre}</span>
                  {tipo === "plugins" && <span className="text-xs text-muted-foreground">{pluginsPendientes(p)} pend.</span>}
                  {tipo === "nucleo_php" && <span className="text-xs text-muted-foreground">PHP {p.php} · WP {p.wordpress}</span>}
                  {(() => {
                    const r = estadoRespaldo(p, maxDias);
                    return r.nivel === "ok" ? null : <span className={`status-pill ${CLASE_RESPALDO[r.nivel]}`} title={r.detalle}>Respaldo: {r.texto}</span>;
                  })()}
                  {lleno && <span className="status-pill status-error"><HardDrive className="h-3 w-3" aria-hidden />Disco {p.discoUsadoPct} %</span>}
                </label>
              );
            })}
          </CardContent>
          <Paginacion pag={pagLista.pag} />
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">2. Tipo y opciones</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as TipoActualizacion)}>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="nucleo_php" /> Núcleo y PHP</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="plugins" /> Plugins</label>
              </RadioGroup>
              {tipo === "nucleo_php" && (
                <div>
                  <Label className="text-xs text-muted-foreground">Imagen objetivo (la fija el servidor)</Label>
                  <Input readOnly value={imagenObjetivo ?? "No configurada: falta IMAGEN_OBJETIVO en el servidor"} className="mt-1 font-mono text-xs" />
                </div>
              )}
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label htmlFor="sim">Modo simulación</Label>
                  <p className="text-xs text-muted-foreground">Solo muestra lo que haría, sin cambiar nada.</p>
                </div>
                <Switch id="sim" checked={sim} onCheckedChange={setSim} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">3. Orden ({seleccion.length})</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {seleccion.length === 0 && <p className="text-sm text-muted-foreground">Seleccione al menos un portal.</p>}
              {seleccion.map((id, i) => (
                <div key={id} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm">
                  <span className="w-5 text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1">{id}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === seleccion.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar"><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOrden(seleccion.filter((x) => x !== id))} aria-label="Quitar"><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button className="mt-3 w-full" disabled={seleccion.length === 0} onClick={() => { setNombres({}); setConfirmar(true); }}>
                <Play className="h-4 w-4" /> Iniciar
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmar} onOpenChange={setConfirmar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar actualización</DialogTitle>
            <DialogDescription>
              Se actualizarán {seleccion.length} portal(es) — {tipo === "nucleo_php" ? "Núcleo y PHP" : "Plugins"}
              {sim ? " en modo simulación (sin cambios)." : "."}
            </DialogDescription>
          </DialogHeader>
          {sinRespaldoExterno.length > 0 && (
            <Alert>
              <AlertDescription>
                <b>{sinRespaldoExterno.length} de {seleccion.length} portal(es) no tienen un respaldo externo reciente</b> ({sinRespaldoExterno.join(", ")}).
                La cola igual hace un respaldo de la base antes de actualizar, pero queda dentro del mismo volumen del portal: si el volumen falla, se pierde junto con el sitio. Puede continuar, o cancelar y descargar un respaldo desde la ficha del portal.
              </AlertDescription>
            </Alert>
          )}
          {!sim && (
            <div className="space-y-2">
              <p className="text-sm">Escriba el nombre de cada portal para confirmar:</p>
              {seleccion.map((id) => (
                <div key={id}>
                  <Label htmlFor={`c-${id}`} className="text-xs">{id}</Label>
                  <Input id={`c-${id}`} value={nombres[id] ?? ""} onChange={(e) => setNombres({ ...nombres, [id]: e.target.value })} autoComplete="off" />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(false)}>Cancelar</Button>
            <Button disabled={!confirmado || (tipo === "nucleo_php" && !sim && !imagenObjetivo)} onClick={() => { setConfirmar(false); iniciar(tipo, seleccion, sim, nombres); }}>Iniciar cola</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ITEM_TEXTO: Record<EstadoItem, { t: string; cls: string }> = {
  espera: { t: "En espera", cls: "status-neutral" },
  en_curso: { t: "En curso", cls: "status-info" },
  listo: { t: "Completado", cls: "status-ok" },
  error: { t: "Error", cls: "status-down" },
  saltado: { t: "Saltado", cls: "status-warn" },
  detenido: { t: "No procesado", cls: "status-neutral" },
};

function VistaCola({ soloLectura }: { soloLectura?: boolean }) {
  const { cola, reintentar, saltar, volverAtras, detener, limpiar, activa } = useCola();
  const qc = useQueryClient();
  const [ver, setVer] = useState<number | null>(null);
  const [confVolver, setConfVolver] = useState(false);
  const [textoVolver, setTextoVolver] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const idx = ver ?? Math.min(cola?.indice ?? 0, (cola?.items.length ?? 1) - 1);
  const item = cola?.items[idx];
  const fallido = cola?.items[cola.indice]?.portalId ?? "";

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [item?.log.length]);
  useEffect(() => {
    if (cola?.estado === "finalizada") void qc.invalidateQueries();
  }, [cola?.estado, qc]);

  if (!cola || !item) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cola de actualizaciones</h1>
          <p className="text-sm text-muted-foreground">
            {cola.tipo === "nucleo_php" ? "Núcleo y PHP" : "Plugins"}
            {cola.simulacion && " · Modo simulación"} · {cola.items.filter((i) => i.estado === "listo").length} de {cola.items.length} completados
          </p>
        </div>
        {!soloLectura && (activa ? (
          <Button variant="outline" onClick={detener}><Square className="h-4 w-4" /> Detener cola</Button>
        ) : (
          <Button onClick={limpiar}>Nueva cola</Button>
        ))}
      </div>

      {cola.estado === "detenida_error" && (
        <Alert variant="destructive" className="border-2">
          <AlertOctagon className="h-5 w-5" />
          <AlertTitle className="text-lg font-bold">Cola detenida</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Falló la actualización de <b>{cola.items[cola.indice]?.portalId}</b>. Los demás portales quedan en espera hasta que elija una opción.
            </p>
            {!soloLectura && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={reintentar}><RotateCcw className="h-4 w-4" /> Reintentar</Button>
                {cola.tipo === "nucleo_php" && !cola.simulacion && (
                  <Button variant="destructive" onClick={() => { setTextoVolver(""); setConfVolver(true); }}><OctagonX className="h-4 w-4" /> Volver atrás</Button>
                )}
                <Button variant="outline" onClick={saltar}><SkipForward className="h-4 w-4" /> Saltar este portal</Button>
                <Button variant="destructive" onClick={detener}><OctagonX className="h-4 w-4" /> Detener la cola</Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
      {cola.estado === "finalizada" && (
        <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>Cola finalizada</AlertTitle><AlertDescription>Todos los portales fueron procesados. <Link to="/historial" className="underline">Ver historial</Link> · <button className="underline" onClick={limpiar}>Cerrar</button></AlertDescription></Alert>
      )}
      {cola.estado === "detenida_usuario" && (
        <Alert><Square className="h-4 w-4" /><AlertTitle>Cola detenida por el usuario</AlertTitle><AlertDescription>Los portales pendientes no fueron procesados. <button className="underline" onClick={limpiar}>Cerrar</button></AlertDescription></Alert>
      )}

      <Dialog open={confVolver} onOpenChange={setConfVolver}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Volver a la imagen anterior?</DialogTitle>
            <DialogDescription>
              {fallido} se reiniciará con la imagen que tenía antes de esta actualización y la cola se detendrá. Solo se restaura la imagen (núcleo y PHP): la base de datos no se toca.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="c-volver" className="text-xs">Escriba <b>{fallido}</b> para confirmar</Label>
            <Input id="c-volver" value={textoVolver} onChange={(e) => setTextoVolver(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfVolver(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={textoVolver !== fallido} onClick={() => { setConfVolver(false); volverAtras(textoVolver); }}>Volver atrás</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="space-y-1 p-2">
            {cola.items.map((it, i) => (
              <button
                key={it.portalId}
                onClick={() => setVer(i)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted", i === idx && "bg-muted font-semibold", it.estado === "error" && "ring-2 ring-destructive")}
              >
                <span className="w-5 text-muted-foreground">{i + 1}.</span>
                <span className="flex-1 truncate">{it.portalId}</span>
                <span className={cn("status-pill", ITEM_TEXTO[it.estado].cls)}>{ITEM_TEXTO[it.estado].t}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-base">{item.portalId}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ol className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {PASOS.map((paso, i) => (
                <li key={paso} className={cn("rounded-md border p-2.5", item.pasos[i] === "error" && "border-destructive")}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{i + 1}. {paso}</p>
                  <StepBadge estado={item.pasos[i] ?? "pendiente"} />
                </li>
              ))}
            </ol>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Registro en vivo</p>
              <pre ref={logRef} className="h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-log p-3 font-mono text-xs leading-relaxed text-log-foreground" aria-live="polite">
                {item.log.length ? item.log.join("\n") : "En espera…"}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
