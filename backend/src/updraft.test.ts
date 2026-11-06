import { expect, test } from 'vitest';
import { estadoDesdeLog, libreKb, motivoSinEspacio, nombreValido, parsearListado } from './updraft.js';

const N = 'backup_2026-11-05-1539_Dotacin_de186cbe3d14';

test('nombre de archivo: solo acepta el formato exacto de UpdraftPlus (nada con rutas ni caracteres raros)', () => {
  for (const ok of [`${N}-db.gz`, `${N}-plugins.zip`, `${N}-uploads2.zip`, `${N}-others.zip`, 'backup_2024-07-16-0938_Portal_GL_2479189dfad8-wpcore.zip']) expect(nombreValido(ok), ok).toBe(true);
  for (const mal of [
    '../../etc/passwd', `../${N}-db.gz`, `${N}-db.gz/../../x`, `${N}-db.gz; rm -rf /`, `${N}-db.sql`, `${N}-DB.gz`, 'backup_x-db.gz',
    `backup_2026-11-05-1539_Dot acion_de186cbe3d14-db.gz`, `${N}-db.gz\n`, `${N}-db.gz `, '', `${N}-.gz`, 'log.de186cbe3d14.txt',
  ]) expect(nombreValido(mal), JSON.stringify(mal)).toBe(false);
});

test('listado: agrupa por copia, ignora lo ajeno y marca si está completa', () => {
  const salida = [
    `4086200 1793900356 ${N}-db.gz`, `10619952 1793900355 ${N}-others.zip`, `42297556 1793900350 ${N}-plugins.zip`,
    `31861554 1793900351 ${N}-themes.zip`, `12052 1793900352 ${N}-uploads.zip`,
    '16 1793900000 index.html', '65529 1793900357 log.de186cbe3d14.txt', '12 1793000000 ../../etc/passwd',
    'basura sin formato', '',
    // una copia vieja, incompleta (sin base)
    '999 1700000000 backup_2025-04-07-1553_Portal_GL_eaefc0419331-plugins.zip',
  ].join('\n');
  const c = parsearListado(salida);
  expect(c.map((x) => x.nonce)).toEqual(['de186cbe3d14', 'eaefc0419331']); // la más reciente primero
  expect(c[0]).toMatchObject({ fecha: '2026-11-05', hora: '15:39', completa: true, bytes: 4086200 + 10619952 + 42297556 + 31861554 + 12052 });
  expect(c[0]!.piezas.map((p) => p.tipo)).toEqual(['db', 'others', 'plugins', 'themes', 'uploads']);
  expect(c[1]).toMatchObject({ completa: false });
  expect(parsearListado('')).toEqual([]);
});

test('avance: terminada, en curso, detenida e "iniciando" sin confundir con la copia anterior', () => {
  const ruta = '/bitnami/wordpress/wp-content/updraft/log.de186cbe3d14.txt';
  const log = (mtime: number, ...lineas: string[]) => [ruta, String(mtime), ...lineas].join('\n');
  const ahora = 2_000_000;
  // Sin registro
  expect(estadoDesdeLog('', ahora).estado).toBe('sin_actividad');
  expect(estadoDesdeLog('', ahora, { nonce: 'aaaaaaaaaaaa', desdeS: ahora - 5 }).estado).toBe('iniciando');
  // Terminada (inglés y español) y se limpia el prefijo de tiempo
  const fin = estadoDesdeLog(log(ahora - 30, '0034.100 (0) subiendo', '0035.371 (0) The backup succeeded and is now complete'), ahora);
  expect(fin).toMatchObject({ estado: 'terminada', nonce: 'de186cbe3d14', hace: 30, ultimaLinea: 'The backup succeeded and is now complete' });
  expect(estadoDesdeLog(log(ahora - 1, 'La copia de seguridad se ha realizado correctamente y se ha completado'), ahora).estado).toBe('terminada');
  // En curso (registro reciente) y detenida (quieto más de 10 min sin terminar)
  expect(estadoDesdeLog(log(ahora - 20, '0010.000 (0) creando plugins.zip'), ahora).estado).toBe('en_curso');
  expect(estadoDesdeLog(log(ahora - 700, '0010.000 (0) creando plugins.zip'), ahora).estado).toBe('detenida');
  // Lanzada por SIMAP-Web: el registro terminado de OTRA copia no cuenta
  const anterior = log(ahora - 3600, 'The backup succeeded and is now complete');
  expect(estadoDesdeLog(anterior, ahora, { nonce: '111111111111', desdeS: ahora - 10 }).estado).toBe('iniciando');
  expect(estadoDesdeLog(anterior, ahora, { nonce: 'de186cbe3d14', desdeS: ahora - 4000 }).estado).toBe('terminada');
  // Salida ilegible
  expect(estadoDesdeLog('cualquier cosa\nno-es-fecha', ahora).estado).toBe('sin_actividad');
});

test('espacio: exige margen para no llenar el volumen del sitio', () => {
  const kb = (mb: number) => mb * 1024;
  expect(motivoSinEspacio(250, kb(2600))).toBeNull(); // dotacion-test: cabe de sobra
  // portal-gl de producción: 9 GB de wp-content en un volumen con poco libre -> no
  expect(motivoSinEspacio(9200, kb(1500))).toMatch(/No hay espacio suficiente/);
  expect(motivoSinEspacio(9200, kb(12000))).toBeNull();
  // justo en el borde: necesita 15 % de margen + 100 MB
  expect(motivoSinEspacio(1000, kb(1249))).not.toBeNull();
  expect(motivoSinEspacio(1000, kb(1250))).toBeNull();
  // mediciones rotas: no se asume que cabe
  expect(motivoSinEspacio(Number.NaN, kb(5000))).toMatch(/No se pudo medir/);
  expect(motivoSinEspacio(100, Number.NaN)).toMatch(/No se pudo medir/);
});

test('df: lee el espacio libre', () => {
  expect(libreKb('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdb 3023656 352556 2654716 12% /bitnami')).toBe(2654716);
  expect(libreKb('')).toBeNaN();
});
