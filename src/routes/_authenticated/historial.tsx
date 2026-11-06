import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CargandoTabla, ErrorTabla, SinDatos } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { ACCION_TEXTO, RESULTADO_TEXTO, ResultadoBadge } from "@/components/audit-labels";
import { listarAuditoria } from "@/services/api";
import { fechaHora } from "@/lib/simap";

export const Route = createFileRoute("/_authenticated/historial")({
  head: () => ({
    meta: [
      { title: "Historial y auditoría · SIMAP-Web" },
      { name: "description", content: "Registro de acciones de usuarios y actualizaciones." },
      { property: "og:title", content: "Historial y auditoría · SIMAP-Web" },
      { property: "og:description", content: "Registro de acciones de usuarios y actualizaciones." },
    ],
  }),
  component: Historial,
});

function Historial() {
  const q = useQuery({ queryKey: ["auditoria"], queryFn: () => listarAuditoria() });
  const [usuario, setUsuario] = useState("todos");
  const [portal, setPortal] = useState("");
  const [accion, setAccion] = useState("todas");
  const [resultado, setResultado] = useState("todos");
  const [desde, setDesde] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  const datos = q.data ?? [];
  const usuarios = [...new Set(datos.map((d) => d.usuario))];
  const filas = useMemo(
    () =>
      datos.filter(
        (d) =>
          (usuario === "todos" || d.usuario === usuario) &&
          (!portal || (d.portalId ?? "").includes(portal.toLowerCase())) &&
          (accion === "todas" || d.accion === accion) &&
          (resultado === "todos" || d.resultado === resultado) &&
          (!desde || d.fecha.slice(0, 10) >= desde),
      ),
    [datos, usuario, portal, accion, resultado, desde],
  );

  const { visibles, pag } = usePaginacion(filas);

  function exportar() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ["Fecha,Usuario,Portal,Acción,Resultado,Detalle"]
      .concat(filas.map((f) => [fechaHora(f.fecha), f.usuario, f.portalId ?? "", ACCION_TEXTO[f.accion], RESULTADO_TEXTO[f.resultado], f.detalle].map(esc).join(",")))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `auditoria-simap-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Historial y auditoría</h1>
          <p className="text-sm text-muted-foreground">Todas las acciones quedan registradas.</p>
        </div>
        <Button variant="outline" onClick={exportar} disabled={!filas.length}><Download className="h-4 w-4" /> Exportar CSV</Button>
      </div>
      <Card>
        <CardContent className="flex flex-wrap gap-2 p-4">
          <Select value={usuario} onValueChange={setUsuario}>
            <SelectTrigger className="w-40" aria-label="Usuario"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los usuarios</SelectItem>
              {usuarios.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="w-44" placeholder="Portal" value={portal} onChange={(e) => setPortal(e.target.value)} aria-label="Portal" />
          <Select value={accion} onValueChange={setAccion}>
            <SelectTrigger className="w-56" aria-label="Acción"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las acciones</SelectItem>
              {Object.entries(ACCION_TEXTO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={resultado} onValueChange={setResultado}>
            <SelectTrigger className="w-40" aria-label="Resultado"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todo resultado</SelectItem>
              <SelectItem value="exito">Éxito</SelectItem>
              <SelectItem value="fallo">Fallo</SelectItem>
              <SelectItem value="info">Información</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" className="w-44" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde la fecha" />
        </CardContent>
      </Card>
      <Card className="overflow-x-auto">
        {q.isLoading ? <CargandoTabla /> : q.isError ? <ErrorTabla reintentar={() => q.refetch()} /> : filas.length === 0 ? <SinDatos /> : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Fecha</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((f) => (
                <Fragment key={f.id}>
                  <TableRow className="cursor-pointer" onClick={() => setAbierto(abierto === f.id ? null : f.id)} aria-expanded={abierto === f.id}>
                    <TableCell>{abierto === f.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fechaHora(f.fecha)}</TableCell>
                    <TableCell>{f.usuario}</TableCell>
                    <TableCell>{f.portalId ?? "—"}</TableCell>
                    <TableCell>{ACCION_TEXTO[f.accion]}</TableCell>
                    <TableCell><ResultadoBadge r={f.resultado} /></TableCell>
                  </TableRow>
                  {abierto === f.id && (
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell />
                      <TableCell colSpan={5} className="text-sm">
                        <p><b>Detalle:</b> {f.detalle}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Fecha completa: {new Date(f.fecha).toLocaleString("es-GT")} · Identificador: {f.id}</p>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <Paginacion pag={pag} />
          </>
        )}
      </Card>
    </div>
  );
}
