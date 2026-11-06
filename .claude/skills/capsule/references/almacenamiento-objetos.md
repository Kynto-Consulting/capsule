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

## SFTP (`sftp`, `scp`, WinSCP, FileZilla)

Fuente: sección SFTP de `docs/OBJECT_STORAGE.md`. El bucket se ve como un árbol de carpetas (prefijos con `/`); no hay puerto público:
se entra por el gateway, como el servicio `sftp` del proyecto (`capsule://<proyecto>/sftp`, aparece solo si el proyecto tiene buckets).

```bash
capsule storage sftp archivos                 # abre sftp por el gateway (binario nativo + OpenSSH)
capsule storage sftp archivos --print         # guía: sftp, scp, ~/.ssh/config, WinSCP, FileZilla
capsule storage ssh-keys add archivos --file ~/.ssh/id_ed25519.pub [--name portatil]
capsule storage ssh-keys list archivos ; capsule storage ssh-keys rm archivos portatil
sftp -o ProxyCommand="capsule connect --stdio capsule://mi-proyecto/sftp" -o HostKeyAlias=mi-proyecto-sftp.capsule <bucket>@mi-proyecto-sftp.capsule
```

- Usuario = nombre del bucket (o `<proyecto>-<nombre>`, o la clave de acceso); contraseña = el **secreto** del bucket, o una clave pública SSH
  registrada para él (ed25519, ecdsa, RSA ≥ 2048; máx. 20). Rotar el bucket cambia también la contraseña SFTP. No pegues el secreto en chat.
- WinSCP: proxy tipo «Local» con `capsule connect --stdio capsule://<proyecto>/sftp`. FileZilla: `capsule tunnel <proyecto>/sftp --listen 127.0.0.1:2222`
  y conectar a ese puerto. Una app del mismo servidor usa `host.docker.internal:2222`.
- Subidas reanudables (`reput`, «reanudar» de FileZilla): un corte deja el objeto parcial y se continúa desde su tamaño; si la subida
  sobrescribía un objeto, el anterior se conserva. `rename` mueve objetos sin copiar bytes; `mkdir` crea un marcador `carpeta/`.
- Mismas cuotas y reservas atómicas que la API S3: al pasarse, error `quota exceeded` y no queda nada a medias. Un bucket `--public` sigue siendo
  de lectura anónima solo por HTTP; por SFTP siempre hace falta secreto o clave.
- Sin shell, exec, reenvío de puertos ni agente; sin enlaces simbólicos; 10 min de inactividad, 40 MiB/s por conexión, 8 conexiones por bucket.
- Permisos: ver las claves `storage:read`; registrarlas o quitarlas `storage:manage`.

## Montar el almacén como disco (rclone)

Sin probar en producción (rclone no estaba instalado en el equipo de pruebas). Dos caminos; las claves salen de
`capsule storage show <bucket> --reveal`.

```bash
# S3 (path-style, firma v4): host público del proyecto
rclone config create capsule s3 provider=Other endpoint=https://<proyecto>-storage.apps.tumi-ai.com \
  access_key_id=<clave> secret_access_key=<secreto> force_path_style=true region=us-east-1
rclone mount capsule:<bucket> ~/capsule-disco --vfs-cache-mode writes     # Windows: requiere WinFsp

# SFTP: usa los comandos de conexión que muestra `capsule storage show` (sección SFTP)
```
