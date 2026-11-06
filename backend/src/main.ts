import { revisar } from './collector.js';
import { buildServer } from './server.js';

const app = buildServer();
// 127.0.0.1 en local; en OpenShift se define HOST=0.0.0.0.
await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });

// Revisión automática cada N minutos (0 o sin definir = solo manual, con el botón "Revisar ahora").
const cadaMin = Number(process.env.COLLECT_INTERVAL_MIN ?? 0);
if (cadaMin > 0) {
  setInterval(() => revisar().catch((e) => app.log.error(e, 'revisión automática')), cadaMin * 60_000);
}
