import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-context";
import { cambiarClave } from "@/services/api";

export const Route = createFileRoute("/_authenticated/seguridad")({
  head: () => ({
    meta: [
      { title: "Seguridad · SIMAP-Web" },
      { name: "description", content: "Cambio de contraseña y verificación en dos pasos." },
      { property: "og:title", content: "Seguridad · SIMAP-Web" },
      { property: "og:description", content: "Cambio de contraseña y verificación en dos pasos." },
    ],
  }),
  component: Seguridad,
});

function Seguridad() {
  const { usuario, establecer } = useAuth();
  const navigate = useNavigate();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [enviando, setEnviando] = useState(false);
  const obligatorio = !!usuario?.debeCambiar;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (nueva.length < 12) { toast.error("La nueva contraseña debe tener al menos 12 caracteres."); return; }
    if (nueva !== repetir) { toast.error("Las contraseñas no coinciden."); return; }
    setEnviando(true);
    try {
      await cambiarClave(actual, nueva); // el servidor valida todo otra vez
      toast.success("Contraseña actualizada");
      setActual(""); setNueva(""); setRepetir("");
      if (usuario) establecer({ ...usuario, debeCambiar: false });
      if (obligatorio) navigate({ to: "/panel", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Seguridad</h1>
      {obligatorio && (
        <Alert variant="destructive" className="border-2">
          <KeyRound className="h-5 w-5" />
          <AlertTitle className="text-base font-bold">Debe cambiar su contraseña</AlertTitle>
          <AlertDescription>Está usando una contraseña temporal. Defina una nueva para poder usar el sistema: escriba la temporal en "Contraseña actual".</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cambiar contraseña</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={enviar}>
              <div className="space-y-1"><Label htmlFor="a">Contraseña actual</Label><PasswordInput id="a" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required /></div>
              <div className="space-y-1"><Label htmlFor="n">Nueva contraseña (mínimo 12 caracteres)</Label><PasswordInput id="n" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} required /></div>
              <div className="space-y-1"><Label htmlFor="r">Repetir nueva contraseña</Label><PasswordInput id="r" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} required /></div>
              <Button type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Actualizar contraseña"}</Button>
              <p className="text-xs text-muted-foreground">Al cambiarla se cierran sus sesiones abiertas en otros equipos.</p>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Verificación en dos pasos (MFA)</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Activa en su cuenta</p>
            <p className="text-muted-foreground">
              El código de 6 dígitos se pide en cada inicio de sesión. Si cambió o perdió el teléfono, pida a un administrador que restablezca su MFA: en su próximo inicio de sesión podrá registrar la aplicación autenticadora otra vez.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
