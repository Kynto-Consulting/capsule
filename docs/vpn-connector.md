# Capsule VPN Connector + funciones dentro del túnel

Estado: implementado y probado de extremo a extremo con WireGuard (túnel en espacio de usuario, SOCKS con CIDR/tope/ancho de banda, función
de ejemplo que lee por `ctx.vpn` y sube con `ctx.api`, token `capfn_` validado por introspección). FortiGate, IPsec y OpenVPN tienen su
renderizador de configuración y su lanzador en netns (`fnagent.KernelTunnel`) probados con un ejecutor de pruebas que registra los comandos; su prueba contra
hardware queda en el plan del final. Operación: `docs/vpn-connector-operacion.md`.

## 1. Qué se resuelve

Un proyecto (caso vega-prod) debe leer archivos de una red remota (10.48.0.0/24 detrás de un FortiGate) sin que los datos
pasen por el host de builds y sin dar al código de la app acceso a la red del cliente ni a las credenciales del túnel.

```
 red del cliente ▲ túnel (WireGuard / openfortivpn / strongSwan / OpenVPN)
 ┌──────────── nodo de trabajo (NO capsule-builder) ─────────────┐
 │ capsule-fn-agent ── lanza ──► vpn-gateway (1 por túnel)        │
 │   (solo salida,                 · túnel en su netns/netstack   │
 │    sondea a la API)             · SOCKS5 solo a CIDR declaradas│
 │                                 · topes: conexiones, bytes/s   │
 │                                 · cuenta bytes, sin entrada    │
 │ función «migrar» (contenedor, mem/CPU/tiempo limitados)        │
 │   ctx.vpn ──socket unix──► gateway      (la función NUNCA ve credenciales)
 │   ctx.api / ctx.storage / ctx.db ──► servidor Capsule (token capfn_)
 └────────────────────────────────────────────────────────────────┘
```

## 2. Decisiones

**D1. Dónde corre qué.** El backend (host `capsule-builder`) solo guarda estado, planifica y audita: no abre túneles ni
ejecuta funciones. Todo lo que toca la red del cliente corre en el *nodo de trabajo* (`capsule-fn-agent`), un proceso Go que
**solo hace conexiones salientes**: sondea `POST /api/v1/fn/agent/claim` con un token de nodo (`capnode_`, hash en BD). Así el
nodo puede apagarse y encenderse sin que el backend le abra puertos.

**D2. Nodo de trabajo, opción más barata y segura (pendiente de aprobación del usuario; no se creó nada en AWS).**
Reutilizar el patrón de `docs/ci-runner-scale-to-zero.md`: una EC2 `capsule-fn-node` t3.small spot con `stop` al interrumpir,
que `ciwake` enciende cuando hay una corrida en cola y que se apaga tras 15 min sin contenedores. Coste: solo cómputo mientras
corre (unos USD 0,007/h spot) + el disco EBS (8 GB ≈ USD 0,64/mes). Alternativas descartadas: segunda instancia permanente (coste
fijo); compilar/ejecutar en `capsule-builder` (ya lo congeló una vez y mezcla datos del cliente con builds); Fargate (cada
corrida de 2 h paga arranque, no hay netns/NET_ADMIN para IPsec/OpenVPN). Mientras no exista el nodo, el agente corre en
cualquier máquina Linux con Docker (incluido el PC del usuario) con el mismo binario: es lo que prueban los tests E2E.

**D3. Aislamiento.** (La API del agente vive en `/api/v1/fn/agent/*` y no en `/internal/*` porque el nodo es remoto e
`InternalEdgeGuard` rechaza direcciones públicas en `/internal`; se autentica con el token `capnode_`.) WireGuard usa *wireguard-go con netstack en espacio de usuario*: el túnel vive dentro del proceso del
gateway, sin interfaz, sin rutas ni DNS del host, sin puerto de escucha accesible (el único socket de entrada es el UDP del
propio WireGuard, que el gateway abre en un puerto efímero y solo acepta tráfico de la clave del par). Es más fuerte que un
netns y verificable sin root ni hardware. Los proveedores que necesitan kernel (openfortivpn/ppp, strongSwan, openvpn) corren
las herramientas dentro de un `network namespace` propio (`ip netns` + `unshare`), con el gateway dentro del netns y
`iptables` por defecto DROP salvo las CIDR declaradas; el host no recibe rutas ni DNS (`--no-dns --no-routes`/`pull-filter ignore`).
La función no comparte netns con el túnel: habla con el gateway por un **socket unix SOCKS5** montado en su contenedor; el
gateway valida cada destino contra las CIDR del túnel. La función tampoco recibe credenciales: las usa solo el gateway.

