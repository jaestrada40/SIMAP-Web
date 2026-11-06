import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, KeyRound, Pencil, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CargandoTabla, ErrorTabla } from "@/components/data-state";
import { Paginacion, usePaginacion } from "@/components/paginacion";
import { useAuth } from "@/components/auth-context";
import { cambiarEstadoUsuario, cambiarRolUsuario, crearUsuario, editarUsuario, eliminarUsuario, listarUsuarios, restablecerClave, restablecerMfa } from "@/services/api";
import { ROL_TEXTO, fechaHora, puede } from "@/lib/simap";
import type { Rol, Usuario } from "@/types";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuarios · SIMAP-Web" },
      { name: "description", content: "Administración de usuarios y roles." },
      { property: "og:title", content: "Usuarios · SIMAP-Web" },
      { property: "og:description", content: "Administración de usuarios y roles." },
    ],
  }),
  component: Usuarios,
});

type Pendiente = { tipo: "clave" | "mfa"; u: Usuario };
const aviso = (e: unknown) => toast.error(e instanceof Error ? e.message : "No se pudo completar la acción");

function Usuarios() {
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["usuarios"], queryFn: listarUsuarios });
  const [alta, setAlta] = useState(false);
  const [form, setForm] = useState({ usuario: "", nombre: "", correo: "", rol: "lector" as Rol });
  const [enviando, setEnviando] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [clave, setClave] = useState<{ usuario: string; clave: string; motivo: string } | null>(null);
  const [edicion, setEdicion] = useState<{ u: Usuario; nombre: string; correo: string } | null>(null);
  const [borrar, setBorrar] = useState<{ u: Usuario; texto: string } | null>(null);
  const { visibles, pag } = usePaginacion(q.data ?? []);

  if (!puede.administrar(usuario?.rol)) return <Navigate to="/sin-permisos" />;

  const refrescar = () => qc.invalidateQueries({ queryKey: ["usuarios"] });

  async function confirmar() {
    if (!pendiente) return;
    const { tipo, u } = pendiente;
    setPendiente(null);
    try {
      if (tipo === "clave") {
        const r = await restablecerClave(u.id);
        setClave({ usuario: u.usuario, clave: r.claveTemporal, motivo: "restablecida" });
      } else {
        await restablecerMfa(u.id);
        toast.success(`MFA de ${u.usuario} restablecido: lo registrará de nuevo en su próximo inicio de sesión.`);
      }
      await refrescar();
    } catch (e) {
      aviso(e);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-muted-foreground">Administrador: todo · Operador: ejecuta actualizaciones · Lector: solo ve.</p>
        </div>
        <Button onClick={() => setAlta(true)}><UserPlus className="h-4 w-4" /> Nuevo usuario</Button>
      </div>
      <Card className="overflow-x-auto">
        {q.isLoading ? <CargandoTabla filas={4} /> : q.isError ? <ErrorTabla reintentar={() => q.refetch()} /> : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead><TableHead>Nombre</TableHead><TableHead>Correo</TableHead><TableHead>Rol</TableHead>
                <TableHead>MFA</TableHead><TableHead>Último acceso</TableHead><TableHead>Activo</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((u) => {
                const yo = u.usuario === usuario?.usuario;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.usuario}{yo && <span className="status-pill status-neutral ml-1.5">Usted</span>}</TableCell>
                    <TableCell>{u.nombre}</TableCell>
                    <TableCell className="text-sm">{u.correo || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={u.rol}
                        disabled={yo}
                        onValueChange={async (v) => {
                          try { await cambiarRolUsuario(u.id, v as Rol); toast.success(`${u.usuario} ahora es ${ROL_TEXTO[v as Rol]}`); } catch (e) { aviso(e); }
                          await refrescar();
                        }}
                      >
                        <SelectTrigger className="h-8 w-36" aria-label={`Rol de ${u.usuario}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROL_TEXTO) as Rol[]).map((r) => <SelectItem key={r} value={r}>{ROL_TEXTO[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{u.mfa ? <span className="status-pill status-ok">Activo</span> : <span className="status-pill status-neutral">Sin activar</span>}</TableCell>
                    <TableCell className="text-sm">{u.ultimoAcceso ? fechaHora(u.ultimoAcceso) : "Nunca"}</TableCell>
                    <TableCell>
                      <Switch
                        aria-label={`${u.activo ? "Desactivar" : "Activar"} ${u.usuario}`}
                        checked={u.activo}
                        disabled={yo}
                        onCheckedChange={async (v) => {
                          try { await cambiarEstadoUsuario(u.id, v); } catch (e) { aviso(e); }
                          await refrescar();
                        }}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button size="icon" variant="ghost" aria-label={`Editar ${u.usuario}`} onClick={() => setEdicion({ u, nombre: u.nombre, correo: u.correo })}><Pencil className="h-4 w-4" /></Button>
                      {!yo && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setPendiente({ tipo: "clave", u })}><KeyRound className="h-4 w-4" /> Restablecer contraseña</Button>
                          <Button size="sm" variant="ghost" disabled={!u.mfa} onClick={() => setPendiente({ tipo: "mfa", u })}><ShieldOff className="h-4 w-4" /> Restablecer MFA</Button>
                          <Button size="icon" variant="ghost" aria-label={`Eliminar ${u.usuario}`} onClick={() => setBorrar({ u, texto: "" })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Paginacion pag={pag} />
          </>
        )}
      </Card>

      <Dialog open={alta} onOpenChange={setAlta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
            <DialogDescription>Se genera una contraseña temporal que verá una sola vez. En su primer ingreso deberá cambiarla y registrar su verificación en dos pasos.</DialogDescription>
          </DialogHeader>
          <form
            id="alta"
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setEnviando(true);
              try {
                const r = await crearUsuario({ ...form, usuario: form.usuario.trim().toLowerCase() });
                setAlta(false);
                setForm({ usuario: "", nombre: "", correo: "", rol: "lector" });
                setClave({ usuario: r.usuario, clave: r.claveTemporal, motivo: "creado" });
                await refrescar();
              } catch (err) {
                aviso(err);
              } finally {
                setEnviando(false);
              }
            }}
          >
            {(["usuario", "nombre", "correo"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={k} className="capitalize">{k === "correo" ? "Correo electrónico" : k}</Label>
                <Input id={k} type={k === "correo" ? "email" : "text"} required autoComplete="off" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <div className="space-y-1">
              <Label>Rol</Label>
              <Select value={form.rol} onValueChange={(v) => setForm({ ...form, rol: v as Rol })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROL_TEXTO) as Rol[]).map((r) => <SelectItem key={r} value={r}>{ROL_TEXTO[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlta(false)}>Cancelar</Button>
            <Button type="submit" form="alta" disabled={enviando}>{enviando ? "Creando…" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendiente} onOpenChange={(o) => !o && setPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendiente?.tipo === "clave" ? "¿Restablecer la contraseña?" : "¿Restablecer el MFA?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendiente?.tipo === "clave"
                ? `Se genera una contraseña temporal para ${pendiente.u.usuario} y se cierran sus sesiones abiertas. Deberá cambiarla al entrar.`
                : `${pendiente?.u.usuario} tendrá que registrar de nuevo su aplicación autenticadora en el próximo inicio de sesión, y se cierran sus sesiones abiertas.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>Restablecer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!edicion} onOpenChange={(o) => !o && setEdicion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {edicion?.u.usuario}</DialogTitle>
            <DialogDescription>El nombre de usuario no se puede cambiar. El rol y el estado se cambian en la tabla.</DialogDescription>
          </DialogHeader>
          <form
            id="edicion"
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!edicion) return;
              try {
                await editarUsuario(edicion.u.id, { nombre: edicion.nombre, correo: edicion.correo });
                setEdicion(null);
                toast.success("Datos guardados");
                await refrescar();
              } catch (err) {
                aviso(err);
              }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="e-nombre">Nombre</Label>
              <Input id="e-nombre" required autoComplete="off" value={edicion?.nombre ?? ""} onChange={(e) => edicion && setEdicion({ ...edicion, nombre: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-correo">Correo electrónico</Label>
              <Input id="e-correo" type="email" required autoComplete="off" value={edicion?.correo ?? ""} onChange={(e) => edicion && setEdicion({ ...edicion, correo: e.target.value })} />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdicion(null)}>Cancelar</Button>
            <Button type="submit" form="edicion">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {borrar?.u.usuario}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la cuenta y se cierran sus sesiones. No se puede deshacer; si solo quiere quitarle el acceso, desactívela con el interruptor. El historial de lo que hizo se conserva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="c-borrar" className="text-xs">Escriba <b>{borrar?.u.usuario}</b> para confirmar</Label>
            <Input id="c-borrar" autoComplete="off" value={borrar?.texto ?? ""} onChange={(e) => borrar && setBorrar({ ...borrar, texto: e.target.value })} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={borrar?.texto !== borrar?.u.usuario}
              onClick={async () => {
                if (!borrar) return;
                const { u, texto } = borrar;
                setBorrar(null);
                try {
                  await eliminarUsuario(u.id, texto);
                  toast.success(`Usuario ${u.usuario} eliminado`);
                } catch (err) {
                  aviso(err);
                }
                await refrescar();
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!clave} onOpenChange={(o) => !o && setClave(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contraseña temporal {clave?.motivo === "creado" ? "del nuevo usuario" : "restablecida"}</DialogTitle>
            <DialogDescription>Usuario <b>{clave?.usuario}</b>. Entréguesela por un canal seguro.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={clave?.clave ?? ""} className="font-mono" aria-label="Contraseña temporal" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="icon" aria-label="Copiar contraseña" onClick={() => navigator.clipboard.writeText(clave?.clave ?? "").then(() => toast.success("Copiada"), () => toast.error("No se pudo copiar"))}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Alert>
            <AlertDescription>Se muestra <b>una sola vez</b>: al cerrar esta ventana no se puede volver a ver (solo restablecerla). Debe cambiarla en su primer ingreso.</AlertDescription>
          </Alert>
          <DialogFooter><Button onClick={() => setClave(null)}>Listo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
