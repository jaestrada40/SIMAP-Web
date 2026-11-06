# SIMAP-Web: solicitud a administración de OpenShift

Fecha: 5-nov-2026. Para: administradores del clúster `api.ocp4.mfpweb.local`. De: equipo SIMAP-Web.

**Resumen en una línea:** SIMAP-Web es una aplicación interna que monitorea y actualiza los portales WordPress institucionales. Necesitamos (A) permisos mínimos y acotados por proyecto para su cuenta de servicio, y (B) definir cómo se respaldan los portales, porque hoy el único respaldo está dentro del mismo volumen del sitio.

---

## Contexto breve

- Vigila ~29 deployments de WordPress en 28 proyectos (lista al final): versión de PHP, de WordPress y de plugins, espacio de disco y que el sitio responda.
- Actualiza **de uno en uno**, con confirmación escrita, respaldo de la base antes de cambiar nada y registro de auditoría de solo inserción.
- Todo lo que ejecuta dentro de un pod sale de una **lista cerrada de comandos fijos** (`wp`, `php`, `df`, `stat`); nunca se arma un comando con texto escrito por una persona.
- Hoy corre en una máquina de desarrollo con la sesión `oc login` de una persona. El objetivo es desplegarlo en un proyecto propio `simap-web` con una ServiceAccount propia.

---

## A. Permisos

### A1. Proyecto y cuenta de servicio

1. Crear el proyecto `simap-web`.
2. Crear en él la ServiceAccount `simap-web`.
3. Espacio para la base de datos de la propia aplicación (Postgres): ~5 GB de volumen persistente. Guarda usuarios, auditoría y la lista de portales.
4. Una ruta con TLS para acceder a la aplicación, restringida a la red interna.

### A2. Permisos en cada proyecto de WordPress

No se pide `cluster-admin` ni ningún permiso a nivel de clúster. Solo un `Role` + `RoleBinding` **por proyecto**, con el archivo `simap-rbac.yaml` que acompaña esta solicitud:

```
oc apply -n <proyecto> -f simap-rbac.yaml
```

| Recurso | Verbos | Para qué lo usa el código |
|---|---|---|
| `deployments` (apps) | `get` | Leer la imagen y las réplicas del portal. |
| `pods` | `get`, `list` | Encontrar el pod listo y comprobar que el reinicio terminó. |
| `pods/exec` | `get`, `create` | Ejecutar los comandos fijos de lectura y actualización dentro del pod. Se piden los dos verbos porque `exec` por WebSocket entra como GET y luego POST. |
| `deployments` (apps) | `patch` | **Opcional** (segundo Role del archivo). Solo para cambiar la imagen al actualizar núcleo/PHP y para "Volver atrás". |

**Variante conservadora:** si prefieren no dar `patch`, apliquen solo el primer Role. El monitoreo y la actualización de plugins funcionan igual; la actualización de núcleo/PHP quedaría solo de lectura. También se puede acotar `patch` a un deployment concreto agregando `resourceNames`.

**Lo que NO se pide:** listar proyectos o deployments a nivel de clúster, leer `Secrets` o ConfigMaps, crear/borrar recursos, `delete` de ningún tipo, ni acceso a otros proyectos.

### A3. Sobre el riesgo (dicho con franqueza)

- `pods/exec` es un permiso fuerte: permite ejecutar comandos dentro de los pods de WordPress. Lo acota que el `Role` es **por proyecto** (solo los de la lista) y que la aplicación solo ejecuta su lista cerrada de comandos.
- `patch` sobre deployments también lo es. Lo acotan, en la aplicación: solo acepta imágenes identificadas por `@sha256:` (no etiquetas), la imagen objetivo la fija el servidor y no el navegador, exige escribir el nombre del portal para confirmar, rechaza deployments con triggers de imagen de OpenShift y deja todo en auditoría.
- Un compromiso de la aplicación sí daría acceso a esos comandos en los 28 proyectos. Por eso la aplicación exige usuario y contraseña, MFA (TOTP), bloqueo por intentos, sesiones de 8 horas y roles (solo el administrador y el operador pueden actualizar).

### A4. Estado actual de acceso (comprobado el 5-nov-2026)