**D3b. Un SOCKS por corrida.** Cada corrida recibe su propio socket (`/capsule/vpn/socks.sock`) con contadores de bytes propios y
los topes de conexiones y ancho de banda compartidos del túnel; al terminar la corrida el socket se borra. Los nombres no se resuelven en
el host (el SDK solo acepta IP de las redes declaradas): el DNS del host no se toca.

**D4. Credenciales = secretos de proyecto cifrados.** Se guardan en `vpn_tunnels.secret_enc` con `pkg/crypto` (AES-GCM con
`cfg.SecretKey`, igual que `env_vars`), nunca se devuelven por la API (solo `has_secret`), se entregan al agente en el
`claim` por TLS y solo para el gateway. El logger enmascara cualquier valor secreto (`vpn.Redactor`).

**D5. Funciones.** Tabla propia `fn_functions` (no se reutiliza `cronjobs`: ese modelo ejecuta comandos de EventBridge/Lambda,
no contenedores con túnel). Disparadores: `cron` (planificador del backend, `robfig/cron`, un tick por minuto, lock en BD con
`FOR UPDATE SKIP LOCKED`), `api` (`POST …/fn/functions/{name}/run`) y `queue` (`POST …/fn/functions/{name}/enqueue`, la cola es
la propia tabla `fn_runs` en estado `queued`). Concurrencia por función = 1 por omisión (`max_concurrency`); una función en
cola espera, no se descarta. Límites por corrida: `--memory` (docker `--memory`, sin swap), `--cpus`, `--timeout` (el agente mata
el contenedor), `--pids-limit`, FS de solo lectura, sin capacidades.

**D6. Tokens de corrida.** Cada corrida recibe un token `capfn_<hex>` de corta vida (TTL = timeout + 5 min) con *alcances
explícitos* `recurso:nombre` declarados al desplegar (`api:importacion`, `storage:biblioteca`, `db:<nombre>`); el hash
SHA-256 está en `fn_run_tokens`. La app del cliente valida el bearer con `POST /api/v1/fn/tokens/introspect` (devuelve
proyecto, función, corrida, alcances, expiración; 401 si expiró/se revocó/terminó la corrida). Al terminar la corrida el token se
revoca. Los alcances caen del modelo de permisos atómicos: gestionar funciones/túneles exige permisos existentes del catálogo
(ver D8), y la función solo recibe alcances que el creador declaró y que el desplegador posee (no escalan).

**D7. Seguridad.** Un túnel por proyecto (`UNIQUE(project_id)`); una función solo usa el túnel si está adjunta (`vpn_id`
con el mismo `project_id`, validado en BD y en el claim). El gateway aplica topes: `max_conns` simultáneas, `bandwidth_bps`
(token bucket compartido) y cuenta bytes por corrida. Interruptor: `PUT …/vpn/{name}/enabled {false}` marca `enabled=false`,
el agente baja el gateway en el siguiente sondeo (≤ 10 s) y el `claim` deja de entregar credenciales; las corridas activas
con ese túnel se cancelan. Cada conexión (levantar, caer, reconectar, apagar), cada corrida (quién la lanzó, alcances, bytes)
y cada cambio de configuración se escribe en `vpn_events` / `fn_runs`.

**D8. Permisos.** El catálogo de atoms es *append-only*, tiene 99 entradas fijas por spec y golden/openapi que lo validan; añadir
atoms nuevos es un cambio de catálogo aparte. Se reutilizan los de la misma granularidad: `network:read|manage` (túneles; `manage`
es sensible), `worker:read|manage` (definir funciones), `cron:trigger` (lanzar corridas), `log:read` (leer logs). Las rutas se
registran en `routePermissions`. Cierre del tema: los átomos dedicados `vpn:*` / `fn:*` quedan como el paso 1 del plan final porque
requieren regenerar catálogo, golden y OpenAPI y no cambian el modelo de seguridad.

## 3. Esquema de datos (migración `000073_vpn_functions`)

* `vpn_tunnels(id, org_id, project_id UNIQUE, name, provider, host, cidrs[], cert_pin, config jsonb, secret_enc bytea,
  enabled, max_conns, bandwidth_bps, status, last_handshake_at, last_error, created_by, created_at, updated_at)`
* `vpn_events(id, tunnel_id, project_id, at, kind, message, actor)` auditoría de cada conexión y cambio.
* `fn_functions(id, org_id, project_id, name, image, entry, vpn_id NULL, cron, memory_mb, cpus, timeout_s, max_concurrency,
  scopes[], enabled, UNIQUE(project_id,name))`
