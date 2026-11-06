// Uso: npm run create-user -- <usuario> <administrador|operador|lector>
// Genera una clave aleatoria y la muestra una sola vez.
// Para el primer administrador. Los demás usuarios se crean desde la pantalla Usuarios.
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';
import { pool, query } from './db.js';

const [username, role] = process.argv.slice(2);
if (!username || !['administrador', 'operador', 'lector'].includes(role ?? '')) {
  console.error('Uso: npm run create-user -- <usuario> <administrador|operador|lector>');
  process.exit(1);
}
// SIMAP_PASSWORD solo para pruebas locales; sin ella se genera una clave aleatoria.
const password = process.env.SIMAP_PASSWORD ?? randomBytes(15).toString('base64url');
await query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [username.trim().toLowerCase(), await hashPassword(password), role]);
console.log(`Usuario: ${username.trim().toLowerCase()}\nRol: ${role}\nClave (solo se muestra ahora): ${password}`);
await pool.end();
