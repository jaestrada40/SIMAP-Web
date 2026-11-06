import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { audit, checkPassword, clearFailures, createSession, deleteSession, getSession, lockedSeconds, purgeExpiredSessions, recordFailure, SESION_ABS_S, SESION_INACTIVIDAD_S, tocarSesion, type Role, type Session } from '../auth.js';
import { decrypt, encrypt } from '../crypto.js';
import { keyUri, matchTotp, newSecret } from '../totp.js';

const credentials = z.object({ username: z.string().min(1).max(120), password: z.string().min(1).max(256) });
const codeBody = z.object({ code: z.string().regex(/^\d{6}$/) });

const setSid = (reply: FastifyReply, token: string, maxAgeSec: number) =>
  reply.setCookie('sid', token, { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'strict', path: '/', maxAge: maxAgeSec });

async function sessionOf(req: FastifyRequest, pending: boolean): Promise<Session | null> {
  const s = await getSession(req.cookies.sid);
  return s && s.pending === pending ? s : null;
}

const tooMany = (reply: FastifyReply, secs: number) =>
  reply.code(429).header('Retry-After', String(secs)).send({ error: `Demasiados intentos. Intenta de nuevo en ${secs} segundos.` });

export async function authRoutes(app: FastifyInstance) {
  // Paso 1: usuario y clave. Deja una sesión "pendiente" de 5 min; el acceso real llega solo tras el código MFA.
  app.post('/api/login', async (req, reply) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Credenciales requeridas' });
    const username = body.data.username.trim().toLowerCase();
    const limitKey = `login:${req.ip}:${username}`;
    const locked = await lockedSeconds(limitKey);
    if (locked !== null) return tooMany(reply, locked);

    const user = (await query<{ id: number; password_hash: string; active: boolean; mfa_enabled: boolean }>(
      'SELECT id, password_hash, active, mfa_enabled FROM users WHERE username = $1', [username]))[0];
    const ok = await checkPassword(user?.password_hash, body.data.password);
    if (!user || !user.active || !ok) {
      await recordFailure(limitKey);
      await audit('login_fallido', { username, ip: req.ip });
      return reply.code(401).send({ error: 'Credenciales inválidas' });
    }
    await clearFailures(limitKey);
    await purgeExpiredSessions();
    setSid(reply, await createSession(user.id, true), 300);
    return { step: user.mfa_enabled ? 'mfa' : 'enroll' };
  });

  // Alta del MFA: obligatoria para quien aún no lo tiene. Devuelve el secreto para el QR.
  app.post('/api/mfa/enroll', async (req, reply) => {
    const s = await sessionOf(req, true);
    if (!s || s.mfaEnabled) return reply.code(401).send({ error: 'No autenticado' });
    const secret = newSecret();
    await query('UPDATE users SET mfa_secret = $1, mfa_last_step = NULL WHERE id = $2', [encrypt(secret), s.userId]);
    return { secret, uri: keyUri(s.username, secret) };
  });

  // Paso 2: código MFA. Cambia la sesión pendiente por una completa (token nuevo, contra fijación de sesión).
  app.post('/api/mfa/verify', async (req, reply) => {
    const body = codeBody.safeParse(req.body);
    const s = await sessionOf(req, true);
    if (!body.success || !s) return reply.code(401).send({ error: 'Código inválido' });
    const limitKey = `mfa:${req.ip}:${s.userId}`;
    const locked = await lockedSeconds(limitKey);
    if (locked !== null) return tooMany(reply, locked);

    const row = (await query<{ mfa_secret: string | null }>('SELECT mfa_secret FROM users WHERE id = $1', [s.userId]))[0];
    const step = row?.mfa_secret ? matchTotp(decrypt(row.mfa_secret), body.data.code) : null;
    // El UPDATE solo avanza si el paso es mayor al último usado: un código no se puede reutilizar.
    const claimed = step === null ? 0 : (await query(
      'UPDATE users SET mfa_enabled = true, mfa_last_step = $1 WHERE id = $2 AND (mfa_last_step IS NULL OR mfa_last_step < $1) RETURNING id',
      [step, s.userId])).length;
    if (!claimed) {
      await recordFailure(limitKey);
      await audit('mfa_fallido', { userId: s.userId, username: s.username, ip: req.ip });
      return reply.code(401).send({ error: 'Código inválido' });
    }
    await clearFailures(limitKey);
    await deleteSession(req.cookies.sid);
    setSid(reply, await createSession(s.userId, false), 8 * 3600);
    await query('UPDATE users SET ultimo_acceso = now() WHERE id = $1', [s.userId]);
    await audit('login_ok', { userId: s.userId, username: s.username, ip: req.ip });
    return { ok: true, user: { username: s.username, role: s.role, debeCambiar: s.debeCambiar }, sesion: { absolutaS: SESION_ABS_S, inactividadS: SESION_INACTIVIDAD_S } };
  });

  app.get('/api/me', async (req, reply) => {
    const s = await sessionOf(req, false);
    if (!s) return reply.code(401).send({ error: 'No autenticado' });
    return { username: s.username, role: s.role, debeCambiar: s.debeCambiar, sesion: { absolutaS: s.absolutaS, inactividadS: s.inactividadS } };
  });

  // Latido de actividad real de la persona (el navegador lo manda a lo sumo una vez por minuto, y solo si hubo clic, teclado o desplazamiento).
  // El tope absoluto de 8 h no se mueve.
  app.post('/api/sesion/latido', async (req, reply) => {
    const s = await sessionOf(req, false);
    if (!s || !req.cookies.sid) return reply.code(401).send({ error: 'No autenticado' });
    await tocarSesion(req.cookies.sid);
    return { sesion: { absolutaS: s.absolutaS, inactividadS: SESION_INACTIVIDAD_S } };
  });

  app.post('/api/logout', async (req, reply) => {
    const s = await getSession(req.cookies.sid);
    await deleteSession(req.cookies.sid);
    if (s) await audit('logout', { userId: s.userId, username: s.username, ip: req.ip });
    return reply.clearCookie('sid', { path: '/' }).send({ ok: true });
  });
}

/** Para las rutas protegidas: exige sesión completa y, si se pide, un rol permitido. */
export async function requireRole(req: FastifyRequest, reply: FastifyReply, roles: Role[]): Promise<Session | null> {
  const s = await sessionOf(req, false);
  if (!s) { reply.code(401).send({ error: 'No autenticado' }); return null; }
  // Con clave temporal solo se puede cambiar la clave (/api/me, /api/cambiar-clave y /api/logout no pasan por aquí).
  if (s.debeCambiar) { reply.code(403).send({ error: 'Debe cambiar su contraseña antes de continuar.', codigo: 'cambiar_clave' }); return null; }
  if (!roles.includes(s.role)) { reply.code(403).send({ error: 'Sin permiso' }); return null; }
  return s;
}
