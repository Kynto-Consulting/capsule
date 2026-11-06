# Almacén de objetos (`capsule storage`)

Fuente: `docs/OBJECT_STORAGE.md`. Es el almacén **propio** de Capsule (compatible con S3, en el servidor): no usa AWS.

```bash
capsule storage create --name archivos [--public] [--max-size 10GB]   # crea el bucket, su clave/secreto y las variables S3_* del proyecto
capsule storage list ; capsule storage show archivos [--reveal]
capsule storage put ./f.bin archivos/ruta/f.bin     # >16 MB: multiparte reanudable (repetir el comando reanuda)
capsule storage put -r ./carpeta archivos/prefijo/
capsule storage get archivos/ruta/f.bin ./f.bin     # reanuda con Range
capsule storage ls archivos/ruta/ [-r] ; capsule storage rm archivos/ruta/f.bin [-r]
capsule storage presign archivos/ruta/f.bin --expires 1h [--method put]   # URL GET o PUT; máx 7 días
capsule storage rotate archivos ; capsule storage update archivos --public=true --max-size 0
capsule storage quota [--project-max 50GB] [--org-max 1TB] ; capsule storage delete archivos
```

## Reglas

- Una app **en el mismo servidor** usa `S3_ENDPOINT=http://host.docker.internal:9000` (ya inyectado); fuera del servidor,
  `https://<proyecto>-storage.apps.tumi-ai.com`. Siempre `forcePathStyle=true`. No hace falta tocar el DNS.
- Las variables `S3_*` y `STORAGE_<NOMBRE>_*` se escriben en el proyecto al crear o **rotar** el bucket; llegan al siguiente
  despliegue. Tras `rotate` hay que redesplegar: la clave vieja deja de valer al instante.
- `create` y `show --reveal` imprimen el secreto: no lo pegues en chat ni en logs; usa las variables del proyecto.
- `--public` da lectura anónima de objetos (no listar ni escribir): pide confirmación al usuario antes.
- Cuotas por bucket, proyecto y organización. Un `403 QuotaExceeded` se resuelve con `capsule storage quota` (cambiar el tope
  de proyecto/organización exige owner/admin de la organización) o borrando objetos; no reintentes.
- Los buckets de AWS anteriores (`KIND aws-s3` en `list`) solo admiten `presign s3://bucket/clave`, `show` y `delete`.
- Respaldo: va con `capsule backups` cuando el proyecto incluye volúmenes (snapshot `objects`); restaurarlo reemplaza los
  buckets del proyecto: confirma con el usuario.
- Permisos: leer/listar `storage:read`; crear, borrar, rotar, cambiar el tope de proyecto `storage:manage`; subir/firmar/borrar
  objetos `storage:presign`. Un token `deploy` no administra buckets.