* `fn_runs(id, function_id, project_id, trigger, triggered_by, status, queued_at, started_at, finished_at, exit_code,
  scopes[], bytes_in, bytes_out, node_id, payload jsonb, log_tail)`
* `fn_run_tokens(token_hash PK, run_id, project_id, scopes[], expires_at, revoked_at)`
* `fn_nodes(id, name, token_hash, last_seen_at)`

Todo es nuevo; no se modifica ninguna tabla existente (migración aditiva, `down` borra solo estas tablas).

## 4. API (prefijo `/api/v1/orgs/{orgID}/projects/{projectID}`)

`POST|GET /vpn`, `GET|DELETE /vpn/{name}`, `PUT /vpn/{name}/enabled`, `GET /vpn/{name}/events`;
`POST|GET /fn/functions`, `GET|DELETE /fn/functions/{name}`, `POST /fn/functions/{name}/run|enqueue`, `GET /fn/functions/{name}/runs`,
`GET /fn/runs/{runID}`; interno del agente (`capnode_`): `POST /api/v1/fn/agent/claim`, `POST /api/v1/fn/agent/runs/{id}/finish`,
`POST /api/v1/fn/agent/tunnels/{id}/status`; público para apps: `POST /api/v1/fn/tokens/introspect`.

## 5. Biblioteca `@kyntocg/capsule-fn`

`packages/capsule-fn`: `defineFunction(handler)` y `run()`; lee `CAPSULE_FN_*` del entorno de la corrida. `ctx.vpn.http|sftp|smb`
conectan por el socket SOCKS5 del gateway; `ctx.api.fetch` añade el bearer `capfn_`; `ctx.api.upload` hace subidas reanudables por partes
de 8 MiB (lista → conocidos → partes → cierre); `ctx.db` entrega el host interno `host.docker.internal:<puerto>`; `ctx.storage` usa el almacén
de objetos de Capsule cuando exista su API (otra sesión) y mientras tanto el endpoint de la app. Los `console.*` pasan por un redactor.

## 6. Plan para los proveedores restantes

0. `ctx.storage`: `cmd/server/fn_storage.go` entrega `CAPSULE_STORAGE_<NOMBRE>_*` desde el almacén de objetos propio (interno
   `host.docker.internal`). Falta una prueba contra un almacén desplegado: en esta sesión se probó la firma SigV4 del SDK contra el vector de AWS y la entrega de variables, no un PUT real.
1. Átomos dedicados `vpn:*`/`fn:*` en el catálogo (D8).
2. FortiGate: ya genera la orden `openfortivpn --trusted-cert <pin> --no-routes --no-dns --pppd-no-peerdns` dentro del netns;
   falta probar contra un FortiGate (pedir al estudio un usuario de prueba).
3. IPsec (strongSwan, `swanctl.conf` generado) y OpenVPN (`.ovpn` generado con `pull-filter ignore "redirect-gateway"`): igual.
4. Nodo EC2 spot `capsule-fn-node` (D2) tras la aprobación del usuario.
5. `ctx.storage` hacia el almacén de objetos propio cuando publique su API.

## 7. Revisión: ejecutor sobre el sistema Lambda de Capsule (indicación del usuario)

**Lo que hoy es «lambda» en Capsule (leído del código).** Es AWS Lambda real, no otro mecanismo:
* Despliegue (`service/worker.go`, `runLambdaDeploy`): crea o actualiza **una función por proyecto**, `capsule-<12 hex del id del proyecto>`
  (imagen de contenedor en ECR o zip), con rol `capsule-lambda-role`, **sin VPC**, `Timeout` 30 s y `MemorySize` 512 MB (256 MB en zip) fijos.
* Invocación: `proxyToLambda` (`handlers/proxy.go`) invoca esa función con `awsclient.Clients.Lambda` para servir HTTP.
* Cron: `handlers/cronjobs.go` crea un schedule de EventBridge Scheduler (`capsule-cron-<id>`, rol `capsule-scheduler-role`) que invoca
  la función compartida `capsule-cron-runner` con `{cron_id, command}`; el disparo manual hace `docker exec` y escribe en `execution_logs`
  (`source`, `source_id`, `level`, `message`).
* No existe hoy: memoria/tiempo configurables, VPC, ni invocación asíncrona de larga duración.

