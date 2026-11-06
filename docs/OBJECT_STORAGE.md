# Almacén de objetos propio de Capsule

`capsule storage` ya no crea buckets de AWS: el almacén vive en el servidor de Capsule, habla la API de S3 y no depende
de ninguna cuenta de AWS. Los buckets de AWS creados antes **siguen funcionando** sin cambios (ver "Migración").

## Decisión de motor

| Opción | Veredicto |
| --- | --- |
| MinIO | Descartado: la edición comunitaria quedó en mantenimiento y su modelo de usuarios/políticas propio duplicaría el motor de permisos de Capsule. Un contenedor más en un servidor de 4 GB. |
| Garage / SeaweedFS | Descartados: cada uno trae su propio plano de control (layout, claves, cuotas) que habría que sincronizar con Postgres, y otro proceso más que respaldar con su propia lógica. |
| **Servicio propio en Go (`backend/internal/objstore`)** | **Elegido.** Mismo binario que el backend (nada que desplegar ni compilar en el host), claves, cuotas y permisos salen de las tablas y el motor de permisos que ya existen, y se prueba con el SDK oficial de AWS como cliente de compatibilidad. |

Costo asumido de la opción elegida: Capsule mantiene el subconjunto de S3 que implementa (abajo). Lo que no está en la lista
responde `501 NotImplemented`, no falla en silencio.

## Qué implementa

- Objetos: `PutObject`, `GetObject` (con `Range`, `If-Range`, `If-Modified-Since`), `HeadObject`, `DeleteObject`,
  `DeleteObjects`, `ListObjectsV2` y `ListObjects` v1 (prefijo, delimitador, paginación, `encoding-type=url`).
- Multiparte: `CreateMultipartUpload`, `UploadPart`, `ListParts`, `CompleteMultipartUpload`, `AbortMultipartUpload` (hasta
  10 000 partes). Las subidas sin completar se borran a los 7 días.
- Firma: SigV4 por cabecera (carga firmada, `UNSIGNED-PAYLOAD` y `aws-chunked` con firma por trozo, que es lo que usa el SDK
  actual sobre HTTPS con sumas de verificación) y SigV4 por URL prefirmada (`X-Amz-Expires` de 1 s a 7 días).
- No implementa: `CopyObject`, versionado, ACL, políticas de bucket, cifrado del lado del servidor, eventos, ciclo de vida,
  URL estilo host virtual (`bucket.endpoint`; use ruta: `forcePathStyle=true`). Crear/borrar buckets por la API S3 está
  **negado a propósito**: los buckets los gobierna `capsule storage create|delete`.
- CORS abierto en el endpoint S3 (las URL prefirmadas funcionan desde el navegador; el panel sube así).

## Datos, diseño en disco y respaldo

```
<CAPSULE_OBJSTORE_DIR>/<bucket>/data/<aa>/<sha256(clave)>        bytes del objeto
<CAPSULE_OBJSTORE_DIR>/<bucket>/data/<aa>/<sha256(clave)>.json   {key,size,etag,content_type,modified}
<CAPSULE_OBJSTORE_DIR>/<bucket>/.uploads/<id>/                   multiparte en curso
```

- En producción el directorio es el volumen Docker `capsule-objstore` montado en `/data/objstore` del backend
  (`docker-compose.prod.yml`). El índice de listados se reconstruye al arrancar leyendo los `.json`: copiar el directorio es
  un respaldo válido y restaurarlo es copiarlo de vuelta. El índice vive en memoria: pensado para buckets de hasta cientos de
  miles de objetos en este servidor; más allá se mide antes de crecer.
- Escritura atómica: primero los bytes a un temporal y `rename`, luego el `.json`; un corte entre ambos deja un objeto que
  nunca se confirmó y que el arranque ignora.
