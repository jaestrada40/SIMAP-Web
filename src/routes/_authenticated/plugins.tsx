import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CargandoTabla, ErrorTabla } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { listarPortales } from "@/services/api";

export const Route = createFileRoute("/_authenticated/plugins")({
  head: () => ({
    meta: [
      { title: "Plugins · SIMAP-Web" },
      { name: "description", content: "Matriz de plugins por portal y exclusiones." },
      { property: "og:title", content: "Plugins · SIMAP-Web" },
      { property: "og:description", content: "Matriz de plugins por portal y exclusiones." },
    ],
  }),
  component: Plugins,
});

function Plugins() {
  const portales = useQuery({ queryKey: ["portales"], queryFn: listarPortales });
  const [filtro, setFiltro] = useState("todos");

  const lista = portales.data ?? [];
  // unión de los plugins de todos los portales (no solo los del primero)
  const catalogo = [...new Map(lista.flatMap((p) => p.plugins).map((x) => [x.slug, x])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const columnas = catalogo.filter((c) => filtro === "todos" || c.slug === filtro);
  const { visibles, pag } = usePaginacion(lista);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Plugins</h1>
          <p className="text-sm text-muted-foreground">Versión actual y nueva de cada plugin en cada portal. Los plugins se actualizan desde la cola de actualizaciones.</p>
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-56" aria-label="Filtrar por plugin"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los plugins</SelectItem>
            {catalogo.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-4 p-4">
          <p className="w-full text-sm font-semibold">Excluidos de la actualización automática</p>
          {catalogo.map((c) => (
            <label key={c.slug} className="flex items-center gap-2 text-sm">
              <Switch
                checked={c.excluido}
                disabled // real, solo lectura: se define en el servidor (PLUGINS_EXCLUIDOS)
              />
              {c.nombre}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        {portales.isLoading ? <CargandoTabla /> : portales.isError ? <ErrorTabla reintentar={() => portales.refetch()} /> : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card">Portal</TableHead>
                {columnas.map((c) => (
                  <TableHead key={c.slug} className="whitespace-nowrap">
                    {c.nombre}
                    {c.excluido && <span className="status-pill status-neutral ml-1.5">Excluido</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="sticky left-0 bg-card font-medium">{p.nombre}</TableCell>
                  {columnas.map((c) => {
                    const pl = p.plugins.find((x) => x.slug === c.slug);
                    if (!pl) return <TableCell key={c.slug}>—</TableCell>;
                    return (
                      <TableCell key={c.slug} className="whitespace-nowrap text-sm">
                        <span title={pl.estado === "inactivo" ? "Plugin inactivo en este portal" : undefined}>{pl.versionActual}{pl.estado === "inactivo" && <span className="ml-1 text-xs text-muted-foreground">(inactivo)</span>}</span>
                        {pl.versionNueva && (
                          <span className="ml-1.5 inline-flex items-center gap-1.5">
                            <span className="status-pill status-warn">→ {pl.versionNueva}</span>
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
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
