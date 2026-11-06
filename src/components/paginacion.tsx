import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TAMANOS = [10, 25, 50];

/** Parte una lista en páginas. Vuelve a la página 1 cuando cambia la cantidad de filas (filtros) o el tamaño. */
export function usePaginacion<T>(items: T[], inicial = 10) {
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(inicial);
  const total = items.length;
  const paginas = Math.max(1, Math.ceil(total / tamano));
  const actual = Math.min(pagina, paginas);
  useEffect(() => setPagina(1), [total, tamano]);
  return {
    visibles: items.slice((actual - 1) * tamano, actual * tamano),
    pag: { pagina: actual, paginas, total, tamano, setPagina, setTamano },
  };
}

export type Pag = ReturnType<typeof usePaginacion>["pag"];

export function Paginacion({ pag }: { pag: Pag }) {
  const { pagina, paginas, total, tamano, setPagina, setTamano } = pag;
  if (total === 0) return null;
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <p className="text-muted-foreground">
        Mostrando {(pagina - 1) * tamano + 1}–{Math.min(pagina * tamano, total)} de {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Filas por página</span>
        <Select value={String(tamano)} onValueChange={(v) => setTamano(Number(v))}>
          <SelectTrigger className="h-8 w-20" aria-label="Filas por página"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TAMANOS.map((t) => <SelectItem key={t} value={String(t)}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Button>
        <span aria-live="polite">Página {pagina} de {paginas}</span>
        <Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} aria-label="Página siguiente">
          Siguiente <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
