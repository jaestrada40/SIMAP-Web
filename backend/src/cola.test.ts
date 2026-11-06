import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { V1Deployment, V1Pod } from '@kubernetes/client-node';

// La auditoría real es insert-only: estas pruebas no deben dejar filas falsas en ella.
vi.mock('./auth.js', () => ({ audit: async () => {} }));

const { accionCola, colaActiva, estadoCola, iniciarCola, usarPasos } = await import('./cola.js');
const { rolloutCompleto, baseAlDia } = await import('./nucleo.js');
const { IMAGEN_CON_DIGEST } = await import('./k8s.js');

const q = { username: 'prueba' };
const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};
const termino = () => !!estadoCola() && estadoCola()!.estado !== 'en_curso';

beforeEach(() => { usarPasos(undefined); });
afterEach(() => { if (estadoCola()) { if (colaActiva()) accionCola('detener', q); accionCola('limpiar', q); } });

test('procesa de uno en uno y termina', async () => {
  const visto: string[] = [];
  usarPasos(async (id, paso) => { visto.push(`${id}:${paso}`); return { ok: true, log: [`ok ${paso}`] }; });
  iniciarCola('plugins', ['a', 'b'], false, q);
  await esperar(termino);
  expect(estadoCola()?.estado).toBe('finalizada');
  expect(visto).toEqual(['a:0', 'a:1', 'a:2', 'a:3', 'a:4', 'b:0', 'b:1', 'b:2', 'b:3', 'b:4']);
  expect(estadoCola()?.items.map((i) => i.estado)).toEqual(['listo', 'listo']);
});

test('se detiene en el primer fallo y no toca el siguiente portal', async () => {
  const tocados = new Set<string>();
  usarPasos(async (id, paso) => { tocados.add(id); return paso === 2 && id === 'a' ? { ok: false, log: ['falló'] } : { ok: true, log: [] }; });
  iniciarCola('plugins', ['a', 'b'], false, q);
  await esperar(termino);
  expect(estadoCola()?.estado).toBe('detenida_error');
  expect(estadoCola()?.items[0]?.pasos).toEqual(['listo', 'listo', 'error', 'pendiente', 'pendiente']);
  expect(tocados.has('b')).toBe(false);
});

test('reintentar sigue desde el paso fallido, no desde cero', async () => {
  let intentos = 0;
  const pasosVistos: number[] = [];
  usarPasos(async (_id, paso) => { pasosVistos.push(paso); return paso === 2 && ++intentos === 1 ? { ok: false, log: ['falló'] } : { ok: true, log: [] }; });
  iniciarCola('plugins', ['a'], false, q);
  await esperar(termino);
  accionCola('reintentar', q);
  await esperar(termino);
  expect(estadoCola()?.estado).toBe('finalizada');
  expect(pasosVistos).toEqual([0, 1, 2, 2, 3, 4]);
});

test('saltar marca el portal y continúa con el siguiente', async () => {
  usarPasos(async (id, paso) => (id === 'a' && paso === 0 ? { ok: false, log: ['falló'] } : { ok: true, log: [] }));
  iniciarCola('plugins', ['a', 'b'], false, q);
  await esperar(termino);
  accionCola('saltar', q);
  await esperar(termino);
  expect(estadoCola()?.estado).toBe('finalizada');
  expect(estadoCola()?.items.map((i) => i.estado)).toEqual(['saltado', 'listo']);
});

test('detener con la cola en error deja los demás sin procesar; no se permiten dos colas', async () => {
  usarPasos(async () => ({ ok: false, log: ['falló'] }));
  iniciarCola('plugins', ['a', 'b'], false, q);
  await esperar(termino);
  expect(() => iniciarCola('plugins', ['c'], false, q)).toThrow(/en curso/);
  accionCola('detener', q);
  expect(estadoCola()?.estado).toBe('detenida_usuario');
  expect(estadoCola()?.items.map((i) => i.estado)).toEqual(['error', 'detenido']);
});

test('un paso que lanza una excepción cuenta como fallo, no tumba el servidor', async () => {
  usarPasos(async () => { throw new Error('boom'); });
  iniciarCola('plugins', ['a'], false, q);
  await esperar(termino);
  expect(estadoCola()?.estado).toBe('detenida_error');
  expect(estadoCola()?.items[0]?.log.join('\n')).toContain('boom');
});

