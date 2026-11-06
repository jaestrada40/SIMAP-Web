import { readdir, readFile } from 'node:fs/promises';
import { pool } from './db.js';

const dir = new URL('../db/', import.meta.url);
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(await readFile(new URL(file, dir), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log('aplicada', file);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
await pool.end();
