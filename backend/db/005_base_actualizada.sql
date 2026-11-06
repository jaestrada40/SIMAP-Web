-- true si, en la última actualización de núcleo, WordPress tuvo que actualizar la estructura de la base (wp core update-db).
-- Con la base ya migrada, volver a la imagen anterior puede dejar código viejo con base nueva: la vuelta atrás lo avisa.
ALTER TABLE imagen_previa ADD COLUMN base_actualizada BOOLEAN NOT NULL DEFAULT false;
