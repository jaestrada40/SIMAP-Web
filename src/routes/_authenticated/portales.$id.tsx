import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, DatabaseBackup, Download, FileText, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { CopiasUpdraft } from "@/components/copias-updraft";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/status-badge";
import { CargandoTabla, ErrorTabla, SinDatos } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { useAuth } from "@/components/auth-context";
import { listarAuditoria, obtenerConfiguracion, descargarFicha, descargarRespaldo, obtenerPortal, respaldarAhora, revisarAhora, volverImagenAnterior } from "@/services/api";
import { CLASE_RESPALDO, estadoRespaldo, nucleoPendiente, autoActualizacionTexto, fechaHora, puede, semaforo } from "@/lib/simap";
import { ACCION_TEXTO, ResultadoBadge } from "@/components/audit-labels";

export const Route = createFileRoute("/_authenticated/portales/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.id} · SIMAP-Web` },
      { name: "description", content: `Detalle, plugins e historial del portal ${params.id}.` },
      { property: "og:title", content: `${params.id} · SIMAP-Web` },
      { property: "og:description", content: `Detalle del portal ${params.id}.` },
    ],
  }),
  component: Detalle,
});

function Detalle() {
  const { id } = Route.useParams();
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const portal = useQuery({ queryKey: ["portal", id], queryFn: () => obtenerPortal(id) });
  const config = useQuery({ queryKey: ["config"], queryFn: obtenerConfiguracion });
  const hist = useQuery({ queryKey: ["auditoria", id], queryFn: () => listarAuditoria(id) });
  const [revisando, setRevisando] = useState(false);
  const [textoVolver, setTextoVolver] = useState("");
  const [respaldando, setRespaldando] = useState(false);
  const [claveDescarga, setClaveDescarga] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [bajandoFicha, setBajandoFicha] = useState(false);
  const puedeAct = puede.actualizar(usuario?.rol);
  const historial = hist.data ?? [];
  const pagPlugins = usePaginacion(portal.data?.plugins ?? []);
  const pagHist = usePaginacion(historial);

  if (portal.isLoading) return <CargandoTabla />;
  if (portal.isError) return <ErrorTabla reintentar={() => portal.refetch()} />;
  const p = portal.data;
  if (!p)
    return (
      <div className="space-y-3">
        <SinDatos texto="El portal no existe." />
        <Link to="/panel" className="block text-center text-primary underline">Volver al panel</Link>
      </div>
    );

  const ir = (tipo: "nucleo_php" | "plugins") => navigate({ to: "/actualizaciones", search: { portales: p.id, tipo } });

  return (
    <div className="space-y-5">
      <Link to="/panel" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Panel general
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{p.nombre}</h1>
            <StatusBadge estado={semaforo(p, config.data?.phpMinimo, config.data?.umbralDisco)} />
          </div>
          <a href={p.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">{p.url}</a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={revisando}
            onClick={async () => {
              setRevisando(true);
              try {
                await revisarAhora(p.id);
                await qc.invalidateQueries();
                toast.success("Portal revisado");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "No se pudo revisar");
              } finally {
                setRevisando(false);
              }
            }}
          >
            <RefreshCw className={revisando ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Revisar
          </Button>
          {puedeAct && (
            <>
              <Button variant="outline" onClick={() => ir("nucleo_php")}>Actualizar núcleo/PHP</Button>
              <Button onClick={() => ir("plugins")}>Actualizar plugins</Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="resumen">
        <TabsList className="flex-wrap">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="plugins">Plugins</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
          <TabsTrigger value="respaldos">Respaldos y vuelta atrás</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen">
          <Card>
            <CardContent className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <Dato k="PHP" v={p.php} />
              <Dato k="WordPress" v={!p.wordpressDisponible ? `${p.wordpress} (sin dato de versión nueva; haga una revisión)` : nucleoPendiente(p) ? `${p.wordpress} (disponible ${p.wordpressDisponible})` : `${p.wordpress} (al día)`} />
              <Dato k="Estado HTTP" v={String(p.estadoHttp)} />
              <Dato k="Tiempo de respuesta" v={p.tiempoRespuestaMs ? `${p.tiempoRespuestaMs} ms` : "—"} />
              <Dato k="Proyecto" v={p.proyecto} />
              <Dato k="Deployment" v={p.deployment} />
              <Dato k="Nodo" v={p.nodo} />
              <div>
                <p className="text-xs text-muted-foreground">Espacio de disco</p>
                <div className="mt-1 flex items-center gap-2">
                  <Progress value={p.discoUsadoPct} className="h-2" aria-label={`Uso ${p.discoUsadoPct} %`} />
                  <span className="whitespace-nowrap text-sm">{p.discoUsadoPct} % de {p.discoTotalGb} GB</span>
                </div>
              </div>
              <Dato k="Última revisión" v={fechaHora(p.ultimaRevision)} />
              <Dato k="Auto-actualización (Easy Updates Manager)" v={autoActualizacionTexto(p)} />
              <Dato k="Imagen actual (digest)" v={p.imagenActual} mono />
              <Dato k="Imagen anterior" v={p.imagenAnterior} mono />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plugins">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Versión actual</TableHead>
                  <TableHead>Versión nueva</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Excluido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagPlugins.visibles.map((pl) => (
                  <TableRow key={pl.slug}>
                    <TableCell className="font-medium">{pl.nombre}</TableCell>
                    <TableCell>{pl.versionActual}</TableCell>
                    <TableCell>{pl.versionNueva ? <span className="status-pill status-warn">{pl.versionNueva}</span> : <span className="text-muted-foreground">Al día</span>}</TableCell>
                    <TableCell>{pl.estado === "activo" ? "Activo" : "Inactivo"}</TableCell>
                    <TableCell>{pl.excluido ? <span className="status-pill status-neutral">Excluido</span> : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Paginacion pag={pagPlugins.pag} />
          </Card>
        </TabsContent>

        <TabsContent value="historial">
          <Card>
            {hist.isLoading ? <CargandoTabla filas={3} /> : historial.length === 0 ? <SinDatos texto="Sin actualizaciones registradas." /> : (
              <>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Fecha</TableHead><TableHead>Usuario</TableHead><TableHead>Acción</TableHead><TableHead>Resultado</TableHead><TableHead>Detalle</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {pagHist.visibles.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fechaHora(h.fecha)}</TableCell>
                      <TableCell>{h.usuario}</TableCell>
                      <TableCell>{ACCION_TEXTO[h.accion]}</TableCell>
                      <TableCell><ResultadoBadge r={h.resultado} /></TableCell>
                      <TableCell className="text-sm">{h.detalle}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Paginacion pag={pagHist.pag} />
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="respaldos">
          <Card>
            <CardHeader><CardTitle className="text-base">Respaldos y vuelta atrás</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const r = estadoRespaldo(p, config.data?.respaldoMaxDias);
                const u = p.respaldoUpdraft;
                return (
                  <div className="rounded-md border p-3">
                    <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                      Estado de los respaldos <span className={`status-pill ${CLASE_RESPALDO[r.nivel]}`}>{r.texto}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{r.detalle}</p>
                    {u?.activo && (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        <li>UpdraftPlus, último respaldo: <b>{u.ultimo ? fechaHora(u.ultimo) : "ninguno registrado"}</b></li>
                        <li>Guarda las copias fuera del portal: <b>{u.remoto ? "sí" : "no (quedan en el mismo volumen)"}</b></li>
                        {u.ultimo && <li>Incluye: base de datos <b>{u.incluyeBase ? "sí" : "no"}</b> · archivos subidos <b>{u.incluyeArchivos ? "sí" : "no"}</b></li>}
                      </ul>
                    )}
                  </div>
                );
              })()}
              {puedeAct && (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Ficha de reconstrucción</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Un archivo con lo necesario para volver a levantar este portal desde una copia: imagen exacta, versiones, prefijo de las tablas, plugins, temas y dónde están sus respaldos. <b>No incluye contraseñas ni el wp-config.</b> Guárdela junto a las copias.
                  </p>
                  <Button
                    variant="outline"
                    disabled={bajandoFicha}
                    onClick={async () => {
                      setBajandoFicha(true);
                      try { await descargarFicha(p.id); toast.success("Ficha descargada"); } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo generar la ficha"); } finally { setBajandoFicha(false); }
                    }}
                  >
                    <FileText className="h-4 w-4" /> {bajandoFicha ? "Generando…" : "Descargar ficha de reconstrucción"}
                  </Button>
                </div>
              )}
              {p.respaldoUpdraft?.activo && (
                <CopiasUpdraft portalId={p.id} nombre={p.nombre} remoto={p.respaldoUpdraft.remoto} puedeLanzar={puedeAct} puedeDescargar={puede.administrar(usuario?.rol)} />
              )}
              <Dato k="Último respaldo de la base de datos" v={fechaHora(p.ultimoRespaldo)} />
              <Dato k="Imagen anterior disponible" v={p.imagenAnterior} mono />
              {puedeAct && (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Respaldo a pedido</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Haga un respaldo de la base de datos antes de pulsar a mano un aviso como "Update Database" en wp-admin. Sobrescribe el respaldo anterior de este portal y no se puede hacer mientras hay una cola en curso.
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={respaldando}><DatabaseBackup className="h-4 w-4" /> {respaldando ? "Respaldando…" : "Hacer respaldo ahora"}</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Hacer el respaldo ahora?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se exporta la base de datos de {p.nombre} a un archivo dentro de su volumen. Reemplaza el respaldo anterior. No cambia nada en el sitio.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            setRespaldando(true);
                            try {
                              await respaldarAhora(p.id);
                              await qc.invalidateQueries();
                              toast.success("Respaldo hecho");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "No se pudo hacer el respaldo");
                            } finally {
                              setRespaldando(false);
                            }
                          }}
                        >
                          Hacer respaldo
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {puede.administrar(usuario?.rol) && (
                    <AlertDialog onOpenChange={(o) => o && setClaveDescarga("")}>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="ml-2" disabled={descargando}><Download className="h-4 w-4" /> {descargando ? "Preparando…" : "Descargar respaldo de la base"}</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Descargar el respaldo de la base?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se hace un respaldo nuevo de {p.nombre} y se descarga comprimido (.sql.gz). Solo incluye la base de datos, no los archivos subidos. Contiene datos de personas y los hashes de contraseñas de WordPress: guárdelo en un lugar seguro. Puede tardar un minuto, y no se puede hacer mientras hay una cola en curso. Por seguridad, escriba su contraseña.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div>
                          <label htmlFor="c-descarga" className="text-xs">Su contraseña</label>
                          <PasswordInput id="c-descarga" autoComplete="current-password" value={claveDescarga} onChange={(e) => setClaveDescarga(e.target.value)} />
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={!claveDescarga}
                            onClick={async () => {
                              const clave = claveDescarga;
                              setClaveDescarga("");
                              setDescargando(true);
                              try {
                                await descargarRespaldo(p.id, clave);
                                await qc.invalidateQueries();
                                toast.success("Respaldo descargado");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "No se pudo descargar el respaldo");
                              } finally {
                                setDescargando(false);
                              }
                            }}
                          >
                            Descargar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}
              {puedeAct && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" onClick={() => setTextoVolver("")}><RotateCcw className="h-4 w-4" /> Volver a la imagen anterior</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Volver a la imagen anterior?</AlertDialogTitle>
                      <AlertDialogDescription>El portal {p.nombre} se reiniciará con la imagen anterior. Solo se restaura la imagen (núcleo y PHP): la base de datos no se toca.{p.baseActualizada && <b> En la última actualización WordPress migró la base de datos: con la imagen anterior el sitio podría no funcionar y habría que restaurar el respaldo (wp db import).</b>} Esta acción queda registrada en la auditoría.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <div>
                      <label htmlFor="c-volver" className="text-xs">Escriba <b>{p.id}</b> para confirmar</label>
                      <Input id="c-volver" value={textoVolver} onChange={(e) => setTextoVolver(e.target.value)} autoComplete="off" />
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={textoVolver !== p.id}
                        onClick={async () => {
                          try {
                            await volverImagenAnterior(p.id, textoVolver);
                            await qc.invalidateQueries();
                            toast.success("Imagen anterior restaurada");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "No se pudo volver a la imagen anterior");
                          }
                        }}
                      >
                        Confirmar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Dato({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p className={mono ? "mt-0.5 break-all font-mono text-xs" : "mt-0.5 text-sm font-medium"}>{v}</p>
    </div>
  );
}
