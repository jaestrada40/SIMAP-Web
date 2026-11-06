-- Portales que se monitorean. Agregar uno = una fila; el recolector la toma en la siguiente pasada.
CREATE TABLE portales (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  proyecto    TEXT NOT NULL,           -- namespace de OpenShift
  deployment  TEXT NOT NULL,
  contenedor  TEXT NOT NULL DEFAULT 'wordpress',
  url         TEXT NOT NULL DEFAULT '',
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proyecto, deployment)
);

-- Última lectura de cada portal (solo se guarda la más reciente).
CREATE TABLE portal_estado (
  portal_id   TEXT PRIMARY KEY REFERENCES portales(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL CHECK (estado IN ('ok', 'apagado', 'sin_acceso', 'error')),
  datos       JSONB NOT NULL DEFAULT '{}',
  mensaje     TEXT,
  revisado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
