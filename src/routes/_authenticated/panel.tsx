import type * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowUpDown, CheckCircle2, AlertTriangle, Clock, Globe, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { CargandoTabla, ErrorTabla, SinDatos } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { useAuth } from "@/components/auth-context";
import { listarPortales, obtenerConfiguracion, obtenerUltimaRevision, revisarAhora } from "@/services/api";
import { CLASE_RESPALDO, compararVersion, estadoRespaldo, nucleoPendiente, autoActualizacionCorto, fechaHora, pluginsPendientes, puede, semaforo } from "@/lib/simap";
import type { Portal, Semaforo } from "@/types";

export const Route = createFileRoute("/_authenticated/panel")({
  head: () => ({
    meta: [
      { title: "Panel general · SIMAP-Web" },
      { name: "description", content: "Estado de todos los portales WordPress en una sola pantalla." },
      { property: "og:title", content: "Panel general · SIMAP-Web" },
      { property: "og:description", content: "Estado de todos los portales WordPress en una sola pantalla." },
    ],
  }),
  component: Panel,
});

type Col = "nombre" | "proyecto" | "semaforo" | "php" | "wordpress" | "plugins" | "http" | "tiempo" | "disco" | "revision";
const ORDEN_SEM: Record<Semaforo, number> = { caido: 0, error: 1, pendiente: 2, al_dia: 3 };

