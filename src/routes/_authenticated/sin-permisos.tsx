import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/sin-permisos")({
  head: () => ({
    meta: [
      { title: "Sin permisos · SIMAP-Web" },
      { name: "description", content: "No tiene permisos para ver esta sección." },
      { property: "og:title", content: "Sin permisos · SIMAP-Web" },
      { property: "og:description", content: "No tiene permisos para ver esta sección." },
    ],
  }),
  component: () => (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <ShieldX className="h-12 w-12 text-destructive" aria-hidden />
      <h1 className="text-2xl font-bold">Sin permisos</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Su rol no tiene acceso a esta sección. Si lo necesita, solicítelo a un administrador.</p>
      <Button asChild><Link to="/panel">Volver al panel</Link></Button>
    </div>
  ),
});
