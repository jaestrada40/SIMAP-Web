import { expect, test } from 'vitest';
import { aRegistro } from './routes/auditoria.js';

const fila = (action: string, detail: Record<string, unknown> | null = null, username: string | null = 'ana', ip: string | null = null) =>
  ({ id: '7', username, action, detail, ip, created_at: new Date('2026-11-05T17:00:00Z') });

test('auditoría: traduce las acciones del servidor a lo que muestra la pantalla', () => {
  expect(aRegistro(fila('login_fallido', null, 'x', '1.2.3.4'))).toMatchObject({ accion: 'inicio_sesion', resultado: 'fallo', usuario: 'x' });
  expect(aRegistro(fila('login_ok'))).toMatchObject({ accion: 'inicio_sesion', resultado: 'exito' });
  expect(aRegistro(fila('revision', { portal: 'p1', estado: 'ok' }, null))).toMatchObject({ usuario: 'sistema', portalId: 'p1', resultado: 'exito' });
  expect(aRegistro(fila('revision', { portal: 'p1', estado: 'error' }))).toMatchObject({ resultado: 'fallo' });
  expect(aRegistro(fila('actualizacion_fallida', { portal: 'p1', tipo: 'plugins', paso: 'Respaldo', detalle: '10:00:00 a. m. ERROR: sin espacio' }))).toMatchObject({ resultado: 'fallo', detalle: 'Plugins · paso "Respaldo": ERROR: sin espacio' });
  expect(aRegistro(fila('vuelta_atras', { portal: 'p1', desde: 'x@sha256:0faa2fe222204875', hacia: 'x@sha256:aac25369b78435fc', sitio_ok: true }))).toMatchObject({ resultado: 'exito', detalle: 'Imagen sha256:0faa2fe2… → sha256:aac25369…; sitio responde bien' });
  expect(aRegistro(fila('algo_desconocido'))).toMatchObject({ accion: 'otro', detalle: 'algo_desconocido' });
});
