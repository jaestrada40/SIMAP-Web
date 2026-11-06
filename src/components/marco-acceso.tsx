import { Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LogoInstitucional } from "@/components/logo-institucional";
import { obtenerLogos } from "@/services/api";

export function MarcoAcceso({ children }: { children: ReactNode }) {
  const logos = useQuery({ queryKey: ["logos"], queryFn: obtenerLogos, staleTime: 60_000 });
  const conLogo = !!logos.data?.login;
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-7 shadow-xl">
        {conLogo ? (
          <div className="mb-6 text-center">
            <LogoInstitucional lugar="login" className="mx-auto max-h-24 max-w-full object-contain" />
            <div className="mt-5 border-t pt-4">
              <h1 className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">SIMAP-Web</h1>
              <p className="mt-1 text-xs text-muted-foreground">Monitoreo y actualización de portales</p>
              <p className="text-[11px] text-muted-foreground/80">Uso interno institucional</p>
            </div>
          </div>
        ) : (
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Lock className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-bold">SIMAP-Web</h1>
              <p className="text-xs text-muted-foreground">Uso interno institucional</p>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

