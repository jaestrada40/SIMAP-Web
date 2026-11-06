import { useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/auth-context";
import { latido } from "@/services/api";

const AVISO_MS = 120_000; // se avisa 2 minutos antes de que venza
const LATIDO_CADA_MS = 60_000; // a lo sumo un latido por minuto, y solo si hubo actividad
const REVISAR_CADA_MS = 5_000;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Vigila los plazos de la sesión. Detecta actividad REAL de la persona (clic, teclado, desplazamiento, toque) y se la avisa al servidor;
 * las consultas de fondo (la cola consulta cada segundo) no cuentan. El servidor es quien vence la sesión: aquí solo se avisa a tiempo.
 */
export function GuardiaSesion() {
  const { usuario, establecerVence } = useAuth();
  const [ahora, setAhora] = useState(() => Date.now());
  const [absolutoVisto, setAbsolutoVisto] = useState<number | null>(null);
  const hubo = useRef(false);
  const ultimo = useRef(Date.now());
  const enviando = useRef(false);
  const alActualizar = useRef(establecerVence);
  alActualizar.current = establecerVence;

  async function enviar() {
    if (enviando.current) return;
    enviando.current = true;
    ultimo.current = Date.now();
    hubo.current = false;
    try {
      const v = await latido();
      if (v) alActualizar.current(v);
    } finally {
      enviando.current = false;
    }
  }
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  useEffect(() => {
    const marca = () => { hubo.current = true; };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of eventos) window.addEventListener(e, marca, { passive: true });
    const t = setInterval(() => {
      const n = Date.now();
      setAhora(n);
      if (hubo.current && n - ultimo.current >= LATIDO_CADA_MS) void enviarRef.current();
    }, REVISAR_CADA_MS);
    return () => {
      for (const e of eventos) window.removeEventListener(e, marca);
      clearInterval(t);
    };
  }, []);

  const vence = usuario?.vence;
  if (!vence) return null;
  const restoInact = vence.inactividadEn - ahora;
  const restoAbs = vence.absolutoEn - ahora;
  const porInactividad = restoInact <= restoAbs;
  const resto = Math.min(restoInact, restoAbs);
  // Al llegar a 0 el servidor responde 401 y la pantalla va sola al login; aquí solo se avisa antes.
  // El tope absoluto no cambia, pero cada latido lo recalcula con unos milisegundos de diferencia: se compara con tolerancia
  // para que un aviso ya visto no reaparezca.
  const yaVisto = absolutoVisto !== null && Math.abs(vence.absolutoEn - absolutoVisto) < 10_000;
  const abierto = resto > 0 && resto <= AVISO_MS && (porInactividad || !yaVisto);

  return (
    <AlertDialog open={abierto}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{porInactividad ? "Su sesión está por vencer" : "Su sesión llegó al tiempo máximo"}</AlertDialogTitle>
          <AlertDialogDescription>
            {porInactividad
              ? <>Por seguridad, la sesión se cierra tras un rato sin actividad. Vence en <b>{mmss(resto)}</b>. Una cola de actualización que esté corriendo <b>no se interrumpe</b>: sigue en el servidor.</>
              : <>Por seguridad, cada sesión dura 8 horas como máximo y no se puede extender. Se cerrará en <b>{mmss(resto)}</b>: termine lo que esté haciendo. Podrá entrar de nuevo enseguida.</>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {porInactividad
            ? <AlertDialogAction onClick={() => void enviar()}>Seguir conectado</AlertDialogAction>
            : <AlertDialogAction onClick={() => setAbsolutoVisto(vence.absolutoEn)}>Entendido</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
