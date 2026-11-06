# SIMAP-Web: manual de pantallas

Última actualización: 5-nov-2026. Este manual describe lo que hace cada pantalla hoy.
Todas las pantallas usan datos **reales** (vienen de los portales o del servidor); ya no queda ninguna con datos de ejemplo.

## Índice

1. [Conceptos generales](#1-conceptos-generales)
2. [Iniciar sesión](#2-iniciar-sesión)
3. [Verificación en dos pasos (MFA)](#3-verificación-en-dos-pasos-mfa)
4. [Panel general](#4-panel-general)
5. [Ficha del portal](#5-ficha-del-portal-al-hacer-clic-en-un-portal)
6. [Cola de actualizaciones](#6-cola-de-actualizaciones)
7. [Plugins](#7-plugins)
8. [Historial y auditoría](#8-historial-y-auditoría)
9. [Usuarios](#9-usuarios-solo-administrador)
10. [Configuración](#10-configuración-solo-administrador)
11. [Seguridad](#11-seguridad)
12. [Sin permisos](#12-sin-permisos)
13. [Resumen: qué es real y qué es de ejemplo](#13-resumen-qué-es-real-y-qué-es-de-ejemplo)

---

## 1. Conceptos generales

### Roles

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Todo: ver, revisar, actualizar, y entrar a Usuarios y Configuración. |
| **Operador** | Ver, revisar y ejecutar actualizaciones (cola, vuelta atrás). No ve Usuarios ni Configuración. |
| **Lector** | Solo ver. No ve los botones de actualizar ni las casillas de selección del panel. Puede mirar una cola que esté corriendo. |

El servidor valida el rol en cada petición; ocultar un botón en pantalla no es la protección.

### Cuando la sesión vence

Una sesión termina por **dos causas**, y gana la que llegue primero:
- **Inactividad: 30 minutos** sin que la persona haga nada en la pantalla (clic, teclado, desplazamiento o toque). Se cambia con `SESION_INACTIVIDAD_MIN` en el `.env` del servidor.
- **Tope absoluto: 8 horas** desde que verificas el código MFA. **No se puede extender**, aunque haya actividad.

**Qué cuenta como actividad:** solo lo que haces tú. Las consultas que la pantalla hace sola (la cola consulta cada segundo) **no** cuentan; si contaran, la sesión nunca vencería por inactividad. El navegador avisa al servidor como máximo una vez por minuto, y solo si hubo actividad; el servidor es quien decide.

**El aviso:** 2 minutos antes de que venza aparece un cuadro con la cuenta atrás.
- Por **inactividad**: botón **"Seguir conectado"**, que reinicia los 30 minutos.
- Por el **tope de 8 horas**: avisa, pero no hay forma de extender; termina lo que estés haciendo y vuelve a entrar.

**Cuando vence:** la pantalla **te lleva sola al inicio de sesión** con el aviso "Su sesión venció. Entre de nuevo." Una cola de actualización que esté corriendo **no se interrumpe**: vive en el servidor y sigue; al volver a entrar la verás.

Limitaciones: el aviso de vencimiento lo dan las consultas normales de la pantalla; si la sesión vence justo al pulsar una descarga, esa descarga muestra su propio error en vez de llevarte al login. Tras volver a entrar caes en el panel, no en la página donde estabas.

### Menú lateral

Panel general · Cola de actualizaciones · Plugins · Historial y auditoría · Usuarios (solo administrador) · Configuración (solo administrador) · Seguridad.

- Junto a "Cola de actualizaciones" aparece una etiqueta cuando hay una cola sin cerrar: **Activa** (corriendo), **Detenida** (esperando una decisión por un error) o **Terminada**.
- En pantallas pequeñas el menú se abre con el botón de las tres rayas.
- Arriba a la derecha: botón de modo claro/oscuro, tu usuario con tu rol, y **Salir**.

### El semáforo de cada portal

Se calcula por portal, en este orden (gana el primero que se cumple):

| Semáforo | Cuándo |
|---|---|
| **Caído** | El sitio responde HTTP 500 o más, o no responde (HTTP 0). |
| **Error** | La versión de PHP es menor que la mínima permitida, o el disco usado supera el umbral. |
| **Pendiente** | Hay al menos un plugin con versión nueva, o el núcleo de WordPress tiene versión nueva. |
| **Al día** | Nada de lo anterior. |

PHP mínimo (por defecto 8.3) y umbral de disco (por defecto 90 %) los fija el servidor en su archivo `.env`.

### Cómo se obtienen los datos

El servidor **no** instala nada en los portales para vigilarlos. En cada **revisión** consulta el pod de cada portal en OpenShift con comandos de solo lectura (versión de PHP y de WordPress, lista de plugins, versión nueva del núcleo, disco, DB_HOST, estado del plugin Easy Updates Manager, fecha del último respaldo) y comprueba la URL por HTTP. Guarda el resultado en su base de datos; las pantallas leen esa base.

- La revisión **solo lee**; no cambia nada en los portales.
- Una sola revisión a la vez. Si hay una en curso, otra se rechaza.
- Los datos mostrados son los de la última revisión: pulsa **Revisar** para refrescarlos.
- Si algo no se pudo consultar, el dato queda vacío o dice "sin dato"; nunca se inventa.

### Tablas

Todas las listas tienen paginación abajo (10, 25 o 50 filas por página).

### Campos de contraseña

Tienen un ojo para mostrar u ocultar lo que escribes.

---

## 2. Iniciar sesión

Ruta: `/login`. Primera pantalla si no hay sesión.

**Qué hace:** pide usuario y contraseña (paso 1 de 2).

**Campos y botones**
- *Usuario* y *Contraseña* (con ojo para verla).
- **Continuar:** envía las credenciales. Si son correctas pasa a la verificación en dos pasos.

**Reglas**
- El mensaje de error es el mismo si falla el usuario o la contraseña (no revela cuál).
- **Bloqueo:** 8 intentos fallidos en 15 minutos bloquean ese usuario desde esa IP durante 15 minutos; el botón queda deshabilitado y el mensaje lo indica.
- Todos los intentos quedan en la auditoría del servidor.
- Las contraseñas se guardan con argon2id.
- Si ya tienes sesión, `/` te lleva al panel.

**Real.**

---

## 3. Verificación en dos pasos (MFA)

Ruta: `/login/mfa`. Paso 2 de 2. Solo se llega desde el login; si entras directo, te devuelve al login.

**Qué hace:** pide el código de 6 dígitos de tu app autenticadora (Google Authenticator, Authy, 1Password…).

**Dos casos**
- **Ya tienes MFA:** escribes el código de 6 dígitos y pulsas **Verificar**.
- **Primera vez:** la pantalla muestra un **código QR** y una **clave manual** (por si no puedes escanear). Escaneas, la app te da un código y lo escribes. Con eso queda activado tu MFA. Esto se pide una sola vez.

**Botones:** **Verificar** (activo cuando hay 6 dígitos) y **Volver** (al login).

**Reglas**
- Si el código es incorrecto: "Código incorrecto. Intente de nuevo." y se borra el campo.
- Intentos limitados con bloqueo temporal, como en el login.
- El paso 1 dura 5 minutos: si no completas el código a tiempo, hay que empezar de nuevo.
- Al terminar la sesión completa dura **8 horas**; después hay que volver a entrar.
- El secreto MFA se guarda cifrado en la base del servidor.

**Real.**

---

## 4. Panel general

Ruta: `/panel`. Pantalla de inicio después de entrar.

**Para qué sirve:** ver de un vistazo el estado de todos los portales y decidir cuáles actualizar.

### Cabecera
- **Revisar ahora:** revisa **todos** los portales (solo lectura). Mientras corre dice "Revisando…". Al terminar muestra "Revisión completada" y refresca la tabla. Con muchos portales puede tardar varios minutos.

### Tarjetas de resumen
| Tarjeta | Qué cuenta |
|---|---|
| Total de portales | Portales activos registrados. |
| Al día | Portales con semáforo "Al día". |
| Con pendientes | Portales con semáforo "Pendiente". |
| Con error o caídos | Semáforo "Error" más "Caído". |
| Última revisión | Fecha y hora de la revisión más reciente. |

### Filtros (sobre la tabla)
- **Búsqueda** por nombre, proyecto o URL.
- **Estado:** todos / Al día / Pendiente / Error / Caído.
- **PHP:** todas las versiones o una concreta (la lista sale de las versiones que existen).
- **Con plugins pendientes:** solo los portales con algún plugin por actualizar.
- **Actualizar seleccionados (N):** (solo administrador u operador) lleva a la cola de actualizaciones con los portales marcados. Está deshabilitado si no marcaste ninguno.

### Tabla
Haz clic en el encabezado de una columna para ordenar; otro clic invierte el orden. Por defecto ordena por semáforo (lo peor primero).

| Columna | Qué muestra |
|---|---|
| Casilla | (solo administrador/operador) selecciona el portal; la casilla del encabezado selecciona todos los filtrados. |
| Nombre | Enlace a la [ficha del portal](#5-ficha-del-portal-al-hacer-clic-en-un-portal). |
| Proyecto | Proyecto de OpenShift donde vive. |
| URL | Enlace al sitio (se abre en otra pestaña). |
| Semáforo | Al día / Pendiente / Error / Caído. |
| PHP | Versión de PHP. **En rojo** si es menor que el mínimo permitido. |
| WordPress | Versión instalada. Si hay una nueva aparece al lado, por ejemplo `7.1.3 → 7.1.4`. |
| Plugins pend. | Cantidad de plugins con versión nueva (— si ninguno). |
| HTTP | Código de respuesta del sitio. En rojo si no es 200. |
| Respuesta | Tiempo de respuesta en milisegundos. |
| Disco libre | Barra y porcentaje libre. En rojo si queda menos del 10 %. |
| Respaldo | Qué tan protegido está el portal, según **UpdraftPlus** y el respaldo de SIMAP-Web. **Externo, hace N d** (verde): UpdraftPlus guarda las copias fuera del portal y la última es reciente. **Solo en el portal** (amarillo): las copias están dentro del mismo volumen del sitio; si el volumen falla, se pierden con él. **Antiguo: N d** (amarillo): hay copia externa pero vieja. **Sin respaldo** (rojo): ninguna. **Sin dato** (gris): aún no se ha revisado. Pasa el cursor para ver el detalle. |
| Auto-act. | "Sí" si el portal se actualiza solo (plugin Easy Updates Manager con alguna opción en automático); "No" si está en manual **o si tiene activado el interruptor general "Desactivar todas las actualizaciones"** (que manda sobre todo lo demás); "—" si aún no se sabe. |
| Última revisión | Cuándo se leyó este portal por última vez. |

**Real.** Todo sale de la última revisión. Si un portal nunca se ha revisado aparece con valores vacíos hasta que pulses "Revisar ahora".

---

## 5. Ficha del portal (al hacer clic en un portal)

Ruta: `/portales/<id>`. Se llega desde el nombre de un portal en el panel. Esta es la pantalla de la captura de ejemplo (Dotación (prueba)).

### Encabezado
- **← Panel general:** vuelve al panel.
- **Nombre del portal** y su **semáforo** (en el ejemplo: *Pendiente*, porque WordPress 7.1.3 tiene la 7.1.4 disponible).
- **URL** del sitio (enlace).
- **Revisar:** revisa solo este portal (solo lectura) y refresca la ficha.
- **Actualizar núcleo/PHP:** (administrador/operador) abre la cola con este portal ya elegido y el tipo "Núcleo y PHP".
- **Actualizar plugins:** (administrador/operador) igual, con el tipo "Plugins".

Si el portal no existe, muestra "El portal no existe" con enlace de vuelta al panel.

### Pestaña Resumen
| Dato | Significado |
|---|---|
| PHP | Versión de PHP del pod. |
| WordPress | Versión instalada y si hay una nueva: `7.1.3 (disponible 7.1.4)`, `(al día)` o `(sin dato de versión nueva; haga una revisión)`. |
| Estado HTTP | Código de respuesta del sitio. |
| Tiempo de respuesta | En milisegundos. |
| Proyecto / Deployment | Dónde está en OpenShift. |
| Nodo | Servidor (worker) donde corre el pod. |
| Espacio de disco | Barra con el % usado y el tamaño total. |
| Última revisión | Cuándo se leyó. |
| Auto-actualización (Easy Updates Manager) | Qué hace el portal por su cuenta: `Núcleo: manual · Plugins: manual · Temas: manual` (o automática/desactivada). Si el interruptor general está activado dice "Todas las actualizaciones desactivadas". Si el plugin no está activo lo dice. |
| Imagen actual (digest) | Imagen del contenedor que corre hoy (identificada por su `sha256`). |
| Imagen anterior | La imagen a la que se puede volver (se guarda antes de cada cambio de imagen). Vacía si nunca se ha cambiado. |

### Pestaña Plugins
Tabla con todos los plugins del portal: nombre, versión actual, **versión nueva** (en amarillo; "Al día" si no hay), estado **Activo/Inactivo** y si está **Excluido** de la cola de plugins.

### Pestaña Historial
Acciones registradas de este portal (fecha, usuario, acción, resultado, detalle), leídas de la auditoría real (ver [Historial](#8-historial-y-auditoría)).

### Pestaña Respaldos y vuelta atrás
- **Último respaldo de la base de datos:** fecha real del archivo de respaldo dentro del volumen del portal (`/bitnami/simap-respaldo.sql`). Es un solo archivo que se sobrescribe en cada actualización: queda el de la última.
- **Imagen anterior disponible.**
- **Estado de los respaldos:** resumen con el mismo semáforo del panel y, si UpdraftPlus está activo, su último respaldo, si guarda las copias **fuera del portal** y si incluye la base de datos y los archivos subidos. Una copia solo **cuenta si sus archivos existen de verdad** en el portal (UpdraftPlus puede conservar el registro de copias cuyos archivos ya no están, por ejemplo al clonar un portal); si guarda fuera del portal se confía en su registro. Un respaldo marcado como fallido tampoco cuenta.
- **Copias completas de UpdraftPlus** (aparece si el portal tiene UpdraftPlus activo): trae todo lo que UpdraftPlus respalda, en piezas (base de datos, plugins, temas, archivos subidos y otros).
  - **Hacer copia completa ahora** (administrador/operador): la lanza **en segundo plano** dentro del portal (no se queda esperando) y muestra el avance cada 3 segundos hasta que termina. Antes **comprueba que el volumen tenga espacio** (lo que pesa `wp-content` + 15 % + 100 MB) y **no la lanza si no cabe**, porque llenar el volumen podría tumbar el sitio. No se puede con una cola en curso ni con otra copia corriendo. En `dotacion-test` (85 MB) tardó unos 35 segundos. **UpdraftPlus conserva solo las copias que tenga configuradas (en los portales revisados, 1): la nueva reemplaza a la anterior.** Si quieres conservar la actual, descárgala primero. Al terminar, el sistema hace una revisión de solo lectura para que el estado de respaldo del panel refleje la copia nueva.
  - **Lista de copias** con fecha, tamaño y si está **Completa** (trae la base y al menos una pieza de archivos).
  - **Descargar** cada pieza (solo administrador): pide **tu contraseña otra vez** y entrega un enlace de **un solo uso que vale 1 minuto**; el archivo baja **directo, sin pasar por la memoria** (sirve para archivos de GB). Solo se puede bajar un archivo que el propio portal liste. Máximo 2 descargas a la vez. Queda en el historial.
- **Descargar ficha de reconstrucción** (administrador/operador): un archivo Markdown con lo necesario para volver a levantar el portal: proyecto, deployment, **imagen exacta**, versiones de WordPress y PHP, nombre de la base y **prefijo de las tablas**, plugins y temas con versión, tamaño y estado de los respaldos. **No incluye contraseñas ni el wp-config.** Guárdala junto a las copias. Se genera con lecturas de solo lectura del portal; si el portal no responde, sale con lo guardado en la última revisión y marca lo que falta.
- **Descargar respaldo de la base** (solo administrador): hace un respaldo **nuevo** de la base y lo descarga comprimido (`.sql.gz`, unas 10 veces más chico). Pide **escribir tu contraseña otra vez** (con intentos limitados), porque el archivo tiene datos de personas y los hashes de contraseñas de WordPress. Solo incluye la **base de datos**, no los archivos subidos. Límite de 300 MB sin comprimir; si lo supera, usar el respaldo de la plataforma. No se puede hacer con una cola o una revisión en curso. Queda en el historial.
- **Hacer respaldo ahora** (administrador/operador): exporta la base de datos del portal a pedido, sin cambiar nada en el sitio. **Sobrescribe** el respaldo anterior (es un solo archivo por portal) y pide confirmación. Antes verifica el disco y que el portal use la base esperada. No se puede hacer mientras hay una cola o una revisión en curso. Sirve para tener un respaldo fresco **antes de pulsar a mano** un aviso de wp-admin como "Update Database" de un plugin. Queda en el historial como "Respaldo a pedido".
- **Volver a la imagen anterior** (administrador/operador): pide **escribir el nombre del portal** (el servidor también lo valida) y entonces el servidor restaura la imagen guardada, espera el reinicio del pod (hasta 5 minutos) y comprueba el sitio. Queda registrado en la auditoría.
  - Solo vuelve la **imagen** (núcleo y PHP). **No** restaura la base de datos; para un cambio de versión menor no hace falta, y el respaldo queda en el volumen por si hiciera falta.
  - No se puede usar mientras hay una cola en curso.
  - Si el portal está apagado (0 réplicas) no hay pod que reiniciar y la verificación falla.

**Real.**

---

## 6. Cola de actualizaciones

Ruta: `/actualizaciones`. Es la única pantalla que **modifica** portales.

**Regla de oro:** los portales se actualizan **de uno en uno**, en el orden elegido. **Si uno falla, la cola se detiene** y tú decides qué hacer.

Solo puede haber una cola a la vez, y no se puede iniciar mientras hay una revisión en curso.
Un lector no ve el formulario; solo ve la cola si hay una corriendo.

### Paso previo: preparar la cola

**1. Elegir portales.** Lista con casillas y paginación. Según el tipo muestra "N pend." (plugins) o "PHP x · WP y" (núcleo). Marca en rojo los portales con el disco por encima del umbral.

**2. Tipo y opciones**
- **Núcleo y PHP:** cambia la **imagen del contenedor** a la imagen objetivo. La imagen objetivo **la fija el servidor** (variable `IMAGEN_OBJETIVO` y siempre por digest `@sha256:`); el navegador no puede cambiarla.
- **Plugins:** actualiza con WP-CLI los plugins con versión nueva (excepto los excluidos).
- **Modo simulación:** hace todas las comprobaciones reales pero **no cambia nada**. Úsalo para ensayar.

**3. Orden.** Lista de los portales elegidos con flechas para subir/bajar y una X para quitar. El botón **Iniciar** abre el cuadro de confirmación.

**Confirmación**
- En toda cola **real** (plugins o núcleo y PHP) hay que **escribir el nombre de cada portal** (el identificador de la lista, por ejemplo `dotacion-test`) para poder pulsar "Iniciar cola". El servidor lo vuelve a comprobar y rechaza la cola si no coincide.
- En modo simulación no se pide, porque no cambia nada.
- Núcleo y PHP real sin imagen objetivo configurada en el servidor: el botón queda deshabilitado.

### Los 5 pasos de cada portal

| # | Paso | Qué hace |
|---|---|---|
| 1 | **Verificar disco** | Comprueba que el disco no supere el umbral y que el DB_HOST del portal coincida con el de la última revisión (detecta que un portal apunte a otra base). Bloquea si algo falla. |
| 2 | **Respaldo** | Exporta la base de datos a `/bitnami/simap-respaldo.sql` dentro del volumen del portal. |
| 3 | **Aplicar** | Plugins: ejecuta la actualización de cada plugin con versión nueva. Núcleo y PHP: guarda la imagen actual como "anterior" y cambia la imagen al objetivo. Si el portal ya usa la imagen objetivo no hace nada. Rechaza deployments con triggers de imagen de OpenShift (podrían deshacer el cambio). |
| 4 | **Reinicio** | Núcleo y PHP: espera hasta 5 minutos a que el pod nuevo esté listo, que ningún pod vivo use otra imagen y que el deployment pida justo la imagen objetivo. **Después comprueba si WordPress necesita actualizar su base de datos** (`wp core update-db --dry-run`): si no, lo anota y sigue; si sí, ejecuta `wp core update-db` (lo mismo que el botón de wp-admin). Si eso falla, la cola se detiene. En plugins no reinicia. |
| 5 | **Verificación del sitio** | Comprueba que el sitio responde 2xx/3xx; reintenta hasta 60 segundos porque tras un reinicio el router tarda unos segundos. Después refresca el panel. |

### Pantalla de la cola en marcha

- **Lista de portales (izquierda):** cada uno con su estado: En espera · En curso · Completado · Error · Saltado · No procesado. Haz clic en uno para ver su detalle.
- **Detalle (derecha):** los 5 pasos con su estado y el **Registro en vivo** (se actualiza solo cada segundo y se va desplazando).
- **Detener cola:** (mientras corre) detiene la cola; los pendientes quedan "No procesados".

La cola vive en el **servidor**: puedes cerrar la pestaña, cambiar de página o recargar y al volver verás la misma cola.

### Cuando un portal falla

Aparece un aviso rojo "Cola detenida" con el portal que falló y estas opciones:
- **Reintentar:** repite desde el paso que falló.
- **Volver atrás:** (solo núcleo y PHP, modo real; pide escribir el nombre del portal) restaura la imagen anterior, espera el reinicio y comprueba el sitio; después **detiene toda la cola** (si falló por la imagen, el siguiente portal fallaría igual). Si la vuelta atrás también falla, la cola sigue esperando tu decisión. No restaura la base de datos.
- **Saltar este portal:** lo marca como saltado y sigue con el siguiente.
- **Detener la cola.**

Los plugins **no** tienen "Volver atrás": restaurar solo la base sería inseguro.

### Cuando termina
- **Cola finalizada:** enlace al historial y botón **Cerrar**.
- **Cola detenida por el usuario:** botón **Cerrar**.
- **Nueva cola** (o Cerrar) borra la cola terminada y vuelve al formulario. Mientras no la cierres, el resultado sigue visible aunque cambies de página.

### Límites que debes conocer
- Si el backend se reinicia, **la cola en curso se pierde** (está en memoria). Lo que ya se aplicó en los portales queda aplicado.
- Todo queda registrado en la auditoría del servidor.

**Real.**

---

### Cómo funcionan los respaldos y la vuelta atrás (explicación completa)

**Qué se guarda antes de actualizar** (paso 2 "Respaldo" y paso 3 "Aplicar"):
1. **Copia de la base de datos:** un archivo `.sql` con todas las tablas del sitio (entradas, páginas, usuarios, ajustes), hecho con `wp db export`. Queda en el volumen persistente del portal, en `/bitnami/simap-respaldo.sql`.
2. **Imagen anterior** (solo núcleo y PHP): antes de cambiar la imagen, el servidor guarda cuál era y la anota en su base de datos.

**Qué NO se copia:** los archivos subidos (`wp-content/uploads`), temas y plugins. Esos viven en el volumen del portal y una actualización de núcleo y PHP no los toca, pero SIMAP-Web no hace copia de ellos.

**Importante: es un solo archivo por portal.** Cada actualización lo sobrescribe: siempre queda el respaldo de la **última** actualización, no un historial. Está dentro del mismo volumen que el sitio: protege ante un error de la actualización, **no** ante la pérdida del volumen. Para eso hace falta una copia externa (pendiente de decidir con quien administra el clúster).

**Qué significa "volver a la imagen anterior":** el sitio WordPress tiene dos partes:
- **El código** (núcleo de WordPress y PHP): viene dentro de la imagen del contenedor. Actualizar núcleo y PHP = cambiar a una imagen nueva. Volver atrás = volver a poner la imagen anterior; el pod se reinicia con el código de antes.
- **Los datos** (base de datos, `wp-content`, `wp-config`): están fuera de la imagen, en el volumen y en la base. Cambiar de imagen no los toca.

Por eso, al volver atrás **no se pierde contenido**: entradas, páginas, usuarios, archivos subidos y plugins siguen donde estaban, porque nunca salieron de ahí.

**Qué NO hace la vuelta atrás: no restaura la base de datos.** Si hubo un cambio de versión menor (como 7.1.3 → 7.1.4), la base es la misma y no hace falta. Y si se restaurara el `.sql` automáticamente, se perderían los cambios hechos en el sitio entre el respaldo y la vuelta atrás (comentarios, pedidos, entradas nuevas). Restaurar la base es una decisión humana, no automática.

**Cómo recuperar la base desde el respaldo (manual, hoy no hay botón):** alguien con acceso al clúster ejecuta dentro del pod `wp db import /bitnami/simap-respaldo.sql`. Recomendado solo si la base quedó dañada. Antes conviene sacar una copia del `.sql` fuera del pod.

**Si algo falla en cada paso**

| Falla en… | Qué pasa | Qué hay que hacer |
|---|---|---|
| Verificar disco | No se cambia nada. | Liberar espacio o corregir el DB_HOST y reintentar. |
| Respaldo | No se cambia nada (no se actualiza sin respaldo). | Reintentar. |
| Aplicar (plugins) | Puede quedar un plugin a medias. | Reintentar o revisar el plugin. **Los plugins no tienen vuelta atrás.** |
| Aplicar / Reinicio (núcleo y PHP) | Si el pod nuevo no arranca, el anterior sigue sirviendo (OpenShift no apaga el pod viejo hasta que el nuevo esté listo). | Reintentar o **Volver atrás**. |
| Verificación del sitio | La imagen ya cambió pero el sitio no responde bien. | **Volver atrás**. |

### Si el portal se pierde: reconstruirlo desde la copia

Si el pod o el volumen de un portal se pierde y "Volver a la imagen anterior" no sirve, se puede levantar un MariaDB y un WordPress nuevos y restaurar la copia de UpdraftPlus. El procedimiento está en **`GUIA-RECONSTRUCCION.md`** y se **probó de verdad** con `dotacion-test`: quedó idéntico al original (mismo contenido, usuarios, plugins, temas y archivos). Condición: la copia debe estar **fuera del portal**.

### Qué pasó con el SFTP

Hace unos 6 meses se dejó de pagar la licencia de UpdraftPlus, y el envío por **SFTP es una función de pago** (en `portal-gl`, la carpeta de add-ons está vacía). La configuración vieja sigue guardada, pero ningún destino está activo, así que **hoy las copias no salen del portal**. SIMAP-Web lo muestra como "Solo en el portal". Las copias hechas en la época del SFTP **pudieron quedar en ese servidor** aunque el plugin ya no pueda leerlas: conviene preguntar a quien lo administre si todavía existen (ver `SOLICITUD-ADMIN-OPENSHIFT.md`).

### Respaldo de archivos (lo que SIMAP-Web NO hace)

SIMAP-Web respalda y puede descargar **la base de datos**. **No respalda los archivos** del sitio (archivos subidos, temas, plugins): en producción `portal-gl` son 9 GB, y moverlos por el navegador o por el servidor no es el lugar adecuado. Para eso están UpdraftPlus con almacenamiento remoto o el respaldo de la plataforma (ver `SOLICITUD-ADMIN-OPENSHIFT.md`). Antes de actualizar, la cola avisa de los portales que no tienen un respaldo externo reciente (no bloquea).

### Plugins que piden actualizar su propia base de datos

Además de la base de WordPress, algunos **plugins** tienen sus propias tablas o datos y, tras actualizarse, muestran en wp-admin un aviso con un botón (por ejemplo "Se requiere una actualización de la base de datos para WordPress Download Manager… Update Database").
- **SIMAP-Web no puede verlo ni hacerlo**: ese aviso solo vive en el panel de WordPress y cada plugin guarda su versión de base de forma distinta. Un portal puede salir "Al día" en el panel y tener un plugin con su migración pendiente.
- Por eso la cola de plugins termina con un **aviso en el registro**: "revise el panel de WordPress de este portal".
- Qué hacer: entra al wp-admin del portal; si hay un aviso así, haz primero un **respaldo a pedido** (pestaña "Respaldos y vuelta atrás") y luego pulsa el botón del plugin.
- No se ejecuta automáticamente a propósito: cada plugin migra distinto y una migración mal hecha sin una persona mirando es justo lo que se quiere evitar.

### ¿Se actualiza la base de datos cuando WordPress lo necesita?

Depende de la versión:
- **Cambios menores** (7.1.3 → 7.1.4): normalmente la base **no cambia**. Lo comprobamos en el portal de prueba: la revisión de base de datos (`db_version`) es 61833, la misma antes y después.
- **Cambios mayores** (por ejemplo 7.1 → 7.2): WordPress puede necesitar actualizar la estructura de la base. **SIMAP-Web la actualiza solo** en el paso 4 (Reinicio), después de que el pod nuevo esté listo y con el respaldo ya hecho. Sin este paso, WordPress la pediría la primera vez que alguien entrara a `/wp-admin`.
- **Consecuencia para la vuelta atrás:** si la base se migró y se vuelve a la imagen vieja, el código viejo puede no entender la base nueva. SIMAP-Web lo recuerda: la ficha del portal (cuadro de "Volver a la imagen anterior") y el registro de la vuelta atrás avisan que hay que restaurar el `.sql` si el sitio no funciona. Por eso, para versiones **mayores**, probar primero en el portal de pruebas.
- Limitación: la migración real de una versión mayor **todavía no se ha probado** (no hay una publicada); sí se probó que detecta que la base está al día.

---

## 7. Plugins

Ruta: `/plugins`.

**Para qué sirve:** ver la versión de cada plugin en cada portal, de forma comparada.

- **Filtro "Todos los plugins":** elige un plugin para ver solo esa columna.
- **Excluidos de la actualización automática:** un interruptor por plugin, en **solo lectura**. Lo que está excluido lo define el servidor (variable `PLUGINS_EXCLUIDOS`, slugs separados por coma) y la cola de plugins nunca los toca.
- **Matriz:** una fila por portal y una columna por plugin (la lista junta los plugins de todos los portales). Cada celda muestra la versión instalada; si hay una nueva aparece en amarillo `→ 1.58.4`. Si el plugin está inactivo en ese portal dice "(inactivo)". Si el portal no tiene ese plugin, "—".
- Las columnas de plugins excluidos llevan la etiqueta "Excluido".

Esta pantalla **no actualiza**: los plugins se actualizan desde la [cola](#6-cola-de-actualizaciones) (o desde el botón "Actualizar plugins" de la ficha).

**Real.**

---

## 8. Historial y auditoría

Ruta: `/historial`.

**Para qué sirve:** ver quién hizo qué y cuándo.

- **Filtros:** usuario, portal (texto), acción (inicio de sesión, revisión, actualización iniciada/completada/fallida, reintento, vuelta atrás, cambio de configuración), resultado (éxito/fallo/información) y "desde la fecha".
- **Tabla:** fecha, usuario, portal, acción, resultado. Haz clic en una fila para ver el detalle completo, la fecha exacta y el identificador.
- **Exportar CSV:** descarga las filas filtradas (con acentos correctos para Excel).

> **Real.** Esta pantalla y la pestaña Historial de cada portal leen la auditoría del servidor, que es de solo inserción (un disparador de la base impide modificar o borrar registros desde la aplicación).

**Qué registra:** inicios de sesión (correctos y fallidos, con la IP), cierres de sesión, revisiones, colas de actualización (iniciada, completada, fallida, reintento), vueltas atrás (con las imágenes y si el sitio quedó bien) y cambios de logo.

**Quién ve qué:** el **administrador** ve todo. El **operador** y el **lector** ven solo lo que pasó en los portales (revisiones, actualizaciones, vueltas atrás); no ven inicios de sesión, IP ni fallos de acceso.

**Límites**
- Muestra los **últimos 1000 registros**; los filtros y la paginación trabajan sobre ellos. Con mucho historial habría que filtrar en el servidor.
- Las revisiones automáticas sin usuario aparecen a nombre de "sistema".
- Se ocultan las filas falsas que dejaron las pruebas automáticas antiguas (usuarios `t_…` y la acción `prueba`). No se pudieron borrar porque la tabla no lo permite; las pruebas actuales ya no escriben en la auditoría real.
- También quedan registradas la gestión de usuarios (crear, editar, rol, estado, restablecer clave o MFA, eliminar), los cambios de contraseña y el alta, edición y baja de portales.

---

## 9. Usuarios (solo administrador)

Ruta: `/usuarios`. Un operador o lector que entre por la dirección es llevado a "Sin permisos". **Real.**

**Tabla:** usuario, nombre, correo, rol, MFA (Activo / Sin activar), último acceso y estado. Tu propia fila lleva la etiqueta "Usted" y no se puede modificar desde aquí.

**Nuevo usuario**
1. Escribe usuario (3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo), nombre, correo y rol.
2. El sistema genera una **contraseña temporal aleatoria** y la muestra **una sola vez** en una ventana, con botón para copiarla. Entrégasela por un canal seguro. No se guarda en claro y no se puede volver a ver (solo restablecerla).
3. En su primer ingreso la persona entra con esa clave, **debe cambiarla** (la pantalla la lleva directo a Seguridad y no puede usar nada más hasta hacerlo) y registra su aplicación autenticadora (QR).

**Editar nombre y correo:** el lápiz de cada fila (también en la tuya). El nombre de usuario no se puede cambiar.

**Eliminar:** el bote de basura (no aparece en tu propia fila). Pide **escribir el nombre de usuario exacto**; borra la cuenta y cierra sus sesiones, sin vuelta atrás. Si solo quieres quitarle el acceso, usa el interruptor Activo. El historial de lo que hizo se conserva (la auditoría guarda su nombre como texto).

**Cambiar el rol:** el selector de cada fila. Cambia al instante; el usuario lo nota en su próxima petición.

**Activar o desactivar:** el interruptor. Al desactivar se cierran sus sesiones abiertas y ya no puede entrar. No se borra a nadie: queda el historial.

**Restablecer contraseña:** pide confirmación, cierra sus sesiones, genera una contraseña temporal nueva (se muestra una vez) y lo obliga a cambiarla al entrar. También quita un bloqueo por intentos fallidos.

**Restablecer MFA:** para quien cambió o perdió el teléfono. Pide confirmación, cierra sus sesiones y borra su verificación en dos pasos: en el próximo ingreso registra la aplicación otra vez. Solo está disponible si tiene MFA activo.

**Reglas de seguridad (las aplica el servidor)**
- Nadie puede cambiar su propio rol, desactivarse, eliminarse ni restablecerse su propia clave o MFA desde esta pantalla. Para la propia clave está Seguridad. Sí puede editar su nombre y correo.
- Siempre debe quedar al menos **un administrador activo**: no se puede desactivar, quitar el rol ni eliminar al único. Un administrador inactivo no cuenta.
- Nunca se envían claves ni secretos a la pantalla.
- Todo queda en la auditoría: usuario creado, rol o estado cambiado, datos editados, usuario eliminado, clave restablecida, MFA restablecido.

**Limitaciones**
- **No se envía correo.** No hay servidor de correo configurado; la contraseña temporal se entrega a mano. El campo "correo" solo se guarda como dato de contacto.
- Si la persona olvida su contraseña, un administrador debe restablecerla (no hay "olvidé mi contraseña").

---

## 10. Configuración (solo administrador)

Ruta: `/configuracion`.

### Parámetros generales — real, solo lectura
Muestran lo que el servidor tiene configurado:
- Imagen objetivo (digest), versión mínima de PHP, umbral de disco (%), antigüedad máxima aceptable del respaldo externo (días, por defecto 10) y plugins excluidos, además de la frecuencia de revisión automática (minutos; "Desactivada" si no hay).

Para cambiarlos se edita el `.env` del servidor (`IMAGEN_OBJETIVO`, `PHP_MINIMO`, `UMBRAL_DISCO`, `COLLECT_INTERVAL_MIN`, `PLUGINS_EXCLUIDOS`, `RESPALDO_MAX_DIAS`, `SESION_INACTIVIDAD_MIN`) y se reinicia el backend.

### Logos — real
Permite poner el logo de la institución en dos lugares, cada uno con su propio archivo:
- **Menú lateral (fondo azul):** se muestra arriba del menú, en lugar del texto "SIMAP-Web". Conviene una versión clara del logo.
- **Inicio de sesión (fondo blanco):** se muestra arriba del formulario de login y de MFA.

Cada bloque muestra una vista previa sobre su fondo, un selector de archivo y **Quitar** (vuelve al texto de siempre). Solo el administrador puede cambiarlos.

Reglas: PNG, JPG o WebP de hasta **512 KB** (se recomienda PNG con fondo transparente). **No se aceptan SVG** (pueden llevar scripts). El servidor comprueba el contenido real del archivo, no solo la extensión. El logo se guarda en la base de datos del servidor, y subirlo o quitarlo queda en la auditoría. El logo del login es público a propósito (la pantalla de acceso lo necesita antes de iniciar sesión); no contiene nada sensible.

### Portales — real
Lista de los portales registrados: nombre, proyecto, deployment, contenedor y URL. **Aquí se agregan los portales a monitorear, de uno en uno, cuando los vayas teniendo.**

**Agregar portal** (botón arriba a la derecha de la tarjeta)
1. Escribe el **nombre** (el identificador interno se genera de él: "Sala de Prensa" → `sala-de-prensa`), el **proyecto** (namespace de OpenShift), el **deployment**, el **contenedor** (por defecto `wordpress`) y la **URL** del sitio.
2. Proyecto, deployment y contenedor se escriben **tal como están en OpenShift**: solo minúsculas, números y guiones.
3. La URL debe empezar con `https://` y no puede llevar usuario ni clave.
4. Al guardar, el sistema hace enseguida una **revisión de solo lectura** de ese portal para comprobar que tiene permiso. El aviso te dice el resultado:
   - **"responde bien":** ya aparece en el panel con sus datos.
   - **"sin_acceso":** la cuenta del sistema no tiene permiso en ese proyecto. Hay que darle el permiso (RoleBinding) en OpenShift y pulsar "Revisar" en la ficha del portal.
   - **"error"** (por ejemplo, "No existe el deployment en ese proyecto"): revisa los nombres con el lápiz.
   - **"apagado":** el deployment está en 0 réplicas.
   El portal queda guardado en todos los casos; no hace falta volver a agregarlo.

**Editar** (lápiz): cambia cualquier dato. El identificador no cambia. Si cambias el proyecto, deployment o contenedor, se **borran la última lectura y la "imagen anterior" guardadas**, porque eran de otro destino y una vuelta atrás con ellas sería peligrosa.

**Dar de baja** (bote de basura): pide escribir el identificador del portal. El portal deja de monitorearse y de aparecer, pero **no se borra nada**: su historial se conserva, no se toca OpenShift, y se puede volver a agregar con el mismo nombre (se reactiva).

**Reglas**
- Solo el administrador puede agregar, editar o dar de baja portales.
- No se puede editar ni dar de baja mientras hay una **cola de actualización en curso**.
- No puede haber dos portales activos con el mismo nombre ni con el mismo proyecto y deployment.
- Todo queda en la auditoría.

---

## 11. Seguridad

Ruta: `/seguridad`. Disponible para todos los roles. **Real.**

**Cambiar contraseña:** contraseña actual, nueva (mínimo **12 caracteres**) y repetirla; las tres con ojo para verlas.
- La nueva debe ser distinta de la actual.
- Si la actual es incorrecta, se rechaza, y varios intentos fallidos bloquean temporalmente el cambio.
- Al cambiarla se **cierran las demás sesiones** abiertas de esa cuenta (otros equipos); la actual sigue.
- Todo queda en la auditoría.
- **Contraseña temporal:** si un administrador creó tu cuenta o restableció tu clave, esta es la única pantalla que puedes usar hasta cambiarla. Aparece un aviso rojo; escribe la temporal en "Contraseña actual".

**Verificación en dos pasos (MFA):** esta tarjeta solo informa. El MFA se registra en el primer inicio de sesión (con el QR de esa pantalla). Si cambiaste o perdiste el teléfono, un administrador debe restablecer tu MFA desde Usuarios.

*(Se quitaron el QR de ejemplo, los códigos de respaldo y la lista de sesiones activas que antes aparecían aquí: eran datos de muestra, no reales.)*

---

## 12. Sin permisos

Ruta: `/sin-permisos`. Aparece si tu rol no tiene acceso a una sección (por ejemplo, un operador que abre Usuarios). Botón **Volver al panel**.

---

## 13. Resumen: qué es real y qué es de ejemplo

| Pantalla / función | Estado |
|---|---|
| Iniciar sesión, MFA, bloqueos, sesión de 8 h | Real |
| Panel general (todas las columnas, tarjetas, filtros, Revisar ahora) | Real |
| Ficha del portal: Resumen, Plugins, Respaldos y vuelta atrás | Real |
| Ficha del portal: pestaña Historial | Real |
| Cola de actualizaciones (plugins, núcleo/PHP, errores, vuelta atrás) | Real |
| Plugins (matriz y exclusiones de solo lectura) | Real |
| Historial y auditoría (pantalla) | Real |
| Usuarios (crear, rol, activar, restablecer clave y MFA) | Real |
| Configuración: parámetros | Real, solo lectura |
| Configuración: logos (menú y login) | Real |
| Configuración: alta/edición/baja de portales | Real |
| Seguridad (cambiar contraseña) | Real |

### Cosas que conviene saber

- **Versión nueva del núcleo:** viene de la consulta que hace WordPress a su servidor y se guarda en caché dentro del portal. Puede tardar unas horas en reflejar una versión recién publicada.
- **Imágenes de Bitnami:** solo publican la etiqueta `latest` (sin versiones numeradas), por eso la imagen objetivo se fija por digest y hay que actualizarla a mano en el `.env` cuando salga una versión nueva.
- **Portales que se actualizan solos:** si el plugin Easy Updates Manager está en automático, el portal actualiza plugins o núcleo por su cuenta; en el caso del núcleo, esa actualización se **pierde si el pod se reinicia** (la imagen trae su propia versión). La columna "Auto-act." del panel sirve para detectar estos casos.
- **Al reiniciar el backend** se pierde la cola en curso (pero no la auditoría ni los datos de las revisiones).
