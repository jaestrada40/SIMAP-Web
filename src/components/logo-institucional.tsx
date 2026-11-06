import { useQuery } from "@tanstack/react-query";
import { obtenerLogos, type LugarLogo } from "@/services/api";

/** Logo subido en Configuración para ese lugar; null si no hay (quien lo use muestra el texto de siempre). */
export function LogoInstitucional({ lugar, className }: { lugar: LugarLogo; className?: string }) {
  const logos = useQuery({ queryKey: ["logos"], queryFn: obtenerLogos, staleTime: 60_000 });
  const version = logos.data?.[lugar];
  if (!version) return null;
  return <img src={`/api/logos/${lugar}?v=${version}`} alt="Logo institucional" className={className} />;
}