- **Respaldo integrado** al sistema de backups (`docs/BACKUPS_MANIFEST.md`): cuando el proyecto tiene incluidos los
  volúmenes (`capsule backups set --volumes`), cada ejecución añade un snapshot `kind = objects` (`source = objstore`):
  tar.gz de los buckets del proyecto, cifrado con el mismo sobre que el resto y subido a
  `projects/<projectID>/objects/<RFC3339>-<runID>.tar.gz.enc`. `capsule backups restore` lo restaura: extrae en un directorio
  temporal, y solo si el archivo entero es válido cambia cada bucket (si falla, los datos vivos quedan intactos); solo se
  tocan buckets que pertenezcan al proyecto. La verificación de backups (API `/backups/verify`) comprueba su descifrado y suma de verificación.
- El destino del respaldo es el mismo que el del resto de datos del servidor (el bucket de respaldos ya existente).

## Credenciales, cuotas y permisos

- Cada bucket tiene **su** clave (`CAPS…`) y secreto. El secreto se guarda cifrado con `CAPSULE_SECRET_KEY` (igual que
  las credenciales de bases) y solo lo ve quien tiene `project.env_reveal` (`capsule storage show --reveal`).
  `capsule storage rotate` genera un par nuevo y el anterior deja de funcionar al instante (la caché de la ruta caliente es
  de 3 s como máximo).
- Una clave solo autoriza **su** bucket. Un bucket público permite `GET`/`HEAD` anónimo de objetos, nunca listar ni escribir.
- Cuotas: por bucket (`--max-size`), por proyecto y por organización (`capsule storage quota --project-max 50GB --org-max 1TB`,
  solo owner/admin de la organización). Valores por omisión de la plataforma: `CAPSULE_OBJSTORE_DEFAULT_PROJECT_BYTES` y
  `CAPSULE_OBJSTORE_DEFAULT_ORG_BYTES` (vacío = sin límite). Se cuentan los objetos y las partes de multiparte en curso; una
  escritura que pasaría el tope se rechaza con `403 QuotaExceeded` (la API de Capsule: `QUOTA_EXCEEDED`). El tope se aplica
  también al cuerpo recibido (no se puede evadir con `Content-Length` falso ni chunked).
- Permisos del motor atómico (`docs/permissions/`), sin átomos nuevos:

| Ruta | Átomo (acción de transición) |
| --- | --- |
| `GET …/storage`, `GET …/storage/{id}`, `GET …/storage/{id}/objects`, `GET …/storage/quota` | `storage:read` (`project.read`; `Get` además usa `project.env_reveal` para el secreto) |
| `POST …/storage`, `PATCH …/storage/{id}`, `DELETE …/storage/{id}`, `POST …/rotate`, `PUT …/storage/quota` | `storage:manage` (`project.databases`) |
| `POST …/presign`, `…/uploads*`, `DELETE …/objects` | `storage:presign` (`project.ops`) |
| `GET/PUT /orgs/{org}/storage/quota` | miembro de la organización / owner o admin |

## Acceso

| Quién | Cómo |
| --- | --- |
| App en el mismo servidor | `S3_ENDPOINT=http://host.docker.internal:9000` (puerto publicado del oyente S3 del backend, igual que las bases: `connaudit` lo clasifica como ruta correcta). Sin TLS: no sale de la máquina. |
| Fuera del servidor | `https://<proyecto>-storage.apps.tumi-ai.com` (TLS con el certificado comodín existente), estilo ruta. Caddy lleva ese Host **directo** al oyente S3 (`deploy/forgejo/caddy/capsule-sites.caddy`, sin reescribir la ruta porque la firma la cubre y sin los límites de tiempo del servidor principal). Además la ruta `/_proxy/<proyecto>-storage` del backend sirve la misma API (quita el prefijo antes de verificar la firma y solo expone los buckets de ese proyecto). |
| CLI / panel | `capsule storage put|get|ls|rm|presign`, sección **Almacenamiento** del proyecto. |

No hace falta ningún registro DNS nuevo: `*.apps.tumi-ai.com` ya apunta al servidor y su certificado comodín cubre
`<proyecto>-storage.apps.tumi-ai.com`.

