import { expect, test } from 'vitest';
import { leerAutoActualizacion, leerDisco, leerPlugins } from './collector.js';

test('auto-actualización: guarda solo 4 datos y nunca los correos', () => {
  const mpsum = JSON.stringify({ core: { core_updates: 'automatic', plugin_updates: 'automatic', theme_updates: 'on', email_addresses: ['a@b.gt'] } });
  const r = leerAutoActualizacion(true, mpsum);
  expect(r).toEqual({ plugin: true, todoDesactivado: false, nucleo: 'automatic', plugins: 'automatic', temas: 'on' });
  expect(JSON.stringify(r)).not.toContain('@');
  expect(leerAutoActualizacion(false, mpsum)).toEqual({ plugin: false, todoDesactivado: false, nucleo: null, plugins: null, temas: null });
  expect(leerAutoActualizacion(true, 'no es json').plugin).toBe(true); // no tumba la revisión
});

test('lee la lista de plugins de WP-CLI, aun con avisos de PHP antes del JSON', () => {
  const salida = 'PHP Warning: algo\n' + JSON.stringify([
    { name: 'forminator', title: 'Forminator', status: 'active', version: '1.58.2', update: 'available', update_version: '1.58.4' },
    { name: 'updraftplus', status: 'inactive', version: '1.26.13', update: 'none', update_version: '' },
  ]);
  const [a, b] = leerPlugins(salida);
  expect(a).toMatchObject({ slug: 'forminator', nombre: 'Forminator', versionNueva: '1.58.4', estado: 'activo' });
  expect(b).toMatchObject({ nombre: 'updraftplus', versionNueva: null, estado: 'inactivo' });
});

test('lee df -Pk', () => {
  const df = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdab 3030800 267264 2747152 10% /bitnami\n';
  expect(leerDisco(df)).toEqual({ discoUsadoPct: 10, discoTotalGb: 2.9 });
  expect(() => leerDisco('basura')).toThrow();
});
import { leerFechaRespaldo, leerNucleoDisponible } from './collector.js';

test('núcleo disponible: sin ofertas queda la instalada; con ofertas, la más alta', () => {
  expect(leerNucleoDisponible('[]', '7.1.4')).toBe('7.1.4');
  expect(leerNucleoDisponible('', '7.1.4')).toBe('7.1.4');
  expect(leerNucleoDisponible('[{"version":"7.1.4","update_type":"minor"},{"version":"7.2.0","update_type":"major"}]', '7.1.3')).toBe('7.2.0');
});

test('fecha de respaldo: epoch a ISO, vacío si no existe', () => {
  expect(leerFechaRespaldo('1793898399\n')).toBe('2026-11-05T17:06:39.000Z');
  expect(leerFechaRespaldo(null)).toBe('');
});

test('auto-actualización: all_updates "off" (Desactivar todas las actualizaciones) manda sobre núcleo, plugins y temas', () => {
  // Caso real (portal-gl/wordpress-test): los tres dicen "automatic" pero WordPress no actualiza nada.
  const apagado = JSON.stringify({ core: { all_updates: 'off', core_updates: 'automatic', plugin_updates: 'automatic', theme_updates: 'automatic' } });
  expect(leerAutoActualizacion(true, apagado).todoDesactivado).toBe(true);
  // Caso real (portal-gl/wordpress): all_updates "on" => rigen los tres ajustes.
  const activo = JSON.stringify({ core: { all_updates: 'on', core_updates: 'automatic', plugin_updates: 'automatic', theme_updates: 'automatic' } });
  expect(leerAutoActualizacion(true, activo).todoDesactivado).toBe(false);
  // Sin la clave (versiones viejas del plugin): no se asume que esté apagado.
  expect(leerAutoActualizacion(true, JSON.stringify({ core: { core_updates: 'on' } })).todoDesactivado).toBe(false);
});