function Panel() {
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const portales = useQuery({ queryKey: ["portales"], queryFn: listarPortales });
  const config = useQuery({ queryKey: ["config"], queryFn: obtenerConfiguracion });
  const ultima = useQuery({ queryKey: ["ultimaRevision"], queryFn: obtenerUltimaRevision });
  const [revisando, setRevisando] = useState(false);
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("todos");
  const [fPhp, setFPhp] = useState("todos");
  const [fPlugins, setFPlugins] = useState(false);
  const [orden, setOrden] = useState<{ col: Col; asc: boolean }>({ col: "semaforo", asc: true });
  const [sel, setSel] = useState<Set<string>>(new Set());

  const sem = (p: Portal) => semaforo(p, config.data?.phpMinimo, config.data?.umbralDisco);
  const datos = portales.data ?? [];
  const versionesPhp = [...new Set(datos.map((p) => p.php))].sort();

  const filas = useMemo(() => {
    const val = (p: Portal): string | number => {
      switch (orden.col) {
        case "semaforo": return ORDEN_SEM[sem(p)];
        case "plugins": return pluginsPendientes(p);
        case "http": return p.estadoHttp;
        case "tiempo": return p.tiempoRespuestaMs;
        case "disco": return p.discoUsadoPct;
        case "revision": return p.ultimaRevision;
        default: return p[orden.col];
      }
    };
    return datos
      .filter((p) => (p.nombre + p.proyecto + p.url).toLowerCase().includes(q.toLowerCase()))
      .filter((p) => fEstado === "todos" || sem(p) === fEstado)
      .filter((p) => fPhp === "todos" || p.php === fPhp)
      .filter((p) => !fPlugins || pluginsPendientes(p) > 0)
      .sort((a, b) => {
        const x = val(a), y = val(b);
        const r = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "es", { numeric: true });
        return orden.asc ? r : -r;
      });
  }, [datos, q, fEstado, fPhp, fPlugins, orden, config.data]);

  const { visibles, pag } = usePaginacion(filas);
  const conteo = (s: Semaforo) => datos.filter((p) => sem(p) === s).length;

  async function revisar() {
    setRevisando(true);
    try {
      await revisarAhora();
      await qc.invalidateQueries();
      toast.success("Revisión completada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo revisar");
    } finally {
      setRevisando(false);
    }
  }

  const Th = ({ col, children }: { col: Col; children: React.ReactNode }) => (
    <TableHead aria-sort={orden.col === col ? (orden.asc ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 font-semibold" onClick={() => setOrden({ col, asc: orden.col === col ? !orden.asc : true })}>
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden />
      </button>
    </TableHead>
  );

  const puedeAct = puede.actualizar(usuario?.rol);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Panel general</h1>
          <p className="text-sm text-muted-foreground">Estado de PHP, WordPress y plugins de cada portal.</p>
        </div>
        <Button onClick={revisar} disabled={revisando}>
          <RefreshCw className={revisando ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> {revisando ? "Revisando…" : "Revisar ahora"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Resumen titulo="Total de portales" valor={datos.length} Icono={Globe} />
        <Resumen titulo="Al día" valor={conteo("al_dia")} Icono={CheckCircle2} cls="text-success" />
        <Resumen titulo="Con pendientes" valor={conteo("pendiente")} Icono={AlertTriangle} cls="text-warning" />
        <Resumen titulo="Con error o caídos" valor={conteo("error") + conteo("caido")} Icono={XCircle} cls="text-destructive" />
        <Resumen titulo="Última revisión" valor={ultima.data ? fechaHora(ultima.data) : "—"} Icono={Clock} pequeño />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input placeholder="Buscar por nombre, proyecto o URL" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar portales" />
            </div>
            <Select value={fEstado} onValueChange={setFEstado}>
              <SelectTrigger className="w-40" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="al_dia">Al día</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="caido">Caído</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fPhp} onValueChange={setFPhp}>
              <SelectTrigger className="w-36" aria-label="Filtrar por versión de PHP"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo PHP</SelectItem>
                {versionesPhp.map((v) => <SelectItem key={v} value={v}>PHP {v}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={fPlugins} onCheckedChange={(v) => setFPlugins(!!v)} /> Con plugins pendientes
            </label>
            {puedeAct && (
              <Button
                className="ml-auto"
                disabled={sel.size === 0}
                onClick={() => navigate({ to: "/actualizaciones", search: { portales: [...sel].join(",") } })}
              >
                Actualizar seleccionados ({sel.size})
              </Button>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border">
            {portales.isLoading ? (
              <CargandoTabla />
            ) : portales.isError ? (
              <ErrorTabla reintentar={() => portales.refetch()} />
            ) : filas.length === 0 ? (
              <SinDatos texto="Ningún portal coincide con los filtros." />
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {puedeAct && (
                      <TableHead className="w-8">
                        <Checkbox
                          aria-label="Seleccionar todos"
                          checked={filas.length > 0 && filas.every((p) => sel.has(p.id))}
                          onCheckedChange={(v) => setSel(v ? new Set(filas.map((p) => p.id)) : new Set())}
                        />
                      </TableHead>
                    )}
                    <Th col="nombre">Nombre</Th>
                    <Th col="proyecto">Proyecto</Th>
                    <TableHead>URL</TableHead>
                    <Th col="semaforo">Semáforo</Th>
                    <Th col="php">PHP</Th>
                    <Th col="wordpress">WordPress</Th>
                    <Th col="plugins">Plugins pend.</Th>
                    <Th col="http">HTTP</Th>
                    <Th col="tiempo">Respuesta</Th>
                    <Th col="disco">Disco libre</Th>
                    <TableHead title="Estado del respaldo de UpdraftPlus: externo y reciente, solo dentro del portal, antiguo o ninguno">Respaldo</TableHead>
                    <TableHead title="El portal se actualiza solo (Easy Updates Manager)">Auto-act.</TableHead>
                    <Th col="revision">Última revisión</Th>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((p) => {
                    const libre = 100 - p.discoUsadoPct;
                    return (
                      <TableRow key={p.id} data-state={sel.has(p.id) ? "selected" : undefined}>
                        {puedeAct && (
                          <TableCell>
                            <Checkbox
                              aria-label={`Seleccionar ${p.nombre}`}
                              checked={sel.has(p.id)}
                              onCheckedChange={(v) => {
                                const n = new Set(sel);
                                v ? n.add(p.id) : n.delete(p.id);
                                setSel(n);
                              }}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-semibold">
                          <Link to="/portales/$id" params={{ id: p.id }} className="text-primary hover:underline">{p.nombre}</Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.proyecto}</TableCell>
                        <TableCell><a href={p.url} target="_blank" rel="noreferrer" className="text-xs hover:underline">{p.url.replace("https://", "")}</a></TableCell>
                        <TableCell><StatusBadge estado={sem(p)} /></TableCell>
                        <TableCell className={compararVersion(p.php, config.data?.phpMinimo ?? "0") < 0 ? "font-semibold text-destructive" : ""}>{p.php}</TableCell>
                        <TableCell className="whitespace-nowrap">{p.wordpress}{nucleoPendiente(p) && <span className="status-pill status-warn ml-1.5">→ {p.wordpressDisponible}</span>}</TableCell>
                        <TableCell className="text-center">{pluginsPendientes(p) || "—"}</TableCell>
                        <TableCell className={p.estadoHttp !== 200 ? "font-semibold text-destructive" : ""}>{p.estadoHttp}</TableCell>
                        <TableCell>{p.tiempoRespuestaMs ? `${p.tiempoRespuestaMs} ms` : "—"}</TableCell>
                        <TableCell className="min-w-32">
                          <div className="flex items-center gap-2">
                            <Progress value={libre} className="h-2" aria-label={`Espacio libre ${libre} %`} />
                            <span className={libre < 10 ? "text-xs font-semibold text-destructive" : "text-xs"}>{libre} %</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const r = estadoRespaldo(p, config.data?.respaldoMaxDias);
                            return <span className={`status-pill ${CLASE_RESPALDO[r.nivel]} whitespace-nowrap`} title={r.detalle}>{r.texto}</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          {{ si: <span className="status-pill status-warn">Sí</span>, no: <span className="text-muted-foreground">No</span>, desconocido: <span className="text-muted-foreground">—</span> }[autoActualizacionCorto(p)]}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fechaHora(p.ultimaRevision)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Paginacion pag={pag} />
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Resumen({ titulo, valor, Icono, cls, pequeño }: { titulo: string; valor: number | string; Icono: typeof Globe; cls?: string; pequeño?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
          <p className={pequeño ? "mt-1 text-base font-semibold" : "mt-1 text-3xl font-bold"}>{valor}</p>
        </div>
        <Icono className={`h-5 w-5 ${cls ?? "text-primary"}`} aria-hidden />
      </CardContent>
    </Card>
  );
}
