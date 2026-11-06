import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { audit, checkPassword, clearFailures, deleteUserSessions, getSession, hashPassword, lockedSeconds, recordFailure, type Role } from '../auth.js';
import { query } from '../db.js';
import { requireRole } from './auth.js';

type Fila = { id: number; username: string; nombre: string | null; correo: string | null; role: Role; active: boolean; mfa_enabled: boolean; ultimo_acceso: Date | null };

// Misma forma que `Usuario` del frontend.
const aUsuario = (f: Fila) => ({
  id: String(f.id), usuario: f.username, nombre: f.nombre ?? f.username, correo: f.correo ?? '', rol: f.role, activo: f.active,
  mfa: f.mfa_enabled, ultimoAcceso: f.ultimo_acceso?.toISOString() ?? null,
});
const COLS = 'id, username, nombre, correo, role, active, mfa_enabled, ultimo_acceso';

const ROLES = ['administrador', 'operador', 'lector'] as const;
const crearBody = z.object({
  usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, 'Usuario: 3 a 40 letras minúsculas, números, punto, guion o guion bajo.'),
  nombre: z.string().trim().min(1).max(120),
  correo: z.string().trim().email().max(200),
  rol: z.enum(ROLES),
});
const cambiarBody = z.object({
  rol: z.enum(ROLES).optional(), activo: z.boolean().optional(),
  nombre: z.string().trim().min(1).max(120).optional(), correo: z.string().trim().email().max(200).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar');
const eliminarBody = z.object({ confirmacion: z.string().max(100).optional() }).default({});
const claveBody = z.object({ actual: z.string().min(1).max(256), nueva: z.string().min(12, 'La nueva contraseña debe tener al menos 12 caracteres.').max(256) });

/**
 * Siempre debe quedar al menos un administrador activo. Dice si el cambio dejaría al sistema sin ninguno
 * (desactivar, quitar el rol de administrador o eliminar al único administrador activo).
 */
export function dejaSinAdmin(todos: { id: number; role: Role; active: boolean }[], id: number, cambio: { rol?: Role; activo?: boolean; eliminar?: boolean }): boolean {
  const u = todos.find((x) => x.id === id);
  if (!u || u.role !== 'administrador' || !u.active) return false; // no era un administrador activo: no se pierde ninguno
  const sigue = !cambio.eliminar && cambio.activo !== false && (cambio.rol === undefined || cambio.rol === 'administrador');
  return !sigue && !todos.some((x) => x.id !== id && x.role === 'administrador' && x.active);
}

// Clave temporal: aleatoria, se muestra una sola vez y solo sirve para fijar la definitiva.
const claveTemporal = () => randomBytes(12).toString('base64url');
const idDe = (p: string) => (/^\d{1,9}$/.test(p) ? Number(p) : null);
const mensajeZod = (e: z.ZodError) => e.issues[0]?.message ?? 'Datos inválidos';

export async function usuariosRoutes(app: FastifyInstance) {
  app.get('/api/usuarios', async (req, reply) => {
    if (!(await requireRole(req, reply, ['administrador']))) return;
    return (await query<Fila>(`SELECT ${COLS} FROM users ORDER BY username`)).map(aUsuario);
  });

  app.post('/api/usuarios', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const b = crearBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: mensajeZod(b.error) });
    const clave = claveTemporal();
    const r = await query<{ id: number }>(
      `INSERT INTO users (username, password_hash, role, nombre, correo, debe_cambiar_clave) VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (username) DO NOTHING RETURNING id`, [b.data.usuario, await hashPassword(clave), b.data.rol, b.data.nombre, b.data.correo]);
    if (!r[0]) return reply.code(409).send({ error: 'Ya existe un usuario con ese nombre.' });
    await audit('usuario_creado', { userId: s.userId, username: s.username, ip: req.ip, detail: { usuario: b.data.usuario, rol: b.data.rol } });
    return { id: String(r[0].id), usuario: b.data.usuario, claveTemporal: clave };
  });

  const todosLosUsuarios = () => query<{ id: number; role: Role; active: boolean }>('SELECT id, role, active FROM users');

  app.patch<{ Params: { id: string } }>('/api/usuarios/:id', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const id = idDe(req.params.id);
    const b = cambiarBody.safeParse(req.body);
    if (id === null || !b.success) return reply.code(400).send({ error: b.success ? 'Datos inválidos' : mensajeZod(b.error) });
    const u = (await query<Fila>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]))[0];
    if (!u) return reply.code(404).send({ error: 'El usuario no existe.' });
    // Nombre y correo sí puede editarse uno mismo; el rol y el estado, no (nadie se quita su propio acceso).
    if (id === s.userId && (b.data.rol !== undefined || b.data.activo !== undefined)) return reply.code(409).send({ error: 'No puede cambiar su propio rol ni desactivarse.' });
    const cambio = { ...(b.data.rol !== undefined && { rol: b.data.rol }), ...(b.data.activo !== undefined && { activo: b.data.activo }) };
    if (dejaSinAdmin(await todosLosUsuarios(), id, cambio)) return reply.code(409).send({ error: 'Debe quedar al menos un administrador activo.' });
    await query('UPDATE users SET role = COALESCE($2, role), active = COALESCE($3, active), nombre = COALESCE($4, nombre), correo = COALESCE($5, correo) WHERE id = $1',
      [id, b.data.rol ?? null, b.data.activo ?? null, b.data.nombre ?? null, b.data.correo ?? null]);
    if (b.data.activo === false) await deleteUserSessions(id);
    await audit('usuario_modificado', { userId: s.userId, username: s.username, ip: req.ip, detail: {
      usuario: u.username, ...(b.data.rol && { rol: b.data.rol }), ...(b.data.activo !== undefined && { activo: b.data.activo }),
      ...((b.data.nombre !== undefined || b.data.correo !== undefined) && { datos: true }) } });
    return { ok: true };
  });

  // Eliminar de verdad (sus sesiones caen en cascada). La auditoría conserva su nombre como texto, así que el historial no se pierde.
  app.post<{ Params: { id: string } }>('/api/usuarios/:id/eliminar', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const id = idDe(req.params.id);
    const b = eliminarBody.safeParse(req.body ?? {});
    if (id === null || !b.success) return reply.code(400).send({ error: 'Datos inválidos' });
    if (id === s.userId) return reply.code(409).send({ error: 'No puede eliminar su propia cuenta.' });
    const u = (await query<{ username: string }>('SELECT username FROM users WHERE id = $1', [id]))[0];
    if (!u) return reply.code(404).send({ error: 'El usuario no existe.' });
    if (b.data.confirmacion !== u.username) return reply.code(400).send({ error: 'Confirmación incorrecta: escriba exactamente el nombre de usuario.' });
    if (dejaSinAdmin(await todosLosUsuarios(), id, { eliminar: true })) return reply.code(409).send({ error: 'Debe quedar al menos un administrador activo.' });
    await query('DELETE FROM users WHERE id = $1', [id]);
    await audit('usuario_eliminado', { userId: s.userId, username: s.username, ip: req.ip, detail: { usuario: u.username } });
    return { ok: true };
  });

  // Acciones sobre OTRA persona (para la propia cuenta está la pantalla Seguridad).
  async function sobreOtro(req: { params: { id: string } }, reply: FastifyReply, s: { userId: number }) {
    const id = idDe(req.params.id);
    if (id === null) { reply.code(400).send({ error: 'Datos inválidos' }); return null; }
    if (id === s.userId) { reply.code(409).send({ error: 'Para su propia cuenta use la pantalla Seguridad.' }); return null; }
    const u = (await query<{ username: string }>('SELECT username FROM users WHERE id = $1', [id]))[0];
    if (!u) { reply.code(404).send({ error: 'El usuario no existe.' }); return null; }
    return { id, username: u.username };
  }

  app.post<{ Params: { id: string } }>('/api/usuarios/:id/restablecer-clave', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const u = await sobreOtro(req, reply, s);
    if (!u) return;
    const clave = claveTemporal();
    await query('UPDATE users SET password_hash = $2, debe_cambiar_clave = true WHERE id = $1', [u.id, await hashPassword(clave)]);
    await deleteUserSessions(u.id);
    await query('DELETE FROM auth_rate_limits WHERE rate_key LIKE $1', [`%:${u.username}`]); // por si estaba bloqueado
    await audit('clave_restablecida', { userId: s.userId, username: s.username, ip: req.ip, detail: { usuario: u.username } });
    return { claveTemporal: clave };
  });

  // Si perdió el teléfono: en el próximo inicio de sesión vuelve a registrar su aplicación autenticadora.
  app.post<{ Params: { id: string } }>('/api/usuarios/:id/restablecer-mfa', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador']);
    if (!s) return;
    const u = await sobreOtro(req, reply, s);
    if (!u) return;
    await query('UPDATE users SET mfa_secret = NULL, mfa_enabled = false, mfa_last_step = NULL WHERE id = $1', [u.id]);
    await deleteUserSessions(u.id);
    await audit('mfa_restablecido', { userId: s.userId, username: s.username, ip: req.ip, detail: { usuario: u.username } });
    return { ok: true };
  });

  // Cambio de la clave propia (todos los roles). Es lo único permitido mientras la clave es temporal.
  app.post('/api/cambiar-clave', async (req, reply) => {
    const s = await getSession(req.cookies.sid);
    if (!s || s.pending) return reply.code(401).send({ error: 'No autenticado' });
    const b = claveBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: mensajeZod(b.error) });
    const limite = `clave:${req.ip}:${s.userId}`;
    const bloqueado = await lockedSeconds(limite);
    if (bloqueado !== null) return reply.code(429).header('Retry-After', String(bloqueado)).send({ error: `Demasiados intentos. Intente de nuevo en ${bloqueado} segundos.` });
    const hash = (await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [s.userId]))[0]?.password_hash;
    if (!(await checkPassword(hash, b.data.actual))) {
      await recordFailure(limite);
      return reply.code(403).send({ error: 'La contraseña actual es incorrecta.' });
    }
    if (b.data.nueva === b.data.actual) return reply.code(400).send({ error: 'La nueva contraseña debe ser distinta de la actual.' });
    await clearFailures(limite);
    await query('UPDATE users SET password_hash = $2, debe_cambiar_clave = false WHERE id = $1', [s.userId, await hashPassword(b.data.nueva)]);
    await deleteUserSessions(s.userId, req.cookies.sid); // las demás sesiones (otros equipos) se cierran
    await audit('clave_cambiada', { userId: s.userId, username: s.username, ip: req.ip });
    return { ok: true };
  });
}
