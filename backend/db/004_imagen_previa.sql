-- Imagen que tenía el portal justo antes del último cambio de imagen (para "Volver atrás"). Una fila por portal.
CREATE TABLE imagen_previa (
  portal_id   TEXT PRIMARY KEY REFERENCES portales(id) ON DELETE CASCADE,
  imagen      TEXT NOT NULL,
  guardada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
