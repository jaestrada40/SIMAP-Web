# Guía: reconstruir un portal WordPress desde una copia de UpdraftPlus

Probada el 5-nov-2026 con `portal-dotacion/wordpress-test` (WordPress 7.1.4, 15 plugins, 32 páginas y entradas, 10 763 archivos): se reconstruyó en un MariaDB y un WordPress **nuevos** y el resultado fue idéntico al original. Cuándo usarla: el pod o el volumen del portal se perdió o no se puede reparar, y "Volver a la imagen anterior" no sirve.

> **Condición indispensable:** la copia tiene que estar **fuera del portal**. Si las copias de UpdraftPlus están en el mismo volumen que el sitio (hoy es así en los portales revisados) y el volumen se pierde, no hay con qué reconstruir.

## Qué hace falta tener a mano

| Dato | De dónde sale |
|---|---|
| Las **5 piezas** de la copia: `…-db.gz`, `…-plugins.zip`, `…-themes.zip`, `…-uploads.zip`, `…-others.zip` | UpdraftPlus (carpeta `wp-content/updraft`, o su almacenamiento remoto) |
| **Imagen exacta** del portal (`@sha256:…`) | SIMAP-Web, ficha del portal, "Imagen actual"; o "Imagen anterior" si se actualizó el núcleo |
| **Prefijo de las tablas** (casi siempre `wp_`) | `wp config get table_prefix --type=variable` en el portal, o el nombre de las tablas dentro del `.gz` |
| **URL pública** del sitio | La ruta de OpenShift |

El `wp-config.php` **no** viaja en la copia: el WordPress nuevo genera uno propio. Consecuencia: las sesiones abiertas de los usuarios dejan de valer y tendrán que volver a iniciar sesión.

## Pasos (tiempos medidos; el sitio pequeño de la prueba)

Todo con la etiqueta `simap.simulacro=restauracion` en la prueba, para poder borrarlo junto. En un caso real, usen el nombre definitivo.

**1. MariaDB nuevo (~1 min).** Un `Secret` con contraseñas **aleatorias nuevas** (no reutilicen las del portal caído), un volumen (1 GiB bastó para una base de 34 MB), un `Deployment` con la misma imagen de MariaDB de los portales y su `Service`. Variables: `MARIADB_USER`, `MARIADB_DATABASE`, `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD` (las dos últimas desde el Secret).

**2. WordPress nuevo (~1,5 min).** Un volumen (3 GiB), un `Deployment` con **la misma imagen exacta** y su `Service`. Variables:
- `WORDPRESS_SKIP_BOOTSTRAP=yes` (no instala sitio: la base llega con la copia).
- `WORDPRESS_DATABASE_HOST`, `WORDPRESS_DATABASE_PORT_NUMBER=3306`, `WORDPRESS_DATABASE_NAME`, `WORDPRESS_DATABASE_USER`, `WORDPRESS_DATABASE_PASSWORD` (desde el Secret).
- `WORDPRESS_TABLE_PREFIX` = **el mismo prefijo del original**.
- **`WORDPRESS_PASSWORD` es obligatoria aunque se omita la instalación.** Sin ella el contenedor sale con código 1 y casi sin mensaje (se queda en "Validating settings in MYSQL_CLIENT_* env vars"). Pónganla desde el Secret.
- `WORDPRESS_HOSTNAME` con el nombre del sitio (evita una advertencia de seguridad).
- **No** activen `BITNAMI_DEBUG`: el modo de depuración puede imprimir valores de contraseñas.

> El pod aparece "Running" antes de estar listo (no hay sondas de salud). **Esperen a que exista `/bitnami/wordpress/wp-config.php`** antes de seguir.

**3. Pasar las 5 piezas al pod nuevo (13 s para 85 MB).** Dentro de `/bitnami/wordpress/wp-content/updraft`. **Comprueben `sha256sum` en origen y destino**: deben ser idénticos. Si vienen de afuera del clúster, `oc cp` o `oc exec -i … -- sh -c 'cat > archivo' < archivo`.

**4. Dejar `plugins` y `themes` vacíos y extraer las piezas (9 s).** La imagen **no trae `unzip`**, pero PHP sí: `ZipArchive::extractTo`. Los zip traen su carpeta en la raíz (`plugins/…`, `themes/…`, `uploads/…`; `others` trae `languages/` y similares), así que **los cuatro se extraen sobre `wp-content`**. Antes borren los plugins y temas por defecto (`akismet`, `hello.php`, `twenty*`) para que no queden mezclados.

**5. Importar la base (11 s).** `gunzip -c …-db.gz > /tmp/restore.sql` y `wp db import /tmp/restore.sql`. El volcado de UpdraftPlus trae `DROP TABLE IF EXISTS`, así que reemplaza lo que haya. Borren el `.sql` al terminar.

**6. Cambiar la URL, solo si cambió (5 s).** `wp search-replace '<url vieja>' '<url nueva>' --all-tables --skip-columns=guid`. WP-CLI corrige también los datos serializados. Es el paso que más se olvida al mover un portal.

**7. Apuntar el tráfico.** Una `Route` al `Service` nuevo (o mover la existente). No se probó en la simulación.

## Cómo comprobar que quedó igual

Comparen, en el original (si aún responde) y en el reconstruido:
- Versión de WordPress, usuarios, páginas y entradas (`wp post list --post_type=post,page --post_status=any --format=count`), plugins instalados y activos, tema activo.
- Una **huella MD5 de todo el contenido** (`post_content` de todas las filas) y otra de usuarios y claves. En la prueba: 873 filas, idénticas.
- Número de tablas y de opciones (58 y 549 en la prueba).
- Archivos de `wp-content` (sin `updraft` ni `cache`).
- Que el sitio devuelva 200 y el título correcto.

> **Cuidado al comparar:** si una consulta devuelve vacío en los dos lados, "vacío = vacío" no prueba nada. Verifiquen que los valores no estén vacíos.

## Diferencias que aparecieron en la prueba (todas inocuas)

- Solo 2 opciones con valor distinto, sin relación con la URL: `action_scheduler_lock_async-request-runner` (candado de tareas) y `members_notifications` (caché de avisos). Parecen ruido de ejecución; no se inspeccionó su contenido.
- 1 archivo menos: `wp-content/upgrade/index.php`, que UpdraftPlus no incluye.
- `/wp-login.php` da 404 tanto en el original como en el restaurado: lo oculta el plugin `wps-hide-login`.

## Qué NO se probó

- Portales grandes: `portal-gl` de producción tiene 9 GB de `wp-content`; el tiempo de extracción y de transferencia no se midió, y el volumen nuevo debe ser mucho mayor.
- La ruta pública, el certificado y el dominio.
- La restauración con el botón de UpdraftPlus (se hizo a mano, que es lo que funciona sin acceso al wp-admin del sitio caído).
- Imágenes de registro interno de OpenShift (los 8 portales con imagen propia): hay que tener esa imagen disponible.
- Portales con varias réplicas o con almacenamiento compartido.
