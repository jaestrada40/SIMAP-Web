import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck } from "lucide-react";
import { iniciarAltaMfa, pasoMfa, verificarMfa } from "@/services/api";
import { useAuth } from "@/components/auth-context";
import { MarcoAcceso } from "@/components/marco-acceso";
import type * as React from "react";

export const Route = createFileRoute("/login/mfa")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verificación en dos pasos · SIMAP-Web" },
      { name: "description", content: "Ingrese su código de verificación." },
      { property: "og:title", content: "Verificación en dos pasos · SIMAP-Web" },
      { property: "og:description", content: "Ingrese su código de verificación." },
    ],
  }),
  component: Mfa,
});

function Mfa() {
  const navigate = useNavigate();
  const { establecer } = useAuth();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [alta, setAlta] = useState<{ uri: string; secret: string } | null>(null);
  const [esAlta, setEsAlta] = useState(false);
  const pedido = useRef(false); // el alta cambia el secreto: pedirla una sola vez

  useEffect(() => {
    const paso = pasoMfa();
    if (!paso) {
      navigate({ to: "/login", replace: true });
      return;
    }
    setEsAlta(paso === "enroll");
    if (paso === "enroll" && !pedido.current) {
      pedido.current = true;
      iniciarAltaMfa().then((a) => (a ? setAlta(a) : navigate({ to: "/login", replace: true })));
    }
  }, [navigate]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    const u = await verificarMfa(codigo);
    setCargando(false);
    if (!u) {
      setError("Código incorrecto. Intente de nuevo.");
      setCodigo("");
      return;
    }
    establecer(u);
    navigate({ to: "/panel", replace: true });
  }

  return (
    <MarcoAcceso>
      <form onSubmit={enviar} className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold">Verificación en dos pasos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ingrese el código de 6 dígitos de su aplicación autenticadora.</p>
        </div>
        {esAlta && (
          <div className="space-y-2 text-center text-sm">
            <p>Primera vez: escanee este código con su aplicación autenticadora (Google Authenticator, Authy, 1Password…) y escriba el código que le muestre.</p>
            {alta ? (
              <>
                <div className="flex justify-center rounded-md bg-white p-3">
                  <QRCodeSVG value={alta.uri} size={168} />
                </div>
                <p className="text-xs text-muted-foreground">
                  ¿No puede escanear? Clave manual: <code className="select-all break-all">{alta.secret}</code>
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Preparando…</p>
            )}
          </div>
        )}
        <div className="flex flex-col items-center gap-2">
          <InputOTP maxLength={6} value={codigo} onChange={setCodigo} aria-label="Código de verificación" autoFocus>
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-12 w-11 rounded-lg border border-input bg-muted/40 text-xl font-semibold first:rounded-lg first:border last:rounded-lg"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <p className="text-xs text-muted-foreground">El código cambia cada 30 segundos.</p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={codigo.length !== 6 || cargando}>
          {cargando ? "Verificando…" : "Verificar"}
        </Button>
        <Link to="/login" className="block text-center text-sm text-primary underline-offset-4 hover:underline">
          Volver
        </Link>
      </form>
    </MarcoAcceso>
  );
}
