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
`GET|PUT …/storage/quota`, `GET|PUT /orgs/{o}/storage/quota`.

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