**Gateway (`capsule://`).** El almacén se expone por el host con TLS de arriba, que es HTTP estándar y no necesita túnel; no se
registra como servicio del gateway (el gateway enruta TCP/UDP con encabezado propio, innecesario para un endpoint HTTPS con
firma). Quien quiera igualmente un nombre `capsule://proyecto/almacen` debe registrar un servicio `http` hacia el 9000.
Lo que sí va por el gateway es el **SFTP** (sección SFTP): servicio `sftp` del proyecto.

**Puerto 9000.** `docker-compose.prod.yml` lo publica para `host.docker.internal`. El grupo de seguridad del host no lo abre
(como los puertos de bases sin regla): desde fuera solo se llega por el 443 de Caddy. No abrir el 9000 al exterior.

### Variables que recibe el proyecto

Al crear (o rotar) un bucket, Capsule escribe en el entorno del proyecto (las toma el siguiente despliegue):

`STORAGE_<NOMBRE>_ENDPOINT|PUBLIC_ENDPOINT|BUCKET|ACCESS_KEY|SECRET_KEY|REGION` siempre, y los alias estándar
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE=true` para el primer
bucket (si ya hay otro dueño de `S3_*`, el segundo bucket solo usa `STORAGE_<NOMBRE>_*`). `capsule storage delete` retira las
suyas. Los secretos se guardan como variables secretas.

```js
// Node, SDK v3
new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } })
```

## CLI

```bash
capsule storage create --name archivos [--public] [--max-size 10GB]
capsule storage list ; capsule storage show archivos [--reveal]
capsule storage put ./informe.pdf archivos/2026/informe.pdf      # >16 MB: multiparte y reanudable
capsule storage put -r ./dist archivos/sitio/                     # directorio
capsule storage get archivos/2026/informe.pdf ./copia.pdf         # reanuda con Range
capsule storage ls archivos/2026/ [-r]
capsule storage rm archivos/2026/informe.pdf [-r]
capsule storage presign archivos/2026/informe.pdf --expires 1h [--method put]
capsule storage rotate archivos ; capsule storage update archivos --public=false --max-size 0
capsule storage quota [--project-max 50GB] [--org-max 1TB] ; capsule storage delete archivos
```

La subida reanudable guarda su estado en el directorio de caché del usuario (`capsule/uploads/`): si se interrumpe, repetir el
mismo comando pide al servidor qué partes ya tiene y solo envía las que faltan (las URL de las partes se firman de nuevo).

## API (resumen)

`POST|GET /orgs/{o}/projects/{p}/storage`, `GET|PATCH|DELETE …/storage/{id}`, `POST …/{id}/presign {key, method, expires}`,
`POST …/{id}/rotate`, `GET|DELETE …/{id}/objects`, `POST …/{id}/uploads {key,size,part_size,upload_id?}`,
`GET …/{id}/uploads/{uid}`, `POST …/{id}/uploads/{uid}/complete {parts}`, `DELETE …/{id}/uploads/{uid}`,
`GET|POST …/{id}/ssh-keys`, `DELETE …/{id}/ssh-keys/{id|nombre|huella}` (claves SSH del SFTP),
`GET|PUT …/storage/quota`, `GET|PUT /orgs/{o}/storage/quota`.

## SFTP

Para entrar a los buckets con `sftp`, `scp`, WinSCP o FileZilla. Es un servidor SSH propio (`golang.org/x/crypto/ssh` +
`github.com/pkg/sftp`, paquete `backend/internal/objstore/sftpd`) que corre **dentro del backend**, delante del mismo motor y de
las mismas reservas atómicas de cuota que la API S3. No abre un puerto público: lo alcanzan el gateway y las apps del mismo servidor.

### Cómo se entra

| Quién | Cómo |
| --- | --- |
| Persona (PC) | por el gateway, como servicio `sftp` del proyecto (`capsule://<proyecto>/sftp`): `capsule storage sftp <bucket>`, o `sftp`/`scp` con `ProxyCommand` (abajo). |
| App en el mismo servidor | `host.docker.internal:2222` (puerto publicado del oyente, igual que el 9000). Mismo usuario y contraseña. |