import { leerRespaldoUpdraft } from './collector.js';
test('UpdraftPlus: solo cuenta lo que existe de verdad, y lee dónde guarda las copias', () => {
  const pieza = (registrados: number, presentes: number) => ({ registrados, presentes });
  const base = { backup_time: 1792692258, success: 1, errores: 0 };
  const estado = (o: object) => JSON.stringify({ ...base, ...o });
  const completas = { db: pieza(1, 1), plugins: pieza(1, 1), themes: pieza(1, 1), uploads: pieza(2, 2), others: pieza(1, 1) };
  // Copia local completa
  expect(leerRespaldoUpdraft(true, estado({ servicio: '', piezas: completas }))).toEqual({ activo: true, ultimo: '2026-10-22T18:04:18.000Z', remoto: false, incluyeBase: true, incluyeArchivos: true });
  // Caso real de dotacion-test: el registro dice que hay copias pero NINGÚN archivo existe -> no cuenta
  const fantasma = { db: pieza(1, 0), plugins: pieza(1, 0), themes: pieza(1, 0), uploads: pieza(1, 0), others: pieza(1, 0) };
  expect(leerRespaldoUpdraft(true, estado({ servicio: '', piezas: fantasma }))).toEqual({ activo: true, ultimo: '', remoto: false, incluyeBase: null, incluyeArchivos: null });
  // Con almacenamiento remoto se confía en el registro aunque el archivo local ya no esté (se borra tras subirlo)
  expect(leerRespaldoUpdraft(true, estado({ servicio: ['s3'], piezas: fantasma }))).toMatchObject({ remoto: true, incluyeBase: true, ultimo: '2026-10-22T18:04:18.000Z' });
  expect(leerRespaldoUpdraft(true, estado({ servicio: 'sftp', piezas: completas })).remoto).toBe(true);
  expect(leerRespaldoUpdraft(true, estado({ servicio: ['none'], piezas: completas })).remoto).toBe(false);
  // Copia sin la base
  expect(leerRespaldoUpdraft(true, estado({ servicio: '', piezas: { ...completas, db: pieza(0, 0) } }))).toMatchObject({ incluyeBase: false, incluyeArchivos: true });
  // Respaldo marcado como fallido: no cuenta, pero el almacenamiento remoto sí se lee
  expect(leerRespaldoUpdraft(true, estado({ success: 0, servicio: ['s3'], piezas: completas }))).toEqual({ activo: true, ultimo: '', remoto: true, incluyeBase: null, incluyeArchivos: null });
  expect(leerRespaldoUpdraft(true, estado({ errores: 2, servicio: '', piezas: completas })).ultimo).toBe('');
  // Plugin ausente o salida ilegible: sin dato, nunca inventado
  expect(leerRespaldoUpdraft(false, estado({ servicio: '', piezas: completas }))).toEqual({ activo: false, ultimo: '', remoto: false, incluyeBase: null, incluyeArchivos: null });
  expect(leerRespaldoUpdraft(true, null)).toEqual({ activo: true, ultimo: '', remoto: false, incluyeBase: null, incluyeArchivos: null });
  expect(leerRespaldoUpdraft(true, 'no es json')).toEqual({ activo: true, ultimo: '', remoto: false, incluyeBase: null, incluyeArchivos: null });
});

import { esUpdraft } from './collector.js';
test('UpdraftPlus se reconoce por su nombre aunque la carpeta se haya renombrado', () => {
  expect(esUpdraft({ slug: 'updraftplus', nombre: 'UpdraftPlus - Backup/Restore' })).toBe(true);
  expect(esUpdraft({ slug: 'updraftplus-off', nombre: 'UpdraftPlus - Backup/Restore' })).toBe(true); // caso real de portal-gl
  expect(esUpdraft({ slug: 'respaldo-viejo', nombre: 'UpdraftPlus - Backup/Restore' })).toBe(true);
  expect(esUpdraft({ slug: 'updraftplus-premium', nombre: 'UpdraftPlus Premium' })).toBe(true);
  // Otros plugins que no son UpdraftPlus
  expect(esUpdraft({ slug: 'updraftcentral', nombre: 'UpdraftCentral Dashboard' })).toBe(false);
  expect(esUpdraft({ slug: 'backwpup', nombre: 'BackWPup' })).toBe(false);
  expect(esUpdraft({ slug: 'forminator', nombre: 'Forminator' })).toBe(false);
});
