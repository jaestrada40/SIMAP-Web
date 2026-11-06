import { expect, test } from 'vitest';
import { fichaMarkdown, type DatosFicha } from './ficha.js';

const base: DatosFicha = {
  generada: new Date('2026-11-05T22:30:00Z'),
  portal: { id: 'dotacion-test', nombre: 'Dotación (prueba)', proyecto: 'portal-dotacion', deployment: 'wordpress-test', contenedor: 'wordpress', url: 'https://wordpress-test-portal-dotacion.apps.ocp4.mfpweb.local' },
  imagenActual: 'docker.io/bitnami/wordpress@sha256:0faa2fe222204875af1d474e42b40e16284d78b3c7e69265f035f9824c4a2345',
  imagenAnterior: 'docker.io/bitnami/wordpress@sha256:aac25369b78435fc90577c4a8e30309913d537d81ee2cd19992e90448e0f195e',
  wordpress: '7.1.4', php: '8.4.27', dbHost: 'mariadb-test:3306', dbNombre: 'bitnami_wordpress', prefijoTablas: 'wp_', siteurl: 'https://127.0.0.1',
  plugins: [{ slug: 'forminator', nombre: 'Forminator', versionActual: '1.58.4', estado: 'activo' }],
  temas: [{ name: 'Divi', status: 'active', version: '4.27' }],
  wpContentMb: 263, discoTotalGb: 2.9,
  updraft: { activo: true, ultimo: '2026-11-05T21:39:16.000Z', remoto: false, incluyeBase: true, incluyeArchivos: true },
};

test('ficha: trae todo lo necesario para reconstruir', () => {
  const md = fichaMarkdown(base);
  for (const dato of [
    'Dotación (prueba)', 'portal-dotacion', 'wordpress-test', 'sha256:0faa2fe2', 'sha256:aac25369', '7.1.4', '8.4.27',
    'mariadb-test:3306', 'bitnami_wordpress', '`wp_`', 'WORDPRESS_TABLE_PREFIX', '263 MB', '2.9 GB', 'Forminator', '1.58.4', 'Divi', '4.27',
    'NO (están en el mismo volumen', '2026-11-05 22:30 UTC',
  ]) expect(md, dato).toContain(dato);
});

test('ficha: no lleva secretos ni nombres de credenciales y avisa que no los incluye', () => {
  const md = fichaMarkdown(base);
  expect(md).toMatch(/no trae contraseñas ni el `wp-config\.php`/);
  expect(md).not.toMatch(/passw|secret|token|salt|_KEY|credential/i); // ni nombres de variables ni de constantes secretas
  expect(md).not.toMatch(/PASSWORD=|DB_PASSWORD|AUTH_KEY|SECURE_AUTH|NONCE_KEY/);
});

test('ficha: lo que viene del portal se aplana (no puede inyectar formato) y lo que falta se marca', () => {
  const md = fichaMarkdown({
    ...base,
    plugins: [{ slug: 'x|y', nombre: 'Malo`\n# Titulo falso\n| a | b |', versionActual: '1.0', estado: 'activo' }],
    prefijoTablas: '', siteurl: '', wpContentMb: null, dbNombre: '', imagenAnterior: '', updraft: null,
  });
  expect(md).not.toContain('\n# Titulo falso');
  expect(md.split('\n').filter((l) => l.startsWith('# ')).length).toBe(1); // solo el título propio
  expect(md).toContain('(no disponible)');
  expect(md).toContain('(ninguna)');
  expect(md).toContain('UpdraftPlus no está activo');
});

test('ficha: copia externa y copia inexistente se distinguen', () => {
  expect(fichaMarkdown({ ...base, updraft: { activo: true, ultimo: '2026-11-05T21:39:16.000Z', remoto: true, incluyeBase: true, incluyeArchivos: false } }))
    .toMatch(/fuera del portal: \*\*sí\*\*[\s\S]*archivos subidos: no/);
  expect(fichaMarkdown({ ...base, updraft: { activo: true, ultimo: '', remoto: false, incluyeBase: null, incluyeArchivos: null } })).toContain('**ninguna disponible**');
});
