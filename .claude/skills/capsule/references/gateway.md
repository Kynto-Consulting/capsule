# Gateway universal: `capsule connect`, `tunnel`, `ssh` y `capsule://`

Fuentes: `docs/gateway/PROTOCOL.md` (norma `capsule/1`), `docs/gateway/API.openapi.yaml`, `cli/cmd/capsule/connect.go`
y `sshcmd.go`. Comandos verificados con `--help` del CLI compilado del repo.

> **Estado (2026-11-03): en el código, NO desplegado.** El servidor de producción solo tiene migraciones hasta la
> 000059; las 000060-000064 (gateway, UDP) no están aplicadas. Contra producción hoy `capsule connect` falla
> (red/TLS) y las rutas `.../gateway/...` no existen. Úsalo en un entorno donde el usuario confirme que el gateway
> está desplegado; si no, usa el puerto directo (`bases-acceso-externo.md`, `puertos-firewall.md`).

## Concepto

- **URI** `capsule://<proyecto>/<servicio>`: `proyecto` = slug, `servicio` = **nombre del puerto** configurado (único por
  proyecto). Ambos en minúsculas, `[a-z0-9-]`, 1-63. Sin usuario, puerto, fragmento ni secretos. La forma corta
  `proyecto/servicio` también vale en el CLI.
- Parámetros: `?transport=tcp|udp`, `family=4|6|any`, `zone`, `gateway=host[:puerto]` (+ `sni` obligatorio si es IP),
  `x-*` ignorados.
- Entrada: `tcp.<zona>` / `udp.<zona>` (zona por defecto `apps.tumi-ai.com`, o `CAPSULE_GATEWAY_ZONE`, o `--zone`),
  puerto 443, TLS 1.3, ALPN `capsule/1`, certificado verificado (CA propia con `CAPSULE_GATEWAY_CA_FILE`; no hay
  forma de desactivar la verificación).
- Después del TLS el CLI envía un encabezado `CAP1` con proyecto, servicio y token; el gateway responde `CAPR` y los
  bytes pasan transparentes. El gateway termina el TLS del túnel, no el de la base: si el servicio habla TLS propio
  (PostgreSQL), actívalo en el cliente (`sslmode=require`); viaja dentro del túnel.

## Conectarse a una base o servicio

```bash
capsule whoami                                           # sesión válida (exit 3 = no)
capsule connect mi-proyecto/db --listen 127.0.0.1:5433   # túnel en primer plano; Ctrl-C cierra
psql "host=127.0.0.1 port=5433 dbname=midb user=app sslmode=require"   # en otra terminal; clave por PGPASSWORD

capsule connect mi-proyecto/db --exec -- psql -U app midb          # túnel efímero + comando; devuelve su exit code
DATABASE_URL=postgres://u@h/db capsule connect mi-proyecto/db --exec -- ./migrar   # reescribe host/puerto
capsule tunnel mi-proyecto/db --listen 127.0.0.1:5433    # = connect --listen, sin --stdio/--exec
capsule ssh mi-proyecto/ssh -l deploy                    # ssh con ProxyCommand por el gateway
capsule ssh mi-proyecto/ssh -l deploy -- -i ~/.ssh/id_ed25519 uptime
capsule ssh mi-proyecto/ssh --print                      # solo imprime el bloque para ~/.ssh/config
capsule connect --stdio capsule://mi-proyecto/ssh        # stdin/stdout (lo usa ssh como ProxyCommand)
```

- Sin `--listen` el túnel usa `127.0.0.1:0` (puerto libre, lo imprime a stderr).
- `--exec` inyecta `PGHOST`, `PGPORT`, `CAPSULE_TUNNEL_HOST|PORT|ADDR` y reescribe `DATABASE_URL` si existía; quita
  `CAPSULE_GATEWAY_TOKEN` del entorno del hijo. Exige `--` y un comando; `--stdio` no se combina con `--listen`/`--exec`.
- `--listen` fuera de loopback (o `0.0.0.0`) avisa: cualquiera que llegue a ese puerto usa tus credenciales.
- `ssh` y `--stdio` solo admiten servicios TCP; necesitan el binario **nativo** (el paquete npm WASM no abre sockets;
  `CAPSULE_NATIVE_BIN` apunta a uno nativo) y OpenSSH en el PATH para `ssh`.