El servicio `sftp` aparece solo: cuando el proyecto tiene al menos un bucket del almacén propio, el gateway lo crea (protocolo `ssh`,
acceso por gateway activo, **sin** puerto directo abierto) la primera vez que se lista o se resuelve un servicio del proyecto
(por ejemplo con `capsule connect capsule://<proyecto>/sftp`); desaparece con el último bucket. Si el proyecto ya
tiene un servicio propio llamado `sftp`, no se toca. No hace falta ningún DNS nuevo.

**Credenciales.** Usuario = nombre del bucket (`<proyecto>-<org>-<nombre>`), o `<proyecto>-<nombre>`, o la clave de acceso. Contraseña =
el **secreto** del bucket (`capsule storage show <bucket> --reveal`; rotar el secreto lo cambia también para SFTP) **o** una clave pública SSH
registrada para ese bucket:

```bash
capsule storage ssh-keys add archivos --file ~/.ssh/id_ed25519.pub [--name portatil]
capsule storage ssh-keys list archivos
capsule storage ssh-keys rm archivos portatil
```

Claves aceptadas: ed25519, ecdsa, RSA de 2048 bits o más y llaves FIDO (`sk-…`); sin certificados ni opciones (`command=`). Hasta 20 por
bucket. Quitar una clave surte efecto en segundos (caché de 3 s). No existen usuarios del sistema operativo ni acceso al disco: el
servidor solo ve el bucket.

### Comandos

```bash
capsule storage sftp archivos                 # abre sftp por el gateway
capsule storage sftp archivos --print         # guía completa (sftp, scp, ssh_config, WinSCP, FileZilla; también está en el panel)
sftp -o ProxyCommand="capsule connect --stdio capsule://mi-proyecto/sftp" -o HostKeyAlias=mi-proyecto-sftp.capsule \
     mi-proyecto-mi-org-archivos@mi-proyecto-sftp.capsule
scp  -o ProxyCommand="capsule connect --stdio capsule://mi-proyecto/sftp" -o HostKeyAlias=mi-proyecto-sftp.capsule \
     ./informe.pdf mi-proyecto-mi-org-archivos@mi-proyecto-sftp.capsule:/2026/informe.pdf
```

Con `capsule ssh` el mismo servicio sirve como subsistema: `capsule ssh mi-proyecto/sftp -l <bucket> -- -s sftp`. Para no repetir las
opciones, `capsule ssh mi-proyecto/sftp -l <bucket> --print` imprime un bloque de `~/.ssh/config`; después basta `sftp mi-proyecto-sftp.capsule`.

- **WinSCP:** Nuevo sitio > protocolo SFTP > servidor `mi-proyecto-sftp.capsule`, puerto 22, usuario = bucket, contraseña = secreto. En
  Avanzado > Conexión > Proxy: tipo «Local» y comando `"C:\ruta\capsule.exe" connect --stdio capsule://mi-proyecto/sftp`.
- **FileZilla:** no admite comando de proxy. Abrir `capsule tunnel mi-proyecto/sftp --listen 127.0.0.1:2222` y conectar a
  `127.0.0.1:2222` (protocolo SFTP, tipo de acceso Normal, usuario = bucket, contraseña = secreto).
- Clave de host: es fija (guardada en el volumen del almacén, `/data/objstore/.sftp/host_ed25519`, y no cambia al reiniciar ni al
  redesplegar). La huella `SHA256:…` sale en `capsule storage show`, en `capsule storage sftp --print`, en el panel y en el registro de arranque del backend. Con
  `HostKeyAlias` cada proyecto guarda la suya en `known_hosts`.

### Qué hace cada operación

El bucket es un árbol de carpetas: una carpeta es un prefijo terminado en `/`; `mkdir` crea el marcador `carpeta/` (objeto vacío, como la
consola de S3) y las carpetas con objetos existen sin marcador.

