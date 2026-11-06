-- Datos de las personas y cambio obligatorio de clave (tras crear o restablecer, la clave temporal solo sirve para cambiarla).
ALTER TABLE users ADD COLUMN nombre TEXT;
ALTER TABLE users ADD COLUMN correo TEXT;
ALTER TABLE users ADD COLUMN ultimo_acceso TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false;
