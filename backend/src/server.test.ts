import { afterAll, expect, test } from 'vitest';
import { buildServer } from './server.js';
import { pool } from './db.js';

afterAll(() => pool.end());

test('health responde ok y manda cabeceras de seguridad', async () => {
  const res = await buildServer().inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});

test('audit_log no se puede borrar', async () => {
  // Dentro de una transacción que se deshace: así la prueba no deja una fila falsa en la auditoría real.
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO audit_log (action) VALUES ('prueba')");
    await expect(c.query('DELETE FROM audit_log')).rejects.toThrow(/solo inserción/);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
