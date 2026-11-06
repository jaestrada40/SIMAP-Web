import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireRole } from './auth.js';

type Fila = { id: string; username: string | null; action: string; detail: Record<string, unknown> | null; ip: string | null; created_at: Date };

// Misma forma que `RegistroAuditoria` del frontend.
export type Registro = {
  id: string; fecha: string; usuario: string; portalId: string | null;
  accion: string; resultado: 'exito' | 'fallo' | 'info'; detalle: string;
};

const corto = (imagen: unknown) => (typeof imagen === 'string' && imagen.includes('@sha256:') ? `sha256:${imagen.split('@sha256:')[1]?.slice(0, 8)}…` : String(imagen ?? '?'));
const tipoTexto = (t: unknown) => (t === 'nucleo_php' ? 'Núcleo y PHP' : t === 'plugins' ? 'Plugins' : String(t ?? ''));
const lugarTexto = (l: unknown) => (l === 'sidebar' ? 'del menú lateral' : l === 'login' ? 'del inicio de sesión' : '');

export function aRegistro(f: Fila): Registro {
  const d = f.detail ?? {};
  const portalId = typeof d['portal'] === 'string' ? d['portal'] : null;
  const base = { id: String(f.id), fecha: f.created_at.toISOString(), usuario: f.username ?? 'sistema', portalId };
  const sim = d['simulacion'] ? ' · simulación' : '';
  const desde = f.ip ? ` (desde ${f.ip})` : '';
  switch (f.action) {
    case 'login_ok': return { ...base, accion: 'inicio_sesion', resultado: 'exito', detalle: `Inicio de sesión completo${desde}` };
    case 'login_fallido': return { ...base, accion: 'inicio_sesion', resultado: 'fallo', detalle: `Usuario o contraseña incorrectos${desde}` };
    case 'mfa_fallido': return { ...base, accion: 'inicio_sesion', resultado: 'fallo', detalle: `Código de verificación incorrecto${desde}` };
    case 'logout': return { ...base, accion: 'cierre_sesion', resultado: 'info', detalle: `Cierre de sesión${desde}` };
    case 'revision': return { ...base, accion: 'revision', resultado: d['estado'] === 'ok' ? 'exito' : 'fallo', detalle: `Revisión de ${portalId ?? 'portales'}: ${String(d['estado'] ?? '')}` };
    case 'actualizacion_iniciada': return { ...base, accion: 'actualizacion_iniciada', resultado: 'info', detalle: `${tipoTexto(d['tipo'])}${sim}` };
    case 'actualizacion_completada': return { ...base, accion: 'actualizacion_completada', resultado: 'exito', detalle: `${tipoTexto(d['tipo'])}${sim}` };
    case 'actualizacion_fallida': return { ...base, accion: 'actualizacion_fallida', resultado: 'fallo', detalle: `${tipoTexto(d['tipo'])}${sim} · paso "${String(d['paso'] ?? '?')}"${typeof d['detalle'] === 'string' ? `: ${d['detalle'].replace(/^\d{1,2}:\d{2}:\d{2}\s*[ap]\.?\s?m\.?\s+(\[SIMULACIÓN\]\s+)?/i, '')}` : ''}` };
    case 'reintento': return { ...base, accion: 'reintento', resultado: 'info', detalle: `Reintento desde el paso "${String(d['desdePaso'] ?? '?')}"` };
    case 'vuelta_atras': return { ...base, accion: 'vuelta_atras', resultado: d['sitio_ok'] === false ? 'fallo' : 'exito', detalle: `Imagen ${corto(d['desde'])} → ${corto(d['hacia'])}; sitio ${d['sitio_ok'] === false ? 'con problemas' : 'responde bien'}` };
    case 'logo_cambiado': return { ...base, accion: 'cambio_logo', resultado: 'exito', detalle: `Logo ${lugarTexto(d['lugar'])} actualizado` };
    case 'logo_quitado': return { ...base, accion: 'cambio_logo', resultado: 'exito', detalle: `Logo ${lugarTexto(d['lugar'])} quitado` };
    case 'usuario_creado': return { ...base, accion: 'cambio_usuario', resultado: 'exito', detalle: `Usuario ${String(d['usuario'])} creado con rol ${String(d['rol'])}` };
    case 'usuario_modificado': return { ...base, accion: 'cambio_usuario', resultado: 'exito', detalle: `Usuario ${String(d['usuario'])}: ${[d['rol'] !== undefined && `rol ${String(d['rol'])}`, d['activo'] !== undefined && (d['activo'] ? 'activado' : 'desactivado'), d['datos'] === true && 'datos de contacto actualizados'].filter(Boolean).join(', ')}` };
    case 'portal_creado': return { ...base, accion: 'cambio_configuracion', resultado: 'exito', detalle: `Portal ${String(d['nombre'] ?? portalId)} ${d['reactivado'] ? 'reactivado' : 'agregado'} (${String(d['proyecto'])}/${String(d['deployment'])})` };
    case 'portal_modificado': return { ...base, accion: 'cambio_configuracion', resultado: 'exito', detalle: `Datos del portal ${String(portalId)} actualizados${d['destinoCambiado'] ? ' (cambió proyecto, deployment o contenedor)' : ''}` };
    case 'portal_baja': return { ...base, accion: 'cambio_configuracion', resultado: 'exito', detalle: `Portal ${String(portalId)} dado de baja` };
    case 'respaldo_manual': return { ...base, accion: 'respaldo', resultado: 'exito', detalle: `Respaldo de la base de ${String(portalId)} hecho a pedido` };
    case 'respaldo_descargado': return { ...base, accion: 'respaldo', resultado: 'exito', detalle: `Respaldo de la base de ${String(portalId)} descargado (${Math.round(Number(d['bytes'] ?? 0) / 1024 / 1024 * 10) / 10} MB comprimido)` };
    case 'respaldo_updraft_iniciado': return { ...base, accion: 'respaldo', resultado: 'info', detalle: `Copia completa de UpdraftPlus iniciada en ${String(portalId)}` };
    case 'respaldo_updraft_descargado': return { ...base, accion: 'respaldo', resultado: 'exito', detalle: `Descargó ${String(d['archivo'])} de ${String(portalId)} (${Math.round(Number(d['bytes'] ?? 0) / 1024 / 1024 * 10) / 10} MB)` };
    case 'usuario_eliminado': return { ...base, accion: 'cambio_usuario', resultado: 'exito', detalle: `Usuario ${String(d['usuario'])} eliminado` };
    case 'clave_restablecida': return { ...base, accion: 'cambio_usuario', resultado: 'exito', detalle: `Contraseña de ${String(d['usuario'])} restablecida (clave temporal)` };
    case 'mfa_restablecido': return { ...base, accion: 'cambio_usuario', resultado: 'exito', detalle: `MFA de ${String(d['usuario'])} restablecido` };
    case 'clave_cambiada': return { ...base, accion: 'cambio_clave', resultado: 'exito', detalle: `Cambió su contraseña${desde}` };
    default: return { ...base, accion: 'otro', resultado: 'info', detalle: f.action };
  }
}