- Conocer cadenas de conexión de un servicio (API): `capsule api GET /orgs/$ORG/projects/$PROJ/gateway/services/db/connection-info`
  (la del gateway es siempre `connection_strings[0]`; el `direct_port` va después con `warning`).

## Tokens y alcances

El CLI toma credenciales en este orden: `CAPSULE_GATEWAY_TOKEN`, `CAPSULE_TOKEN`, token de `capsule login`
(si tienen prefijo `cap_`/`cgt_`/`cgc_`/`cgs_`); si solo hay sesión de usuario, pide un `cgc_` nuevo por intento.

| Prefijo | Qué es | Alcance | Vida |
|---|---|---|---|
| `cap_` | token de API de usuario | los permisos `project.connect` del usuario | el del token |
| `cgt_` | token de Git | **solo** servicios marcados `git`; en otros, "not authorized" | el del token |
| `cgc_` | token de conexión firmado | **una** ruta proyecto/servicio, **un solo uso** | <= 5 min |
| `cgs_` | token de servicio (agentes, CI, apps) | un proyecto y opcionalmente un servicio; solo `project.connect` | expiración obligatoria <= 90 días, revocable (<= 30 s) |

- Permiso `project.connect`: lo tienen **deployer y admin**; viewer no. Cambiar quién llega (exponer servicios,
  tokens `cgs_`, puertos aleatorios) es `project.network` (admin).
- Crear un `cgs_` (valor mostrado **una vez**; guárdalo directo como secreto de CI, no lo repitas):
  ```bash
  capsule api POST /orgs/$ORG/projects/$PROJ/gateway/service-tokens -f name=ci-db -f service=db -F expires_in_days=30
  capsule api GET  /orgs/$ORG/projects/$PROJ/gateway/service-tokens          # nunca incluye el valor
  capsule api DELETE /orgs/$ORG/projects/$PROJ/gateway/service-tokens/<tokenID>   # confirma antes
  ```
- Nunca pases tokens en argv ni en el URI. En CI: `CAPSULE_GATEWAY_TOKEN=${{ secrets.X }}`.
- **Aviso de código (no verificado contra servidor)**: con solo sesión de usuario, `mintConnectionToken` llama a
  `/api/v1/projects/<id>/gateway/services/<svc>/connection-token`, pero el backend monta
  `/orgs/{org}/projects/{proyecto}/gateway/services/{svc}/connection-token`. Si el `cgc_` automático da 404, usa un `cgs_`
  en `CAPSULE_GATEWAY_TOKEN` y repórtalo.

## Exponer un servicio y política (admin, solo `capsule api`)

```bash
capsule api GET  /orgs/$ORG/projects/$PROJ/gateway/services
capsule api POST /orgs/$ORG/projects/$PROJ/gateway/services -f name=db -F container_port=5432 -f protocol=postgres
capsule api PATCH /orgs/$ORG/projects/$PROJ/gateway/services/db -F gateway_enabled=true -F direct_port_enabled=false
capsule api GET  /orgs/$ORG/gateway/policy
capsule api PUT  /orgs/$ORG/gateway/policy -f gateway_policy=error     # warn|error; decisión del usuario
```

`gateway_policy=error` hace que las conexiones internas que se saltan el gateway bloqueen el deploy (ver
`conexiones-internas.md`). Cambiar la política o cerrar un servicio (`DELETE`) requiere confirmación del usuario.

## Puertos aleatorios (respaldo, pool 20000-29999)

Para clientes que no pueden usar `capsule connect` ni un puerto directo. Idempotente por servicio:

```bash
capsule api POST   /orgs/$ORG/projects/$PROJ/gateway/services/db/port    # {port, host, state, planned_release_at}
capsule api DELETE /orgs/$ORG/projects/$PROJ/gateway/services/db/port    # libera; 24 h de cuarentena
```

