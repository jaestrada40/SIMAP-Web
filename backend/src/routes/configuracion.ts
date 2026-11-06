import type { FastifyInstance } from 'fastify';
import { EXCLUIDOS } from '../collector.js';
import { PHP_MINIMO, UMBRAL_DISCO } from '../comunes.js';
import { imagenObjetivo } from '../nucleo.js';
import { requireRole } from './auth.js';

// Solo lectura: estos valores salen del .env del servidor; el panel los muestra y los usa para el semáforo.
export async function configuracionRoutes(app: FastifyInstance) {
  app.get('/api/configuracion', async (req, reply) => {
    if (!(await requireRole(req, reply, ['administrador', 'operador', 'lector']))) return;
    return {
      imagenObjetivo: imagenObjetivo() ?? '', phpMinimo: PHP_MINIMO, umbralDisco: UMBRAL_DISCO,
      respaldoMaxDias: Number(process.env.RESPALDO_MAX_DIAS ?? 10), frecuenciaRevisionMin: Number(process.env.COLLECT_INTERVAL_MIN ?? 0), pluginsExcluidos: [...EXCLUIDOS],
    };
  });
}
