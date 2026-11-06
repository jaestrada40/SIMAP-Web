import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { query } from './db.js';
import { authRoutes } from './routes/auth.js';
import { portalesRoutes } from './routes/portales.js';
import { colaRoutes } from './routes/cola.js';
import { configuracionRoutes } from './routes/configuracion.js';
import { logosRoutes } from './routes/logos.js';
import { auditoriaRoutes } from './routes/auditoria.js';
import { usuariosRoutes } from './routes/usuarios.js';
import { portalesAdminRoutes } from './routes/portales-admin.js';
import { respaldosRoutes } from './routes/respaldos.js';
import { updraftRoutes } from './routes/updraft.js';
import { fichaRoutes } from './routes/ficha.js';

export function buildServer() {
  // TRUST_PROXY_HOPS = cuántos proxies hay delante (en OpenShift, 1: la Route). Solo así req.ip es la IP real y no se puede falsear.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024, trustProxy: hops > 0 ? (_addr, hop) => hop <= hops : false });
  app.register(helmet);
  app.register(cookie);

  // Defensa contra CSRF además de SameSite=Strict: una escritura desde otro origen se rechaza.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    try {
      if (origin && new URL(origin).host !== req.headers.host) throw new Error();
    } catch {
      return reply.code(403).send({ error: 'Origen no permitido' });
    }
  });

  app.get('/api/health', async () => {
    await query('SELECT 1');
    return { ok: true };
  });
  app.register(authRoutes);
  app.register(portalesRoutes);
  app.register(colaRoutes);
  app.register(configuracionRoutes);
  app.register(logosRoutes);
  app.register(auditoriaRoutes);
  app.register(usuariosRoutes);
  app.register(portalesAdminRoutes);
  app.register(respaldosRoutes);
  app.register(updraftRoutes);
  app.register(fichaRoutes);

  return app;
}
