-- Logos de la institución: uno para el menú lateral (fondo azul) y otro para el login (fondo blanco).
CREATE TABLE logos (
  lugar          TEXT PRIMARY KEY CHECK (lugar IN ('sidebar', 'login')),
  tipo           TEXT NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/webp')),
  datos          BYTEA NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
