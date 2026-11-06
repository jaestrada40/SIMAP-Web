import { AlertCircle, Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export function CargandoTabla({ filas = 6 }: { filas?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Cargando datos">
      {Array.from({ length: filas }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export function ErrorTabla({ mensaje, reintentar }: { mensaje?: string; reintentar?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
      <p className="text-sm">{mensaje ?? "No se pudieron cargar los datos."}</p>
      {reintentar && (
        <Button variant="outline" size="sm" onClick={reintentar}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

export function SinDatos({ texto = "No hay resultados." }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
      <Inbox className="h-7 w-7" aria-hidden />
      <p className="text-sm">{texto}</p>
    </div>
  );
}
