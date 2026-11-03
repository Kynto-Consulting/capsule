# Informe de conexiones internas del deploy

Al desplegar, Capsule avisa si la app se conecta a servidores internos de Capsule **sin enrutar con el protocolo** del gateway (puertos directos del host, loopback, puente de Docker, nombres de contenedor, redes privadas, servicio de metadatos). Esas conexiones son frágiles (cambian entre despliegues) y se saltan la autorización y la auditoría. El método primario de conexión es el gateway (`<nombre>.db.tumi-ai.com`, `<app>.apps.tumi-ai.com`); los puertos directos 40000-40199 (bases) y 41000-41999 (TCP extra) son el método secundario.

Versión 1: análisis estático al crear el deployment, más observación opcional en ejecución. Código: `backend/internal/connaudit/`.

## Qué se analiza

1. **Variables de entorno** de todas las capas (cuenta, proyecto, padre en previews, deploy; `service.MergeEnvLayers`/`resolveEnv`). Los valores se leen en memoria y nunca se guardan ni se devuelven.
2. **Código fuente** del tarball (`deployments/<project>/<uuid>.tar.gz`, ya extraído por el worker): `.env*`, `*.json`, `*.yml/yaml`, `*.toml`, `*.ini`, `*.properties`, `*.ts/tsx/js/jsx/mjs/cjs`, `*.py`, `*.go`, `*.java`, `*.kt`, `*.rb`, `*.php`, `*.prisma`, `*.cs`, `*.rs`, `Dockerfile*`, `docker-compose*`/`compose.*`. Se omiten: `node_modules`, `vendor`, `.git`, `dist`, `build`, `target`, `.next`, venvs, carpetas de pruebas/ejemplos (`test`, `tests`, `__tests__`, `spec`, `e2e`, `fixtures`, `examples`), `*.test.*`, `*.spec.*`, `*.min.js`, `.env.example|sample|template`, lo que excluya el `.gitignore` de la raíz, symlinks (nunca se siguen), binarios (byte NUL), líneas de comentario y líneas de más de 4096 caracteres.
   Límites: 20000 entradas, 1500 archivos leídos, 256 KiB por archivo, 16 MiB en total, profundidad 12, 200 hallazgos, 10 s. Si se alcanza un límite el informe puede ser parcial y se anota en el log del deploy.
3. **Observación en ejecución** (opcional, `CAPSULE_CONNAUDIT_RUNTIME=true`, espera `CAPSULE_CONNAUDIT_RUNTIME_DELAY` s, 30 por defecto): tras un deployment docker exitoso lista los sockets TCP establecidos y salientes del contenedor con `docker exec <c> cat /proc/net/tcp` y `/proc/net/tcp6`; si la imagen no tiene `cat`, usa `docker inspect` (PID) y lee `/proc/<pid>/net/tcp[6]` del host (solo funciona si el backend ve el PID del contenedor). Si ninguna vía funciona, escribe un aviso en el log del deploy y queda solo el informe estático. No se instala nada en la imagen. Resultado: hallazgos con `source: "runtime"`, unidos a los estáticos por `id`. Las conexiones entrantes (puerto local en escucha) se descartan.

## Qué reconoce

URLs `postgres://`, `postgresql://`, `mysql://`, `mariadb://`, `redis://`, `rediss://`, `mongodb://`, `mongodb+srv://`, `amqp(s)://`, `http(s)://`, `ws(s)://`, `tcp://`, `udp://`, `ssl://`, `kafka://`, `nats://`, `memcached://`, `sqlserver://` y `jdbc:<motor>://`, con IPv4, hostnames, IPv6 entre corchetes (`[::1]:5432`, `postgres://u:p@[2001:db8::1]:5432/db`), puerto implícito por esquema y comodines (`*.db.tumi-ai.com`). Además `host[:port]` en variables `*_HOST`, `*_HOSTNAME`, `*_ADDR`, `*_ADDRESS`, `*_SERVER`, `*_ENDPOINT`, `PGHOST`... (con su `*_PORT` hermano) y `*_URL`, `*_URI`, `*_DSN`, `*_BROKER(S)`. Un `HOST`/`HOSTNAME` a secas y `0.0.0.0`/`::` son direcciones de escucha y no se reportan. Hosts con marcadores sin resolver (`${DB_HOST}`) se ignoran.

## Catálogo de hallazgos

| `kind` | Qué es | Severidad |
|---|---|---|
| `INTERNAL_DIRECT_PORT` | `db.tumi-ai.com`, `CAPSULE_DB_HOST`, `CAPSULE_TCP_HOST`, `CAPSULE_PUBLIC_HOST`, `CAPSULE_ELASTIC_IP`, o localhost, con puerto 40000-41999 o publicado por Capsule (puerto 80/443 en esos hosts no cuenta) | warning |
| `LOOPBACK` | `localhost`, `127.0.0.0/8`, `::1` | warning |
| `DOCKER_BRIDGE` | `172.16.0.0/12`, `host.docker.internal`, `gateway.docker.internal` | warning |
| `CAPSULE_CONTAINER` | nombres `capsule-*` (`capsule-app-<id>`, `capsule-db-<uuid>`, `capsule-redis`, `capsule-backend`) | **critical** si es de otro proyecto o de la infraestructura; warning si es del propio proyecto |
| `PRIVATE_NETWORK` | RFC1918, link-local, CGNAT 100.64/10, ULA `fc00::/7`, `fe80::/10`, `*.ec2.internal` | info |
| `METADATA` | `169.254.169.254`, `169.254.170.2`, `fd00:ec2::254` | **critical** |
| OK (no se reporta) | destinos públicos y nombres del gateway (`CAPSULE_GATEWAY_DOMAINS`, por defecto `*.db.tumi-ai.com,*.apps.tumi-ai.com`) | - |