const filtro = z.object({ portal: z.string().min(1).max(100).optional(), limite: z.coerce.number().int().min(1).max(5000).default(1000) });

export async function auditoriaRoutes(app: FastifyInstance) {
  // shortcut: devuelve los últimos N registros y la pantalla filtra y pagina en el navegador; con mucho historial, filtrar y paginar aquí.
  app.get('/api/auditoria', async (req, reply) => {
    const s = await requireRole(req, reply, ['administrador', 'operador', 'lector']);
    if (!s) return;
    const q = filtro.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Datos inválidos' });
    // Se ocultan las filas que dejaron las pruebas automáticas antiguas (usuarios t_… de prueba y acción "prueba"); la tabla no permite borrarlas.
    // Inicios de sesión, IP y fallos de acceso solo para el administrador; los demás ven lo que pasó en los portales.
    const soloPortales = s.role === 'administrador' ? '' : `AND detail ? 'portal'`;
    const filas = await query<Fila>(
      `SELECT id::text, username, action, detail, ip, created_at FROM audit_log
        WHERE ($1::text IS NULL OR detail->>'portal' = $1) ${soloPortales}
          AND NOT (action = 'prueba' OR username ~ '^t_([a-z]+_)?[0-9a-f]{8}$')
        ORDER BY created_at DESC, id DESC LIMIT $2`, [q.data.portal ?? null, q.data.limite]);
    return filas.map(aRegistro);
  });
}
