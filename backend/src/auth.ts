import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { query } from './db.js';

export type Role = 'administrador' | 'operador' | 'lector';
// Una sesión completa vence por dos cosas: el tope absoluto (8 h desde el código MFA, no se extiende) y la inactividad
// (SESION_INACTIVIDAD_MIN, 30 por defecto, sin actividad real de la persona). Gana la que llegue primero.
export const SESION_ABS_S = 8 * 3600;
const inactMin = Number(process.env.SESION_INACTIVIDAD_MIN ?? 30);
export const SESION_INACTIVIDAD_S = (Number.isFinite(inactMin) && inactMin >= 1 ? inactMin : 30) * 60;

/** absolutaS / inactividadS: segundos que le quedan a la sesión por cada causa. */
export type Session = { userId: number; username: string; role: Role; mfaEnabled: boolean; pending: boolean; debeCambiar: boolean; absolutaS: number; inactividadS: number };

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

// Si el usuario no existe se verifica igual contra un hash falso: así no se distingue "usuario inexistente" por el tiempo de respuesta.
const dummyHash = await argon2.hash('relleno-contra-ataques-de-tiempo', { type: argon2.argon2id });
export async function checkPassword(hash: string | undefined, pw: string): Promise<boolean> {
  const ok = await argon2.verify(hash ?? dummyHash, pw).catch(() => false);
  return hash !== undefined && ok;
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

// Solo se guarda el hash del token: una filtración de la base no sirve para entrar.
export async function createSession(userId: number, pending: boolean): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, pending)
     VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
    [sha(token), userId, pending ? 5 : 8 * 60, pending],
  );
  return token;
}

export async function getSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const rows = await query<{ user_id: number; username: string; role: Role; mfa_enabled: boolean; pending: boolean; debe: boolean; abs_s: number; idle_s: number }>(
    `SELECT u.id AS user_id, u.username, u.role, u.mfa_enabled, s.pending, u.debe_cambiar_clave AS debe,
            GREATEST(0, EXTRACT(EPOCH FROM (s.expires_at - now())))::int AS abs_s,
            GREATEST(0, EXTRACT(EPOCH FROM (s.last_seen_at - now())) + $2::int)::int AS idle_s
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active
        AND (s.pending OR s.last_seen_at > now() - make_interval(secs => $2::int))`,
    [sha(token), SESION_INACTIVIDAD_S],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, username: r.username, role: r.role, mfaEnabled: r.mfa_enabled, pending: r.pending, debeCambiar: r.debe, absolutaS: r.abs_s, inactividadS: r.idle_s } : null;
}

export async function deleteSession(token: string | undefined) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
}

// Cierra todas las sesiones de una persona (menos la indicada): al cambiar o restablecer la clave, desactivar, etc.
export const deleteUserSessions = (userId: number, exceptToken?: string) =>
  query('DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)', [userId, exceptToken ? sha(exceptToken) : null]);

// Latido: la persona sigue ahí. Solo se llama tras validar la sesión; las consultas de fondo NO pasan por aquí.
export const tocarSesion = (token: string) => query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [sha(token)]);

export const purgeExpiredSessions = () => query('DELETE FROM sessions WHERE expires_at < now() OR (NOT pending AND last_seen_at < now() - make_interval(secs => $1::int))', [SESION_INACTIVIDAD_S]);

// --- Bloqueo por intentos fallidos: 8 en 15 min => bloqueo de 15 min ---
const MAX = 8, WINDOW_MIN = 15, LOCK_MIN = 15;

export async function lockedSeconds(key: string): Promise<number | null> {
  const r = await query<{ s: number }>(
    `SELECT GREATEST(0, EXTRACT(EPOCH FROM (locked_until - now())))::int AS s
       FROM auth_rate_limits WHERE rate_key = $1 AND locked_until > now()`,
    [key],
  );
  return r[0]?.s ?? null;
}

export async function recordFailure(key: string) {
  const fresh = 'auth_rate_limits.window_started_at < now() - make_interval(mins => $2)';
  await query(
    `INSERT INTO auth_rate_limits (rate_key, attempts, window_started_at, locked_until, updated_at)
     VALUES ($1, 1, now(), NULL, now())
     ON CONFLICT (rate_key) DO UPDATE SET
       attempts = CASE WHEN ${fresh} THEN 1 ELSE auth_rate_limits.attempts + 1 END,
       window_started_at = CASE WHEN ${fresh} THEN now() ELSE auth_rate_limits.window_started_at END,
       locked_until = CASE WHEN (CASE WHEN ${fresh} THEN 1 ELSE auth_rate_limits.attempts + 1 END) >= $3
                           THEN now() + make_interval(mins => $4) ELSE NULL END,
       updated_at = now()`,
    [key, WINDOW_MIN, MAX, LOCK_MIN],
  );
}

export const clearFailures = (key: string) => query('DELETE FROM auth_rate_limits WHERE rate_key = $1', [key]);

export async function audit(action: string, who: { userId?: number; username?: string; ip?: string; detail?: unknown }) {
  await query('INSERT INTO audit_log (user_id, username, action, detail, ip) VALUES ($1, $2, $3, $4, $5)', [
    who.userId ?? null, who.username ?? null, action, who.detail ? JSON.stringify(who.detail) : null, who.ip ?? null,
  ]);
}