// --- Volver atrás (solo núcleo/PHP) ---
test('volver atrás en núcleo/PHP revierte, detiene la cola y deja los demás sin procesar', async () => {
  usarPasos(async (id, paso) => (id === 'a' && paso === 3 ? { ok: false, log: ['el pod no arrancó'] } : { ok: true, log: [] }));
  iniciarCola('nucleo_php', ['a', 'b'], false, q);
  await esperar(termino);
  const revertidos: string[] = [];
  accionCola('volver', q, async (id) => { revertidos.push(id); return { ok: true, log: ['imagen restaurada'] }; });
  expect(estadoCola()?.estado).toBe('en_curso'); // mientras revierte
  await esperar(termino);
  expect(revertidos).toEqual(['a']);
  expect(estadoCola()?.estado).toBe('detenida_usuario');
  expect(estadoCola()?.items.map((i) => i.estado)).toEqual(['saltado', 'detenido']);
});

test('si la reversión falla, la cola sigue esperando una decisión', async () => {
  usarPasos(async () => ({ ok: false, log: ['falló'] }));
  iniciarCola('nucleo_php', ['a'], false, q);
  await esperar(termino);
  accionCola('volver', q, async () => ({ ok: false, log: ['no hay imagen anterior'] }));
  await esperar(termino);
  expect(estadoCola()?.estado).toBe('detenida_error');
  expect(estadoCola()?.items[0]?.estado).toBe('error');
});

test('en plugins y en simulación no hay vuelta atrás', async () => {
  usarPasos(async () => ({ ok: false, log: ['falló'] }));
  iniciarCola('plugins', ['a'], false, q);
  await esperar(termino);
  expect(() => accionCola('volver', q)).toThrow(/plugins/);
  accionCola('detener', q); accionCola('limpiar', q);
  iniciarCola('nucleo_php', ['a'], true, q);
  await esperar(termino);
  expect(() => accionCola('volver', q)).toThrow(/simulación/);
});

// --- Criterio de "reinicio completo" ---
const IMG = 'docker.io/bitnami/wordpress@sha256:' + 'a'.repeat(64);
const VIEJA = 'docker.io/bitnami/wordpress@sha256:' + 'b'.repeat(64);
const dep = (over: { image?: string; status?: object; generation?: number } = {}): V1Deployment => ({
  metadata: { generation: over.generation ?? 2 },
  spec: { replicas: 1, selector: { matchLabels: {} }, template: { spec: { containers: [{ name: 'wordpress', image: over.image ?? IMG }] } } },
  status: { observedGeneration: 2, replicas: 1, updatedReplicas: 1, availableReplicas: 1, ...over.status },
});
const pod = (image: string, ready = true, borrando = false): V1Pod => ({
  metadata: borrando ? { deletionTimestamp: new Date() } : {},
  spec: { containers: [{ name: 'wordpress', image }] },
  status: { phase: 'Running', containerStatuses: [{ ready } as never] },
});

test('rolloutCompleto: solo cuando el pod nuevo está listo y no queda ninguno viejo', () => {
  expect(rolloutCompleto(dep(), [pod(IMG)], 'wordpress', IMG)).toBe(true);
  expect(rolloutCompleto(dep(), [pod(IMG), pod(VIEJA, true, true)], 'wordpress', IMG)).toBe(true); // el viejo ya se está borrando
  expect(rolloutCompleto(dep(), [pod(IMG), pod(VIEJA)], 'wordpress', IMG)).toBe(false); // el viejo sigue vivo
  expect(rolloutCompleto(dep(), [pod(IMG, false)], 'wordpress', IMG)).toBe(false); // el nuevo aún no está listo
  expect(rolloutCompleto(dep({ image: VIEJA }), [pod(VIEJA)], 'wordpress', IMG)).toBe(false); // el trigger no aplicó el cambio
  expect(rolloutCompleto(dep({ generation: 3 }), [pod(IMG)], 'wordpress', IMG)).toBe(false); // el controlador aún no vio el cambio
  expect(rolloutCompleto(dep({ status: { updatedReplicas: 0 } }), [pod(IMG)], 'wordpress', IMG)).toBe(false);
});

test('solo se aceptan imágenes fijadas por digest', () => {
  expect(IMAGEN_CON_DIGEST.test(IMG)).toBe(true);
  expect(IMAGEN_CON_DIGEST.test('docker.io/bitnami/wordpress:latest')).toBe(false);
  expect(IMAGEN_CON_DIGEST.test('docker.io/bitnami/wordpress@sha256:abc')).toBe(false);
  expect(IMAGEN_CON_DIGEST.test(IMG + '; rm -rf /')).toBe(false);
  expect(IMAGEN_CON_DIGEST.test('')).toBe(false);
});

test('baseAlDia: reconoce la salida de wp core update-db --dry-run', () => {
  expect(baseAlDia('Performing a dry run, with no database modification.\nSuccess: WordPress database already at latest db version 61833.')).toBe(true);
  expect(baseAlDia('Performing a dry run, with no database modification.\nSuccess: WordPress database will be upgraded from db version 61833 to 62000.')).toBe(false);
  expect(baseAlDia('')).toBe(false); // salida vacía = no asumir que está al día
});