Con la sesión de pruebas (`oc login`, usuario `jestrada`), `oc auth can-i get deployments`, `create pods/exec` y `patch deployments` responden **sí en los 28 proyectos**. Es decir, para seguir usando la aplicación en la máquina de desarrollo **no falta ningún permiso**. Lo que sí hace falta es la ServiceAccount con permisos acotados (A1 y A2), para no depender de una cuenta personal cuando corra dentro del clúster.

Para comprobar que quedó bien, por proyecto:

```
oc auth can-i get deployments  --as=system:serviceaccount:simap-web:simap-web -n <proyecto>
oc auth can-i create pods/exec --as=system:serviceaccount:simap-web:simap-web -n <proyecto>
oc auth can-i delete deployments --as=system:serviceaccount:simap-web:simap-web -n <proyecto>   # debe decir "no"
```

---

## B. Respaldos

### Situación actual

- Antes de cada actualización, SIMAP-Web exporta la base de datos de ese portal a **un solo archivo** (`/bitnami/simap-respaldo.sql`) **dentro del mismo volumen que el sitio**. Cada actualización lo **sobrescribe**.
- Protege ante un error de la actualización. **No** protege ante la pérdida o el daño del volumen, ni guarda historial, ni cubre los archivos subidos (`wp-content/uploads`), temas y plugins.

### Lo que descubrimos del respaldo por SFTP

- Los portales respaldaban con **UpdraftPlus** y enviaban las copias por **SFTP**. Eso es una función de **pago** del plugin; la licencia **se dejó de pagar hace unos 6 meses**, y desde entonces las copias **no salen del portal**: se quedan en el mismo volumen del sitio (o no se conserva ninguna).
- En `portal-gl/wordpress` (producción), el único registro de copia que conserva el plugin es del **26-nov-2024**, con destino SFTP y 176 piezas: se envió y se borró localmente. Los registros de antes se perdieron con el tiempo y los registros de error ya no existen, así que **no sabemos por qué en algunos portales fallaba la conexión**.
- **Pregunta importante:** ¿el **servidor SFTP viejo sigue existiendo** y todavía conserva esas copias? Aunque el plugin ya no pueda leerlas, podrían ser el único respaldo externo de algunos portales. Si el servidor se va a dar de baja, **antes hay que rescatar lo que tenga**.

### Qué necesitamos saber y pedir

1. **¿Ya existe un respaldo de plataforma** para los volúmenes y las bases MariaDB de estos proyectos (OADP/Velero, snapshots de almacenamiento, otro)? Si existe, solo hay que enterarse de su frecuencia y de cómo restaurar. **Esta es la pregunta más importante:** puede que la mitad del trabajo ya esté hecha.
2. Si no existe, decidir **un destino externo** para las copias. Opciones, de más a menos recomendable:
   - **Respaldo de plataforma** (lo que ya se pidió abajo): cubre todos los portales sin depender de plugins ni licencias.
   - **Que SIMAP-Web envíe las copias a un servidor SFTP** (el viejo u otro): no depende de la licencia del plugin. Hay que construirlo; necesita host, puerto, usuario, tipo de autenticación, carpeta, la huella del servidor y que sea alcanzable desde donde corra SIMAP-Web.
   - **Destinos gratuitos de UpdraftPlus** que no piden licencia: almacenamiento compatible con S3 (por ejemplo un MinIO interno), Dropbox o Google Drive. FTP también existe pero **no va cifrado**: no lo recomendamos.
   - **Volver a pagar la licencia** de UpdraftPlus y reactivar el SFTP.
   Además, en cualquier caso, pedimos:
   - **Respaldo programado de los volúmenes** de cada WordPress (datos del sitio y `.sql`) y de cada **MariaDB** (cada proyecto tiene la suya), con una **copia fuera del clúster** o al menos en un almacenamiento distinto al del volumen.
   - **Retención** acordada. Propuesta inicial para discutir: diarios 14 días y semanales 4 semanas.
   - **Cifrado y control de acceso** a las copias: contienen datos de usuarios y hashes de contraseñas de WordPress.
   - **Procedimiento de restauración documentado y probado** al menos una vez en un portal de pruebas (por ejemplo `portal-dotacion/wordpress-test`).
