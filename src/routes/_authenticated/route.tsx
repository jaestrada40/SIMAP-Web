import { createFileRoute, Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  History, LayoutDashboard, LogOut, Menu, Moon, Puzzle, RefreshCcw, Settings, ShieldCheck, Sun, Users, X,
} from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { GuardiaSesion } from "@/components/guardia-sesion";
import { LogoInstitucional } from "@/components/logo-institucional";
import { useQuery } from "@tanstack/react-query";
import { obtenerLogos } from "@/services/api";
import { QueueProvider, useCola } from "@/components/queue-context";
import { Button } from "@/components/ui/button";
import { ROL_TEXTO, puede } from "@/lib/simap";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

const MENU = [
  { to: "/panel", texto: "Panel general", Icono: LayoutDashboard },
  { to: "/actualizaciones", texto: "Cola de actualizaciones", Icono: RefreshCcw },
  { to: "/plugins", texto: "Plugins", Icono: Puzzle },
  { to: "/historial", texto: "Historial y auditoría", Icono: History },
  { to: "/usuarios", texto: "Usuarios", Icono: Users, admin: true },
  { to: "/configuracion", texto: "Configuración", Icono: Settings, admin: true },
  { to: "/seguridad", texto: "Seguridad", Icono: ShieldCheck },
] as const;

function Layout() {
  const { usuario, listo } = useAuth();
  if (!listo) return null;
  if (!usuario) return <Navigate to="/login" replace />;
  return (
    <QueueProvider>
      <Shell />
    </QueueProvider>
  );
}

function Shell() {
  const { usuario, salir } = useAuth();
  const { activa, cola } = useCola();
  const navigate = useNavigate();
  const loc = useLocation();
  const [abierto, setAbierto] = useState(false);
  const logoSidebar = useQuery({ queryKey: ["logos"], queryFn: obtenerLogos, staleTime: 60_000 }).data?.sidebar;
  const [oscuro, setOscuro] = useState(false);

  useEffect(() => {
    const d = localStorage.getItem("simap.tema") === "oscuro";
    setOscuro(d);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", oscuro);
    localStorage.setItem("simap.tema", oscuro ? "oscuro" : "claro");
  }, [oscuro]);
  useEffect(() => setAbierto(false), [loc.pathname]);
  // Con clave temporal solo se puede entrar a Seguridad para cambiarla (el servidor también lo exige).
  const obligadoACambiarClave = !!usuario?.debeCambiar;
  useEffect(() => {
    if (obligadoACambiarClave && loc.pathname !== "/seguridad") navigate({ to: "/seguridad", replace: true });
  }, [obligadoACambiarClave, loc.pathname, navigate]);

  const menu = MENU.filter((m) => !("admin" in m) || puede.administrar(usuario?.rol));

  return (
    <div className="flex min-h-screen">
      <GuardiaSesion />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          abierto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-24 items-center justify-between border-b border-sidebar-border px-4">
          {logoSidebar ? (
            <LogoInstitucional lugar="sidebar" className="max-h-[72px] w-full object-contain object-left" />
          ) : (
            <div>
              <p className="text-lg font-bold tracking-tight text-sidebar-accent-foreground">SIMAP-Web</p>
              <p className="text-[11px] leading-tight opacity-75">Monitoreo y actualización de portales</p>
            </div>
          )}
          <button className="lg:hidden" onClick={() => setAbierto(false)} aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-1 p-3" aria-label="Módulos">
          {menu.map(({ to, texto, Icono }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" }}
            >
              <Icono className="h-4 w-4" aria-hidden />
              {texto}
              {to === "/actualizaciones" && cola && (
                <span className={cn("status-pill ml-auto", cola.estado === "detenida_error" ? "status-down" : "status-ok")}>
                  {activa ? (cola.estado === "detenida_error" ? "Detenida" : "Activa") : "Terminada"}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </aside>
      {abierto && <div className="fixed inset-0 z-30 bg-foreground/40 lg:hidden" onClick={() => setAbierto(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-24 items-center gap-3 border-b bg-card px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setAbierto(true)} aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setOscuro(!oscuro)} aria-label={oscuro ? "Usar modo claro" : "Usar modo oscuro"}>
              {oscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{usuario?.nombre}</p>
              <p className="text-xs text-muted-foreground">{usuario && ROL_TEXTO[usuario.rol]}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                salir();
                navigate({ to: "/login", replace: true });
              }}
            >
              <LogOut className="h-4 w-4" /> Salir
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
