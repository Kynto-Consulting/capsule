# Informe de conexiones internas del deploy

Fuente: `docs/connection-audit.md` (código en `backend/internal/connaudit/`). Al crear un deployment, Capsule avisa si
la app se conecta a servidores internos **sin pasar por el gateway**: puertos directos del host, loopback, puente de
Docker, nombres de contenedor, redes privadas o el servicio de metadatos. Son conexiones frágiles (cambian entre
despliegues) y se saltan la autorización y la auditoría.

> El "método primario" que recomienda el informe es el gateway. **El informe está desplegado; el gateway aún no**
> (en el código, migraciones 000060-000064 sin aplicar): hoy las bases se alcanzan por `db.tumi-ai.com:<puerto>`
> (`bases-acceso-externo.md`) y `<app>.apps.tumi-ai.com` para HTTP sí existe. Cómo conectarse con el gateway:
> `gateway.md` (`capsule connect proyecto/servicio`). La política de organización `gateway_policy` (`warn`|`error`,
> `capsule api PUT /orgs/$ORG/gateway/policy -f gateway_policy=error`) hará que las conexiones que se saltan el
> gateway bloqueen el deploy; es decisión del usuario y solo tiene sentido con el gateway desplegado.

## Usarlo

```bash
capsule deploy                              # imprime "Conexiones internas detectadas" al final
capsule deploy --strict-connections         # exit 5 si hay critical/warning NO suprimidos
capsule deploy --ignore-connections         # no imprime el informe
capsule connections                         # informe del último deployment
capsule connections --deployment <id>
capsule connections --suppress <finding-id> --why "sidecar propio, revisado" --expires 90d   # 90d, 2w, 12h
```

`--why` es obligatorio (mínimo 8 caracteres). Sin `--expires` la supresión no caduca: pon siempre una fecha. Una
supresión caducada vuelve a contar. En GitHub Actions escribe el resumen en `$GITHUB_STEP_SUMMARY` y anotaciones
`::warning` / `::error`. Los endpoints se muestran sin credenciales, ruta ni query.

## Catálogo

| `kind` | Qué es | Severidad |
|---|---|---|
| `INTERNAL_DIRECT_PORT` | `db.tumi-ai.com`, `CAPSULE_*_HOST`, o localhost con puerto 40000-41999 o publicado por Capsule | warning |
| `LOOPBACK` | `localhost`, `127.0.0.0/8`, `::1` | warning |
| `DOCKER_BRIDGE` | `172.16.0.0/12`, `host.docker.internal`, `gateway.docker.internal` | warning |
| `CAPSULE_CONTAINER` | nombres `capsule-*` | **critical** si es de otro proyecto o de la infraestructura; warning si es del propio |
| `PRIVATE_NETWORK` | RFC1918, link-local, CGNAT, ULA `fc00::/7`, `fe80::/10`, `*.ec2.internal` | info |
| `METADATA` | `169.254.169.254`, `169.254.170.2`, `fd00:ec2::254` | **critical** |

Se analizan: variables de todas las capas (los valores solo en memoria, nunca guardados), el código fuente del tarball
(`.env*`, JSON/YAML/TOML, TS/JS, Python, Go, Java, Rust, Dockerfile, compose...; se omiten `node_modules`, `.git`,
`dist`, tests, ejemplos, lo que excluya el `.gitignore` de la raíz) y, si está activada
(`CAPSULE_CONNAUDIT_RUNTIME=true`), los sockets TCP salientes del contenedor. Reconoce URLs
(`postgres://`, `redis://`, `mongodb://`, `amqp://`, `http(s)://`, `jdbc:...`, con IPv4, hostnames e IPv6 entre
corchetes) y variables `*_HOST`, `*_URL`, `*_DSN`... Cada hallazgo tiene un `id` estable de 12 hex.

## Cómo arreglar un hallazgo (no suprimir por reflejo)

1. `capsule connections` y localiza el `source` (`env:NOMBRE`, `file:ruta:línea` o `runtime`).
2. `LOOPBACK`/`DOCKER_BRIDGE`/`INTERNAL_DIRECT_PORT` apuntando a una base del proyecto: usa el nombre/endpoint
   estable que indique la recomendación del propio hallazgo y la variable de conexión del proyecto, no un puerto
   que cambia entre despliegues.
3. `CAPSULE_CONTAINER` de otro proyecto o `METADATA`: **corrige el código**; son críticos porque saltan el aislamiento
   (o exponen credenciales de la nube). No los suprimas sin motivo documentado y confirmación del usuario.
4. Solo si es legítimo (sidecar propio, etc.): `--suppress` con `--why` claro y `--expires`.

## Política `connection_audit_mode` (sin comando dedicado)

Valores: `warn` (por defecto: informa), `strict` (un `critical` no suprimido hace **fallar el deployment antes de
construir**, `error_message` empieza por `CONNECTION_POLICY_BLOCKED:`; el CLI sale con 5) y `off` (no analiza). El bloqueo
`strict` es asíncrono: lo ves en el estado del deployment, no como 422 síncrono. No hay subcomando; usa la API:

```bash
capsule api GET /orgs/$ORG/projects/$PROJ/connection-audit
capsule api PUT /orgs/$ORG/projects/$PROJ/connection-audit/mode -f connection_audit_mode=strict
```

Cambiar a `strict` o `off` es decisión del usuario (permiso de operaciones del proyecto). Sin almacén configurado las
rutas responden 501 `NOT_CONFIGURED`. Evento de webhook: `deployment.connection_warning` (sin endpoints ni valores).

## Límites conocidos (v1)

Detección estática por patrones (un host construido en tiempo de ejecución solo se ve con la observación en
ejecución); solo el `.gitignore` de la raíz; no reconoce `jdbc:oracle:thin:@...` ni listas de hosts con comas; la
observación en ejecución solo aplica a deployments docker en el host (no Fargate, Lambda ni static).