3. **Respaldo de la propia SIMAP-Web:** su base Postgres (usuarios, auditoría, portales, logos). La auditoría es de solo inserción y tiene valor de evidencia.
4. **Opcional, a evaluar con ustedes:** que SIMAP-Web pueda tomar un *snapshot* del volumen justo antes de actualizar núcleo/PHP (requiere permiso `create` sobre `volumesnapshots` en cada proyecto y soporte de snapshots en el almacenamiento). **No está construido**; solo lo proponemos si el almacenamiento lo permite.

---

## C. Otros puntos que conviene confirmar

1. **Huella de la CA del router.** La aplicación confía en la CA interna del router de OpenShift para comprobar los sitios por HTTPS (no se desactiva la verificación TLS). La obtuvimos de lo que presenta el router, no del ConfigMap. Piden confirmar que coincide:
   - Sujeto: `CN=ingress-operator@1762881527`, vence el **11-nov-2027**.
   - SHA-256: `D6:46:6B:35:8B:A6:76:4B:E5:EC:B5:62:7C:A1:68:4B:43:3D:21:60:48:88:49:17:8E:AD:B3:CF:C9:68:F2:D9`
2. **Hallazgos al inventariar, para que los revisen** (no son parte de SIMAP-Web):
   - En `portal-dotacion` hay una **ruta pública** hacia el servicio de MariaDB (`mariadb01-portal-dotacion…`). Conviene revisar si debe existir.
   - En `portaltnga` hay una ruta suelta `wordpress-test` que parece sobrante.
3. **Portales con imagen propia** (8 deployments cuya imagen está en el registro interno de OpenShift, lista abajo): SIMAP-Web los monitorea y actualiza sus plugins, pero **no** puede actualizarles núcleo/PHP cambiando la imagen: eso se hace reconstruyéndola. No requiere nada de ustedes ahora.

---

## Lista de proyectos y deployments

**Imagen Bitnami de Docker Hub (21 deployments en 20 proyectos):** atencion-virtual/wordpress02 · certificacion-adquisiciones-publicas/wordpress02 · informacionpublica/wordpress y wordpressdesafiogt · portal-compras-sostenibles/wordpress03 · portal-credito-publico/wordpress · portal-dotacion/wordpress · portal-gl/wordpress · portal-ong/wordpress · portal-presupuesto-dtp/wordpress · portal-rgae/wordpress · portal-rrhh/wordpress01 · portal-sidif/wordpress02 · portaltnga/wordpress02 · portalfideicomisos/wordpress02 · prestamosexternos/wordpress02 · saladeprensa/wordpress02 · transferencias-codedes/wordpress01 · transparenciagubernamental/wordpress · transparenciapresupuestaria/wordpress · proyectoswordpressqa/wordpress (QA).

**Imagen propia en el registro interno (8 deployments en 8 proyectos):** portal-transparencia-fiscal/wordpress · portaldapf/wordpress · portalgl/wordpress02 · portalreadecuacion/wordpress · presupuestoabierto/wordpress · tablero-expweb-dtp/wordpress01 · tallerdepresupuesto/wordpress04 · tallerdepresupuestoabierto/wordpress.

Pendiente de confirmar internamente si son productivos: `proyectoswordpressqa/wordpress`, `tallerdepresupuesto/wordpress04`, `tallerdepresupuestoabierto/wordpress`, `informacionpublica/wordpressdesafiogt`, `portalgl/wordpress02`. Se pueden aplicar los permisos igual; cuáles se monitorean se decide dentro de SIMAP-Web.

---

## Lo que necesitamos de ustedes (lista para responder)

- [ ] Crear el proyecto `simap-web`, la ServiceAccount `simap-web`, volumen de ~5 GB para Postgres y la ruta interna con TLS.
- [ ] Aplicar `simap-rbac.yaml` en los proyectos de la lista. ¿Con `patch` (completo) o sin `patch` (conservador)?
- [ ] ¿Existe respaldo de plataforma de los volúmenes y de las MariaDB? ¿Con qué frecuencia, retención y dónde se guarda?
- [ ] Si no existe: definir respaldo programado con copia externa, retención, cifrado y una restauración probada.
- [ ] Respaldo de la base Postgres de SIMAP-Web.
- [ ] Confirmar la huella SHA-256 de la CA del router.
- [ ] Revisar la ruta pública de MariaDB en `portal-dotacion` y la ruta suelta de `portaltnga`.