- Se conecta a `host:port` (host `*.apps`) **sin token**: la autorización la decide solo la lista de IP del servicio.
  **Lista vacía o inexistente = deniega** (aunque el proyecto sea público). Añade antes la IP (`--my-ip`) y nunca
  `0.0.0.0/0` ni `::/0`.
- Errores `409`: `port_pool_exhausted` (no hay puertos libres: usa `capsule://`, o espera) y `port_quota_exceeded`
  (cuota del proyecto u organización: libera otro puerto o pide más cuota). No reintentes en bucle.
- Se libera solo por inactividad (`planned_release_at`); `DELETE` lo hace al instante.

## Errores y exit codes del CLI

| exit | Causa | Qué hacer |
|---|---|---|
| 0 | cierre normal (Ctrl-C también) | - |
| 1 | red/TLS/protocolo, servicio o gateway no disponible (`Unavailable`, `GatewayBusy`), versión/transporte no soportado, cierre sin `close_notify` | reintenta en un momento; `capsule version`; si persiste, ¿está desplegado el gateway? |
| 2 | uso: URI inválido, `--exec` sin comando, `--stdio` con `--listen`, `ssh` con `?transport=udp` | corrige la sintaxis; `capsule connect --help` |
| 3 | sin credenciales, token con formato inválido o `cgc_` expirado | `capsule login` o revisa `CAPSULE_GATEWAY_TOKEN` |
| 4 | no autorizado o IP no permitida | el gateway no distingue "no existe" de "sin permiso"; `capsule members list`; `ports/db access add --my-ip` |
| 5 | cuota del proyecto excedida (conexiones, por IP, tasa, sesiones UDP) | espera unos segundos; no abras más túneles |
| 6 | plazo agotado | reintenta; revisa la red |
| otros | con `--exec` o `ssh` se propaga el exit code del comando hijo | léelo como del hijo |

Códigos `CAPR` (en el mensaje `detalle`): `0x0201` no autorizado (uniforme), `0x0202` token expirado, `0x0203` token o
nonce repetido (un `cgc_` no se reutiliza), `0x0301` IP denegada, `0x04xx` destino caído, `0x05xx` cuota, `0x06xx`
gateway ocupado o plano de control caído (falla cerrada), `0x0109` transporte no habilitado (p. ej. QUIC).

## UDP

`capsule connect 'capsule://proyecto/juego?transport=udp' --listen 127.0.0.1:7777` abre un listener **UDP** local y
tunela por TCP/TLS (len16). Detalle y alternativa directa: `udp-ipv6.md`.

## Librerías

- Go: `github.com/kynto-consulting/capsule/cli/pkg/gatewayclient`: `Dial`, `DialConn`, `DialUDP`, `Listen`, `Stdio`,
  `ParseURI`, `Options{TokenSource, Zone, RootCAs}`; errores tipados con `errors.Is(err, gatewayclient.ErrIpDenied)`.
- JS/TS: `@kyntocg/capsule-gateway` (Node >= 20, sin dependencias): `listen`, `connect`, `connectUdp`, `openLocal`,
  `postgresConnectionOptions`. `listen` solo enlaza loopback salvo `allowNonLoopback: true`.
  ```js
  import { listen } from "@kyntocg/capsule-gateway";
  const t = await listen("capsule://mi-proyecto/db", { token: process.env.CAPSULE_GATEWAY_TOKEN });
  console.log(t.host, t.port);   // apunta tu cliente aquí; await t.close() al terminar
  ```

## Límites (v1)

- Solo TCP y UDP-sobre-flujo (`transport=2`); QUIC (`3`) planificado. MySQL/Redis/Mongo por SNI en 443 y
  `capsule-agent`: no existen. El navegador no abre TCP crudo.
- Encabezado <= 1024 bytes, token 8-512; plazo de encabezado 5 s, de conexión al destino 5 s, de handshake 10 s.
- Una revocación de token surte efecto en conexiones **nuevas** en <= 30 s; las ya abiertas siguen.
- Sesiones UDP del túnel: 2 min de inactividad; máximo 50 sesiones UDP por proyecto por defecto.
- Reintentos automáticos solo en errores reintentables (retroceso 500 ms a 30 s, máx. 5 intentos).
