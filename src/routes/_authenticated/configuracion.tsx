import type * as React from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CargandoTabla, ErrorTabla } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { useAuth } from "@/components/auth-context";
import { crearPortal, darDeBajaPortal, editarPortal, listarPortales, obtenerConfiguracion, obtenerLogos, quitarLogo, subirLogo, type LugarLogo } from "@/services/api";
import { puede } from "@/lib/simap";
import type { Configuracion } from "@/types";

export const Route = createFileRoute("/_authenticated/configuracion")({
  head: () => ({
    meta: [
      { title: "Configuración · SIMAP-Web" },
      { name: "description", content: "Imagen objetivo, umbrales, notificaciones y portales." },
      { property: "og:title", content: "Configuración · SIMAP-Web" },
      { property: "og:description", content: "Imagen objetivo, umbrales, notificaciones y portales." },
    ],
  }),
  component: ConfiguracionPagina,
});

type FormPortal = { id: string; nombre: string; proyecto: string; deployment: string; contenedor: string; url: string };
const VACIO: FormPortal = { id: "", nombre: "", proyecto: "", deployment: "", contenedor: "wordpress", url: "https://" };

function ConfiguracionPagina() {
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["config"], queryFn: obtenerConfiguracion });
  const portales = useQuery({ queryKey: ["portales"], queryFn: listarPortales });
  const [c, setC] = useState<Configuracion | null>(null);
  const [editar, setEditar] = useState<FormPortal | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrar, setBorrar] = useState<{ id: string; nombre: string; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const { visibles, pag } = usePaginacion(portales.data ?? []);

  useEffect(() => { if (cfg.data) setC(cfg.data); }, [cfg.data]);

  if (!puede.administrar(usuario?.rol)) return <Navigate to="/sin-permisos" />;
  if (cfg.isLoading || !c) return <CargandoTabla />;
  if (cfg.isError) return <ErrorTabla reintentar={() => cfg.refetch()} />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Configuración</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Parámetros generales</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Campo label="Imagen objetivo (digest)"><Input readOnly value={c.imagenObjetivo || "No configurada"} className="font-mono text-xs" /></Campo>
          <Campo label="Versión mínima de PHP permitida"><Input readOnly value={c.phpMinimo} /></Campo>
          <Campo label="Umbral de disco (%)"><Input readOnly value={c.umbralDisco} /></Campo>
          <Campo label="Antigüedad máxima aceptable del respaldo externo (días)"><Input readOnly value={c.respaldoMaxDias} /></Campo>
          <Campo label="Frecuencia de revisión automática (minutos)"><Input readOnly value={c.frecuenciaRevisionMin || "Desactivada"} /></Campo>
          <Campo label="Plugins excluidos">
            <Textarea readOnly rows={3} value={c.pluginsExcluidos.join(", ") || "Ninguno"} />
          </Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Logos</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <BloqueLogo lugar="sidebar" titulo="Menú lateral (fondo azul)" fondo="bg-sidebar" />
          <BloqueLogo lugar="login" titulo="Inicio de sesión (fondo blanco)" fondo="bg-white" />
          <p className="text-xs text-muted-foreground md:col-span-2">PNG, JPG o WebP de hasta 512 KB. Use un PNG con fondo transparente. Cada logo se ve sobre su fondo: el del menú sobre azul (conviene una versión clara) y el del inicio de sesión sobre blanco. No se aceptan SVG.</p>
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          Los parámetros generales son reales pero de solo lectura: se cambian en el archivo .env del servidor (IMAGEN_OBJETIVO, PHP_MINIMO, UMBRAL_DISCO, COLLECT_INTERVAL_MIN, PLUGINS_EXCLUIDOS) y se reinicia el backend.</AlertDescription>
      </Alert>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Portales</CardTitle>
          <Button size="sm" onClick={() => { setNuevo(true); setEditar(VACIO); }}><Plus className="h-4 w-4" /> Agregar portal</Button>
        </CardHeader>
        <div className="overflow-x-auto">
          {portales.isLoading ? <CargandoTabla /> : portales.isError ? <ErrorTabla reintentar={() => portales.refetch()} /> : (
            <>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nombre</TableHead><TableHead>Proyecto</TableHead><TableHead>Deployment</TableHead><TableHead>Contenedor</TableHead><TableHead>URL</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nombre}</TableCell>
                    <TableCell>{p.proyecto}</TableCell>
                    <TableCell>{p.deployment}</TableCell>
                    <TableCell>{p.contenedor}</TableCell>
                    <TableCell className="text-xs">{p.url}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button size="icon" variant="ghost" aria-label={`Editar ${p.nombre}`} onClick={() => { setNuevo(false); setEditar({ id: p.id, nombre: p.nombre, proyecto: p.proyecto, deployment: p.deployment, contenedor: p.contenedor, url: p.url }); }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Eliminar ${p.nombre}`} onClick={() => setBorrar({ id: p.id, nombre: p.nombre, texto: "" })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Paginacion pag={pag} />
            </>
          )}
        </div>
      </Card>

      <Dialog open={!!editar} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{nuevo ? "Agregar portal" : "Editar portal"}</DialogTitle></DialogHeader>
          {editar && (
            <form
              id="fp"
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setGuardando(true);
                try {
                  const { id: _id, ...datos } = editar;
                  const r = nuevo ? await crearPortal(datos) : await editarPortal(editar.id, datos);
                  setEditar(null);
                  await qc.invalidateQueries();
                  if (r.estado === "ok") toast.success(`Portal ${nuevo ? "agregado" : "guardado"} y revisado: responde bien.`);
                  else toast.warning(`Portal ${nuevo ? "agregado" : "guardado"}, pero la primera revisión dijo "${r.estado}"${r.mensaje ? `: ${r.mensaje}` : ""}`, { duration: 12000 });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo guardar el portal");
                } finally {
                  setGuardando(false);
                }
              }}
            >
              {([["nombre", "Nombre"], ["proyecto", "Proyecto (namespace de OpenShift)"], ["deployment", "Deployment"], ["contenedor", "Contenedor"], ["url", "URL del sitio (https)"]] as const).map(([k, l]) => (
                <Campo key={k} label={l}><Input required autoComplete="off" value={editar[k]} onChange={(e) => setEditar({ ...editar, [k]: e.target.value })} /></Campo>
              ))}
              <p className="text-xs text-muted-foreground">
                Proyecto, deployment y contenedor deben escribirse tal como están en OpenShift (minúsculas, números y guiones). Al guardar se hace una revisión de solo lectura para comprobar que el sistema tiene permiso en ese proyecto.
              </p>
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditar(null)}>Cancelar</Button>
            <Button type="submit" form="fp" disabled={guardando}>{guardando ? "Guardando y revisando…" : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja {borrar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>El portal dejará de monitorearse y de aparecer en el panel. No se elimina nada en OpenShift y su historial se conserva; se puede volver a agregar con el mismo nombre.</AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="c-baja" className="text-xs">Escriba <b>{borrar?.id}</b> para confirmar</Label>
            <Input id="c-baja" autoComplete="off" value={borrar?.texto ?? ""} onChange={(e) => borrar && setBorrar({ ...borrar, texto: e.target.value })} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={borrar?.texto !== borrar?.id}
              onClick={async () => {
                if (!borrar) return;
                const { id, texto } = borrar;
                setBorrar(null);
                try {
                  await darDeBajaPortal(id, texto);
                  toast.success("Portal dado de baja");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo dar de baja el portal");
                }
                await qc.invalidateQueries();
              }}
            >
              Dar de baja
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BloqueLogo({ lugar, titulo, fondo }: { lugar: LugarLogo; titulo: string; fondo: string }) {
  const qc = useQueryClient();
  const logos = useQuery({ queryKey: ["logos"], queryFn: obtenerLogos });
  const [trabajando, setTrabajando] = useState(false);
  const version = logos.data?.[lugar];
  async function accion(f: () => Promise<void>, ok: string) {
    setTrabajando(true);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ["logos"] });
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo completar la acción");
    } finally {
      setTrabajando(false);
    }
  }
  return (
    <div className="space-y-2">
      <Label>{titulo}</Label>
      <div className={`flex h-24 items-center justify-center rounded-md border ${fondo}`}>
        {version ? <img src={`/api/logos/${lugar}?v=${version}`} alt={`Logo: ${titulo}`} className="max-h-20 max-w-[90%] object-contain" /> : <span className="text-xs text-muted-foreground">Sin logo (se muestra el texto SIMAP-Web)</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={trabajando}
          aria-label={`Subir logo: ${titulo}`}
          className="max-w-xs"
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            e.target.value = "";
            if (archivo) void accion(() => subirLogo(lugar, archivo), "Logo actualizado");
          }}
        />
        {version && <Button size="sm" variant="outline" disabled={trabajando} onClick={() => accion(() => quitarLogo(lugar), "Logo quitado")}>Quitar</Button>}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
