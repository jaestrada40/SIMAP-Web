-- Última actividad REAL de la persona (clic, teclado, desplazamiento), avisada por el navegador con un "latido".
-- Las consultas de fondo (la cola consulta cada segundo) NO la actualizan: si lo hicieran, la sesión nunca vencería por inactividad.
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