| SFTP | Efecto |
| --- | --- |
| `ls`, `stat` | lista por páginas del índice ordenado (carpetas de millones de objetos sin cargarlas enteras) |
| `get`, lectura de rangos | `ReadAt` sobre el archivo del objeto: cualquier rango, descargas reanudables (`reget`, FileZilla) |
| `put`, escritura por trozos | las escrituras (en cualquier orden y en paralelo) se ensamblan en un archivo de trabajo del bucket (`.sftp/`, invisible y fuera del respaldo de objetos) y al cerrar se publican como **un** objeto, de forma atómica |
| reanudar (`reput`, FileZilla) | una subida cortada por la red deja el objeto parcial (si la clave no existía); abrir sin truncar parte de los bytes guardados, así `reput`/«reanudar» continúa desde el tamaño remoto. Una subida que **sobrescribía** un objeto y se corta conserva el anterior |
| `rm` | borra el objeto (no borra carpetas) |
| `rename` | mueve objetos dentro del bucket **sin copiar los bytes** (reemplaza el destino de forma atómica); una carpeta se renombra objeto a objeto |
| `mkdir`, `rmdir` | marcador de prefijo; `rmdir` solo si está vacía |
| `chmod`, `chown`, fecha | se aceptan y se ignoran (los clientes los envían tras subir); `symlink`, `link`, `readlink`: no existen |

**Cuotas.** Cada escritura que hace crecer el archivo reserva sus bytes con la misma comprobación atómica de la API S3 (bucket, proyecto y
organización, contando lo que otras subidas ya reservaron), así que dos subidas simultáneas no pasan por el mismo espacio libre. Al pasarse,
la escritura falla con `quota exceeded: the storage quota of this bucket, project or organization is exhausted`, no se publica nada a medias y la
reserva se libera al instante. Sobrescribir un objeto solo necesita la diferencia. Un bucket público (`--public`) sigue siendo de lectura
anónima solo por la API S3/HTTP; SFTP nunca admite acceso anónimo: siempre hace falta secreto o clave, y con ellos se lee y se escribe como en la API.

### Seguridad

- Solo el subsistema `sftp`: se rechazan `shell`, `exec`, `pty-req`, `env`, `x11-req`, agente (`auth-agent-req`), `direct-tcpip`,
  `tcpip-forward` y cualquier otro subsistema.
- Aislamiento: la sesión está atada al bucket de su inicio de sesión; la ruta se normaliza como cadena contra `/` (`..` y las rutas
  absolutas nunca salen del bucket) y ninguna ruta llega al sistema de archivos del host (los objetos se direccionan por hash de la clave).
  Hay pruebas de aislamiento entre buckets y de escape de ruta.
- Límites (todos configurables, valores por omisión): 128 conexiones en total, 64 por dirección de origen (detrás del gateway comparten una),
  8 por bucket, 64 archivos abiertos por conexión, 4 intentos de autenticación por conexión, 10 fallos por (origen, usuario) cada 5 min
  antes de bloquear y 400 ms de pausa en cada fallo (igual para un usuario inexistente que para un secreto equivocado), 20 s para terminar el
  inicio de sesión, **10 min de inactividad**, **40 MiB/s por conexión y 120 MiB/s en total** en cada sentido, paquetes SFTP de como máximo 256 KiB
  (la conexión se cierra con uno mayor).
- Auditoría por el mismo camino que el resto del almacén (el registro estructurado del backend, `slog`): `sftp login`, `sftp login failed`,
  `sftp disconnect` (con bytes y duración), y por objeto `sftp write` (clave, tamaño, ETag), `sftp read`, `sftp delete`, `sftp rename`,
  `sftp mkdir`, `sftp rmdir`, `sftp quota exceeded`; las claves SSH registradas o quitadas se registran como `storage ssh key added|removed`.

### Variables del servidor (SFTP)

