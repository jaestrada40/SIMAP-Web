import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type * as React from "react";
import { MarcoAcceso } from "@/components/marco-acceso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { iniciarSesion } from "@/services/api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión · SIMAP-Web" },
      { name: "description", content: "Acceso al sistema de monitoreo de portales." },
      { property: "og:title", content: "Iniciar sesión · SIMAP-Web" },
      { property: "og:description", content: "Acceso al sistema de monitoreo de portales." },
    ],
  }),
  component: LoginLayout,
});

function LoginLayout() {
  const loc = useLocation();
  if (loc.pathname !== "/login") return <Outlet />;
  return <Login />;
}

function Login() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const r = await iniciarSesion(usuario, clave);
    setCargando(false);
    if (r.ok) navigate({ to: "/login/mfa" });
    else {
      setError(r.error);
      setBloqueado(!!r.bloqueado);
    }
  }

  return (
    <MarcoAcceso>
      <form onSubmit={enviar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="usuario">Usuario</Label>
          <Input id="usuario" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clave">Contraseña</Label>
          <PasswordInput id="clave" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required />
        </div>
        {error && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={cargando || bloqueado}>
          {cargando ? "Verificando…" : "Continuar"}
        </Button>
      </form>
    </MarcoAcceso>
  );
}
