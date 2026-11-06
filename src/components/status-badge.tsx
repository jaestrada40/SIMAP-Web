import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Loader2, XCircle } from "lucide-react";
import type { EstadoPaso, Semaforo } from "@/types";
import { cn } from "@/lib/utils";

const MAPA: Record<Semaforo, { texto: string; Icono: typeof CheckCircle2; cls: string }> = {
  al_dia: { texto: "Al día", Icono: CheckCircle2, cls: "status-ok" },
  pendiente: { texto: "Pendiente", Icono: AlertTriangle, cls: "status-warn" },
  error: { texto: "Error", Icono: XCircle, cls: "status-error" },
  caido: { texto: "Caído", Icono: CircleSlash, cls: "status-down" },
};

export function StatusBadge({ estado, className }: { estado: Semaforo; className?: string }) {
  const { texto, Icono, cls } = MAPA[estado];
  return (
    <span className={cn("status-pill", cls, className)}>
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {texto}
    </span>
  );
}

const PASO: Record<EstadoPaso, { texto: string; Icono: typeof CheckCircle2; cls: string; spin?: boolean }> = {
  pendiente: { texto: "Pendiente", Icono: Clock, cls: "status-neutral" },
  en_curso: { texto: "En curso", Icono: Loader2, cls: "status-info", spin: true },
  listo: { texto: "Listo", Icono: CheckCircle2, cls: "status-ok" },
  error: { texto: "Error", Icono: XCircle, cls: "status-error" },
};

export function StepBadge({ estado }: { estado: EstadoPaso }) {
  const { texto, Icono, cls, spin } = PASO[estado];
  return (
    <span className={cn("status-pill", cls)}>
      <Icono className={cn("h-3.5 w-3.5", spin && "animate-spin")} aria-hidden />
      {texto}
    </span>
  );
}