**Qué se reutiliza y qué se añade.** Se reutilizan el cliente `awsclient.Clients.Lambda`, el rol, ECR, EventBridge Scheduler para el cron
y `execution_logs` para el log de cada corrida. Se añaden (solo lo propio del conector): la unión al túnel, los alcances por función,
los tokens de corta vida, la auditoría de bytes y el topes de conexiones/ancho de banda. Las funciones del conector **no** usan la función
`capsule-<proyecto>` (esa sirve HTTP y tiene 30 s): cada función es su propia Lambda `capsule-fn-<12 hex del id de la función>`, creada con
`CreateFunction` con `MemorySize`, `Timeout` y `Environment` tomados de `fn_functions`. `fnagent.ContainerRunner` pasa a ser la interfaz
`Executor`; `LambdaExecutor` hace `Invoke` y el `DockerRunner` queda solo para desarrollo local. La cola, la concurrencia (1 por omisión,
`ReservedConcurrentExecutions`), la introspección de tokens y el kill switch no cambian.

**(1) Cómo llega una Lambda a la red remota sin credenciales.** La Lambda no vive en el nodo ni en un netns, y ponerla en una VPC obligaría
a pagar un NAT (~USD 32/mes) para que alcance la API y S3, lo que el usuario no quiere. Decisión: **relé autenticado sobre el gateway de
Capsule** (`capsule/1`, el mismo que ya tiene tokens `cgs_`, TLS 1.3 y puerto 443):
1. el `vpn-gateway` del nodo mantiene un túnel inverso saliente hacia el gateway de Capsule (el nodo sigue sin puertos de entrada);
2. la Lambda abre `wss://…` al gateway con su token `capfn_` de la invocación; el gateway lo valida por introspección, comprueba que la función
   está adjunta a ese túnel y solo entonces la empareja con el vpn-gateway del proyecto;
3. el protocolo sobre ese canal es el SOCKS5 que ya existe (misma política de CIDR, topes y contadores por corrida); la Lambda recibe solo el
   token, nunca las credenciales del túnel. El SDK `ctx.vpn` cambia el transporte (unix socket → WebSocket al relé) sin cambiar su API.
El nodo debe estar encendido cuando haya invocaciones: el disparador (cron/API) lo enciende antes (patrón `ciwake`) y la corrida espera su registro.
Alternativa descartada: Lambda en VPC con relé en la subred (requiere NAT o endpoints de pago).

**(2) 15 minutos frente a 2 h.** Una Lambda se corta a los 900 s. Decisión: **funciones reanudables por lotes**. `defineFunction` recibe un
`ctx.checkpoint` y un `ctx.budget` (tiempo restante); la función procesa hasta ~13 min y devuelve `{continue: <cursor>}`; el servicio encola
automáticamente la siguiente invocación con el cursor como `payload` (misma corrida lógica, `fn_runs.attempt`). El protocolo de migración de
vega-prod ya es reanudable (lista → conocidos → partes de 8 MiB → cierre), así que cada lote salta lo ya conocido. `--timeout` pasa a ser el
tope de toda la corrida lógica (hasta 2 h = ~10 lotes) y cada invocación se limita a 15 min. Una migración que no se pueda partir se queda
en el ejecutor de contenedor del nodo (opción de despliegue `--runtime container`); es una decisión del usuario si se acepta ese híbrido.

**(3) Costo.** Lambda cobra por uso: sin recurrente salvo el nodo del túnel (que se enciende bajo demanda). Una migración nocturna de 10 lotes
de 13 min a 512 MB ≈ 10×780 s×0,5 GB×USD 0,0000166667 ≈ USD 0,065 por noche. El relé reutiliza el gateway que ya corre; no hay NAT.

**(4) Token de alcance mínimo por invocación.** El backend, no la Lambda, lo emite: antes de `Invoke` mintea `capfn_` con los alcances de la
función y TTL = tiempo restante de la corrida + 5 min, y lo pasa en el `Payload` del `Invoke` (nunca en las variables de entorno de la función,
que son visibles en la consola de AWS). Se revoca al terminar el lote; cada lote tiene el suyo. `ctx.db` y `ctx.storage` entregan sus
credenciales también por el `Payload`, no por `Environment`.

**Estado.** Lo construido en las fases a-f (cola, tokens, concurrencia, kill switch, auditoría, SOCKS, WireGuard, SDK, CLI, panel) es
independiente del ejecutor y se conserva. Falta: `LambdaExecutor`, el relé del gateway, la reanudación por lotes y el cron por Scheduler hacia
la Lambda de la función. Esto toca infraestructura de AWS y el gateway de producción, así que **no se hace sin aprobación** del usuario.