Variables de configuración del clasificador: `CAPSULE_DB_HOST`, `CAPSULE_TCP_HOST`, `CAPSULE_PUBLIC_HOST`, `CAPSULE_ELASTIC_IP`, `CAPSULE_GATEWAY_DOMAINS`. El rango 40000-41999 es fijo en v1; otros puertos publicados se toman de los puertos TCP extra del proyecto.

El `id` de cada hallazgo (12 hex) es estable: hash de `kind`, origen sin número de línea y endpoint saneado.

## Contrato

### Deployment

`GET /orgs/{o}/projects/{p}/deployments` y `.../deployments/{id}` añaden `connection_warnings` (se omite si no hay hallazgos o el análisis está apagado):

```json
{
  "id": "…", "status": "success",
  "connection_warnings": [
    {
      "id": "3f9a1c0b7d42",
      "severity": "warning",
      "kind": "INTERNAL_DIRECT_PORT",
      "source": "env:DATABASE_URL",
      "endpoint": "postgres://***@db.tumi-ai.com:40012",
      "recommendation": "Conecta por el nombre del gateway …",
      "suppressed": false
    },
    {
      "id": "a81e55d2c9f0", "severity": "critical", "kind": "METADATA",
      "source": "file:src/aws.ts:14", "endpoint": "http://169.254.169.254:80",
      "recommendation": "El servicio de metadatos de la nube …", "suppressed": true
    }
  ]
}
```

`source` es `env:NOMBRE`, `file:ruta:línea` o `runtime`. `endpoint` es `esquema://[***@]host[:puerto]`: sin credenciales, ruta ni query. `suppressed` se calcula al leer con las supresiones vigentes.

### Política y supresiones

| Ruta | Permiso | Cuerpo / respuesta |
|---|---|---|
| `GET /orgs/{o}/projects/{p}/connection-audit` | ProjectRead | `{"connection_audit_mode":"warn","suppressions":[{"finding_id","reason","expires_at?","created_by","created_at"}]}` |
| `PUT /orgs/{o}/projects/{p}/connection-audit/mode` | ProjectOps | `{"connection_audit_mode":"warn\|strict\|off"}` -> 200; 422 si el valor es otro |
| `PUT /orgs/{o}/projects/{p}/connection-audit/suppressions` | ProjectOps | `{"finding_id":"3f9a1c0b7d42","reason":"mín. 8 caracteres","expires_at":"RFC3339 opcional, futuro"}` -> 200; 422 `VALIDATION_ERROR` |
| `DELETE /orgs/{o}/projects/{p}/connection-audit/suppressions?finding_id=ID` | ProjectOps | 204 |

Sin almacén configurado las rutas responden 501 `NOT_CONFIGURED`.

### Política `connection_audit_mode`

- `warn` (por defecto): informa; nunca bloquea.
- `strict`: un hallazgo `critical` **no suprimido** falla el deployment antes de construir (estado `failed`, `error_message` empieza por `CONNECTION_POLICY_BLOCKED:` y lista origen, endpoint e id). Importante: en v1 el bloqueo ocurre en el worker tras descargar el tarball, no como 422 síncrono de `POST /deployments`, porque el análisis necesita el código fuente y los secretos descifrados; el cliente lo ve en el estado del deployment. El CLI sale con código 5.
- `off`: no analiza ni guarda nada.

Una supresión caducada deja de aplicar; el hallazgo vuelve a contar (y a bloquear en `strict`).

### Evento

`deployment.connection_warning` (catálogo A5, también en `x-webhook-events`): se publica cuando un deployment tiene hallazgos vigentes critical o warning. `data`: `deployment_id`, `critical`, `warning`, `summary`. Sin endpoints ni valores.

## CLI (0.7.2)

```
capsule deploy                           # imprime "Conexiones internas detectadas" al final
capsule deploy --strict-connections      # sale con 5 si hay critical/warning no suprimidos
capsule deploy --ignore-connections      # no imprime el informe
capsule connections [--deployment ID]    # informe del último deployment o del indicado
capsule connections --suppress ID --why "motivo" [--expires 90d]   # 90d, 2w, 12h
```

Colores solo en TTY (sin `NO_COLOR`). En GitHub Actions escribe el resumen en `$GITHUB_STEP_SUMMARY` y anotaciones `::warning` / `::error`.

## Dashboard

Insignia "Conexiones" en las listas de deployments (global y del proyecto) y panel "Conexiones" en el detalle, con recomendaciones y supresión con justificación y caducidad.

## Límites conocidos de v1

- Detección estática por patrones: no ejecuta ni resuelve el código; un host construido en tiempo de ejecución solo se ve con la observación en ejecución.
- Solo `.gitignore` de la raíz; sin `**` completo.
- `jdbc:oracle:thin:@host:puerto:sid` y listas de hosts con comas en una URL no se reconocen.
- La observación en ejecución solo aplica a deployments docker en el host (no Fargate, Lambda ni static).
- El bloqueo `strict` es asíncrono (ver arriba).

### UDP

`udp://host:puerto` se extrae como los demás esquemas. En el análisis en ejecución también se leen `/proc/net/udp` y `udp6`: solo los sockets UDP **conectados** (estado 01) hacia un destino dentro del rango publicado (o el servicio de metadatos) se reportan, como `INTERNAL_DIRECT_PORT` con el endpoint `udp://host:puerto` y la recomendación de usar `capsule://<proyecto>/<servicio>`. Los resolvers (`127.0.0.11:53`) y los sockets UDP sin conectar nunca generan hallazgos. Un contenedor que solo ofrece los archivos UDP sigue contando como no observable.