| Variable | Valor / efecto |
| --- | --- |
| `CAPSULE_OBJSTORE_SFTP_ADDR` | oyente SFTP, `:2222` por omisión; `off` lo desactiva |
| `CAPSULE_OBJSTORE_SFTP_INTERNAL` | dirección que ven las apps: `host.docker.internal:<puerto>` por omisión |
| `CAPSULE_OBJSTORE_SFTP_HOSTKEY` | ruta de la clave de host (por omisión `<CAPSULE_OBJSTORE_DIR>/.sftp/host_ed25519`) |
| `CAPSULE_SFTP_MAX_CONNS`, `CAPSULE_SFTP_MAX_CONNS_PER_BUCKET` | conexiones en total (128) y por bucket (8) |
| `CAPSULE_SFTP_IDLE` | inactividad, formato Go (`10m`) |
| `CAPSULE_SFTP_CONN_BPS`, `CAPSULE_SFTP_TOTAL_BPS` | bytes por segundo por conexión (41943040) y total (125829120); negativo = sin límite |
| `CAPSULE_SFTP_MAX_OBJECT_BYTES` | tamaño máximo de un objeto subido por SFTP (0 = solo mandan las cuotas) |

El gateway lee `CAPSULE_OBJSTORE_SFTP_ADDR` para saber a qué puerto del host enrutar (el mismo `CAPSULE_GW_DEST_HOST` que usa para los puertos de las bases).

### Despliegue del SFTP

Un backend nuevo, sin recrear el gateway: migración `000075_objstore_ssh_keys` (tabla `objstore_ssh_keys`; si la rama de funciones/VPN también trae un
`000075`, la que se una después renumera a `000076`), puerto 2222 publicado en `docker-compose.prod.yml` (`- "2222:2222"`, variables
`CAPSULE_OBJSTORE_SFTP_*` opcionales), **sin** regla en el grupo de seguridad (como el 9000). El binario del backend se compila en el PC y
se arma la imagen mínima en el host; el gateway no se recrea: el servicio `sftp` se crea solo en la base y el plano de datos lo toma por la
sincronización normal de rutas. Compose solo se aplica al servicio `backend` (`up -d backend`), nunca al `capsule-gateway`.
## Configuración del servidor

| Variable | Valor / efecto |
| --- | --- |
| `CAPSULE_OBJSTORE_DIR` | directorio de datos (compose: `/data/objstore`). **Vacío = almacén deshabilitado** y `storage create` aprovisiona buckets de AWS como antes. |
| `CAPSULE_OBJSTORE_ADDR` | oyente S3 dedicado, `:9000` por omisión. Sin plazos de lectura/escritura (subidas grandes). |
| `CAPSULE_OBJSTORE_INTERNAL_ENDPOINT` | `http://host.docker.internal:9000` |
| `CAPSULE_OBJSTORE_PUBLIC_ENDPOINT` | opcional: plantilla del endpoint público, con `{slug}` (por omisión `https://{slug}-storage.<CAPSULE_APPS_DOMAIN>`); pruebas locales: `http://localhost:9000` |
| `CAPSULE_OBJSTORE_DEFAULT_PROJECT_BYTES`, `CAPSULE_OBJSTORE_DEFAULT_ORG_BYTES` | cuotas por omisión (0 o vacío = sin límite) |

Despliegue: el cambio es un backend nuevo (migración `000074_objstore`, volumen `capsule-objstore`, puerto 9000, bloque
`@storage` de Caddy). El binario del backend se compila en el PC (nunca en el host) y el bloque de Caddy se recarga con
SIGHUP, **no** recreando el gateway.

## Migración de buckets existentes

- Las filas `databases` con `engine = 's3'` no se tocan: `capsule storage list` las muestra como `aws-s3`, `presign`
  (`s3://bucket/clave`), `show` y `delete` siguen usando AWS. `ls|put|get|rm|rotate|update` responden con un mensaje claro
  de que ese bucket es de AWS.
- Para pasar un bucket de AWS al almacén propio: `capsule storage create --name nuevo`, copiar con
  `aws s3 sync s3://capsule-<org>-<nombre> ./tmp && capsule storage put -r ./tmp nuevo/`, cambiar las variables de la app y,
  cuando esté verificado, `capsule storage delete` del bucket viejo. No hay migración automática: mover datos entre dos
  almacenes sin una ventana de verificación sería perderlos si algo falla.
