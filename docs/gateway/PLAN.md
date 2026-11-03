# Gateway universal de Capsule: plan de implementación

Estado: PLAN (solo documentación y experimentos; no hay código de producto). Autor: agente arquitecto. Fecha de los experimentos: 2-3 nov 2026.
Experimentos reales: `docs/gateway/spikes/` (scripts, binarios de prueba en Go, resultados en `spikes/results/`). Convención: **(medido)** = lo ejecuté; **(doc)** = lo leí en documentación oficial durante esta sesión; **(?)** = no lo verifiqué, hay que mirarlo antes de depender de ello.

---

## 0. Resumen ejecutivo

**Objetivo.** Una sola IP pública (la EIP 3.224.61.221 más una dirección IPv6 de la subred, sin costo) y comodines DNS (`*.apps`, `*.db`, `git`, `tcp.`/`udp.`) para HTTP(S), Git/SSH, bases de datos, Redis, Minecraft, RDP, cualquier TCP y UDP, sin asignar un puerto por proyecto al usuario.

**La idea del dueño es correcta en lo esencial y se precisa así.** DNS solo traduce nombre → IP; TCP/UDP no llevan el nombre, así que el destino debe viajar dentro de la conexión: Host (HTTP), SNI/ALPN (TLS y los protocolos que hacen TLS: PostgreSQL, MySQL, Redis TLS, MongoDB TLS, Forgejo HTTPS) o, para el resto, un encabezado de enrutamiento propio dentro de un túnel TLS hacia el gateway (modelo `capsule://proyecto/servicio`). Un DNS propio **no** enruta (sección 1.2) y no se justifica en la fase 1.

**Decisión central: el gateway es el método de conexión PRIMARIO; los puertos directos 40000-40199 / 41000-41999 son SECUNDARIOS** (respaldo y compatibilidad, no se deprecian a corto plazo). La UI, el CLI, las cadenas de conexión y los agentes de IA muestran primero la forma del gateway; el puerto directo aparece como "método alternativo" con su aviso. Ambos caminos usan la **misma autorización** (roles de `internal/authz`, listas de IP de `netaccess`, tokens `cap_`/`cgt_`) y la **misma auditoría**.

**Tres formas de acceso, por orden de preferencia:**
1. **Por nombre, con cliente estándar** (SNI/Host): `psql "host=mi-proyecto.db.tumi-ai.com"` en el puerto 5432 estándar, `https://api-mi-proyecto.apps.tumi-ai.com`. Probado con libpq 18 real y pgx (sección 14).
2. **Por URI `capsule://<proyecto>/<servicio>`** con la librería (Go/JS), `capsule connect` o `capsule tunnel`: la librería abre TLS a `tcp.apps.tumi-ai.com:443` (o `udp.apps.…`), envía un encabezado de enrutamiento autenticado y desde ahí los bytes son transparentes. Cubre SSH, RDP, Minecraft, TCP arbitrario y UDP.
3. **Respaldo: puerto aleatorio de un pool público** (hostname `*.apps` + puerto) solo para protocolos que no se pueden enrutar por nombre y cuyo cliente no se puede envolver (p. ej. un juego con cliente cerrado). Con arrendamiento, cuotas y error claro al agotarse.

**Resultados de los experimentos que condicionan el diseño (medido):**
- SNI en un solo puerto enruta a dos backends distintos con Caddy+layer4 y con un gateway propio en Go (a, b).
- libpq 18.x real y pgx **sí envían SNI** por defecto (`sslsni=1`; con `sslsni=0` no hay nombre y el gateway no puede enrutar). Con `sslmode=require` el gateway enruta dos bases por nombre.
- **Hallazgo crítico:** en el modo clásico de PostgreSQL (SSLRequest → 'S' → TLS) el cliente habla *antes* de TLS; para **passthrough** (el gateway no ve el contenido) el gateway debe responder 'S' y **repetir el SSLRequest hacia la base**. Caddy-layer4 **no puede** (probado: reset del backend); sí puede terminar TLS en el gateway. Mi gateway en Go lo hace en ~10 líneas. PostgreSQL 17+ con `sslnegotiation=direct` (ALPN `postgresql`, sin SSLRequest) se enruta en passthrough también con Caddy.
- libpq 17+ manda ALPN `postgresql` también en modo clásico: la terminación TLS del gateway debe aceptar ese ALPN o rechaza (visto en Caddy; corregido con `connection_policies.alpn`).
- SSH sobre TLS+SNI con `ssh -o ProxyCommand="openssl s_client -quiet -servername X"` (OpenSSH 10.2 + OpenSSL 3.5.5) enruta a dos servidores en el mismo puerto; también con el cliente `ct` (prototipo de `capsule tunnel`).
- Latencia añadida en loopback: ~+130-160 µs (passthrough SNI), ~+230-250 µs (túnel); throughput de un flujo por el túnel 632 MB/s (5 Gbit/s) frente a 2.3-3.2 GB/s directo; muy por encima de lo que da una t3.medium en red real.
- Memoria: ~25-28 KB por conexión ociosa en passthrough, ~75 KB terminando TLS; 2000 conexiones ociosas = 56 MB / 155 MB (gateway propio) y +56 MB sobre una base de 45 MB (Caddy-l4).
- UDP sobre el túnel TLS (trama len16): 1000/1000 ecos, p50 391 µs en loopback. QUIC/WebTransport **no probado**.

**Elección de componente (sección 4):** gateway propio en Go (`capsule-gateway`, ~1.5-2 kLOC, mismo módulo que el backend, reutiliza `authz`/`netaccess`) para el plano de datos de TCP/UDP/túnel; **Caddy se queda para HTTP(S)** (git-proxy y, opcionalmente, `*.apps`). Razón: necesitamos passthrough PostgreSQL clásico, encabezado de enrutamiento autenticado contra la base de Capsule y UDP; ningún proxy genérico evaluado lo hace sin plugin propio (Caddy-l4 medido; HAProxy/Traefik/Envoy/nginx por documentación, no ejecutados).

**Costo adicional de infraestructura: 0 USD** (sin NLB, sin segunda IP, sin Kubernetes). IPv6 en EC2 no tiene costo propio (?). Ver sección 15.

**Qué da valor ya (Fase 1, ~2 semanas de agentes):** HTTP+PostgreSQL por SNI en puerto estándar, SSH por ProxyCommand/`capsule ssh`, informe de conexiones internas en `capsule deploy`, IPv6. **Investigación:** UDP sobre QUIC, navegador (WebTransport), RDP/Minecraft de cliente cerrado.

Decisiones que necesita el dueño: sección 17.

---

## 1. La idea del dueño, validada, y el papel de DNS

### 1.1 Qué es cierto y qué se precisa
| Afirmación | Veredicto |
|---|---|
| "DNS no transporta el nombre al servidor" | Correcto. La consulta DNS termina en el resolvedor; la conexión TCP/UDP solo trae IP:puerto. |
| "Para HTTP basta Host/SNI" | Correcto. HTTP/1.1 `Host`, HTTP/2 `:authority`, TLS SNI (RFC 6066). Sin SNI (clientes viejos, `sslsni=0`, conexión por IP) no hay ruta. |
| "Para los demás, un envoltorio" | Correcto, con dos grados: (a) protocolos que ya hacen TLS con SNI en puerto estándar (PostgreSQL, MySQL/MariaDB, Redis TLS, MongoDB TLS): **no hace falta envoltorio**, el cliente estándar basta; (b) protocolos sin TLS ni nombre (SSH, RDP clásico, Minecraft, TCP crudo, UDP): envoltorio TLS+ALPN hacia el gateway con encabezado de enrutamiento, o `ProxyCommand` con herramientas estándar. |
| Precisión | El SNI viaja en claro en TLS 1.2/1.3 (salvo ECH, no disponible en nuestros clientes (?)); el gateway ve el nombre pero no el contenido en passthrough. |

### 1.2 DNS propio / "doble DNS": ¿aporta algo?
Evaluado con seriedad; **no enruta**, pero tiene tres usos reales:

| Uso | ¿Aporta? | Detalle |
|---|---|---|
| Registros dinámicos por proyecto | **No** | Un comodín `*.apps` → misma IP ya cubre infinitos proyectos; un registro por proyecto solo serviría para IPs dedicadas (fuera de presupuesto). |
| DNS-01 para certificado comodín (Let's Encrypt) | **Sí, es el uso principal** | Los comodines exigen DNS-01 (doc: letsencrypt.org/docs/challenge-types). No hace falta DNS propio completo: basta **delegar `_acme-challenge.<zona>` por CNAME** a una zona mínima (Route53 —`iam.tf` ya concede `route53:*` a la instancia— o acme-dns). Ver sección 6. |
| Split-horizon (los contenedores resuelven `*.apps`/`tcp.apps` a la IP interna del gateway en vez de salir a Internet y volver) | **Sí, moderado** | Útil para que una app llame a otra por el mismo nombre público sin hairpin por la EIP. Se resuelve más barato con `extra_hosts`/alias de red Docker del contenedor del gateway; CoreDNS solo si hay muchos casos. Fase 3. |
| Enrutar por correlación consulta-DNS → conexión | **Inviable** | (1) La consulta la hace el **resolvedor recursivo del usuario** (ISP, 8.8.8.8, DoH), no el cliente final: la IP de origen de la consulta no es la de la conexión. (2) Cachés y TTL: una respuesta sirve a miles de clientes durante minutos. (3) Muchos clientes consultan A y AAAA y varias veces (Happy Eyeballs); no hay 1:1 consulta→conexión. (4) NAT/CGNAT: miles de usuarios tras una IP. (5) EDNS Client Subnet es opcional y trunca a /24. (6) Daría un canal de suplantación: quien consulte primero "reclama" la conexión de otro. Se descarta de forma definitiva. |

**Recomendación:** no operar DNS autoritativo propio en el host. Usar la DNS actual para los comodines y delegar solo `_acme-challenge` (sección 6). El proveedor DNS actual de `tumi-ai.com` no está en el repo (?): hay que confirmarlo (Decisión 4).

---

## 2. Taxonomía de protocolos y mecanismo de identificación

Columna "Probado": **M** = medido en esta sesión, **D** = documentación leída, **?** = no verificado.

| Protocolo | ¿Lleva nombre? | Mecanismo en el gateway | ¿Cliente estándar o wrapper? | Probado |
|---|---|---|---|---|
| HTTP/1.1, h2 | `Host` / `:authority` | Caddy (o ALB para `*.apps` mientras exista) | Estándar | Ya en producción |
| HTTPS / TLS genérico | SNI + ALPN | Passthrough o terminación por SNI | Estándar | M |
| PostgreSQL clásico | SNI **tras** SSLRequest | Responder 'S', leer ClientHello, **repetir SSLRequest al backend** (passthrough) o terminar TLS (wildcard) | Estándar: `host=<nombre>`, `sslmode=require`+ (libpq ≥14 envía SNI; `sslsni=1` por defecto, doc) | M (libpq 18, pgx, openssl -starttls) |
| PostgreSQL 17+ `sslnegotiation=direct` | SNI + ALPN `postgresql` | Passthrough directo; Caddy-l4 también | Estándar, requiere `sslmode=require` y libpq ≥17 (doc) | M |
| MySQL/MariaDB | SNI **tras** el handshake inicial del servidor (el servidor habla primero; STARTTLS-like con `CLIENT_SSL`) | El gateway debe emitir un saludo y negociar; passthrough exige replay del saludo | Estándar (el cliente envía SNI según versión (?)) | ? Solo terminando TLS en el gateway sería simple; no probado |
| Redis TLS | SNI (TLS desde el primer byte) | Passthrough por SNI | Estándar (`rediss://`); clientes que no envían SNI al conectar por IP: ver `tls-server-name`/equivalente (?) | ? (mismo mecanismo que TLS genérico, M) |
| MongoDB TLS | SNI | Passthrough por SNI | Estándar (`tls=true`) | ? (mismo mecanismo, no probado con cliente real) |
| SSH | **No** | ProxyCommand: `openssl s_client -quiet -servername <host>` o `ncat --ssl` (?) o `capsule ssh`/`capsule tunnel`; el gateway termina TLS y reenvía al sshd | Estándar + `ProxyCommand` en `~/.ssh/config` (un `Host *.git.tumi-ai.com` lo hace invisible) | M (OpenSSH 10.2 + openssl; y `ct`) |
| Git por SSH | No | Igual que SSH, hacia Forgejo; o 22 directo (hoy) | `ssh://git@git.tumi-ai.com/...` con `ProxyCommand` o `GIT_SSH_COMMAND`; el 22 sigue como método secundario | M (mismo mecanismo SSH) |
| RDP | Cookie `mstshash=` solo en parte; X.224 sin nombre fiable | Túnel `capsule` en el cliente + `mstsc /v:127.0.0.1:puerto-local`; RDP con TLS (NLA) a veces envía SNI según cliente (?) | Wrapper (local forward) | ? |
| Minecraft Java | Handshake lleva el host solicitado (campo "server address") | Enrutable por nombre **si** el gateway lee el handshake (como hacen proxies conocidos) (?) | Estándar para Java; Bedrock es UDP | ? No probado |
| TCP arbitrario | No | Encabezado de enrutamiento tras TLS (`capsule://`) | Wrapper (lib/CLI) | M (prototipo `ct`) |
| UDP | No | Túnel: datagramas sobre QUIC (RFC 9221) o, como respaldo, TCP/TLS con trama len16 | Wrapper (lib/CLI con socket UDP local) | Trama TCP: M; QUIC: no probado |
| WebSocket / navegador | Host/SNI | Se enruta como HTTP | Estándar | Ya en producción |

Conclusión de la taxonomía: **estándar sin envoltorio** para HTTP(S), PostgreSQL, Redis/Mongo TLS; **ProxyCommand estándar** para SSH; **wrapper `capsule`** para lo demás; **puerto aleatorio** solo para lo que no se pueda envolver.

---

## 3. Modelo de acceso, nombres DNS y puertos

### 3.1 Esquema de nombres (zona `tumi-ai.com`; la zona es parámetro)
| Nombre | Uso | DNS (A **y** AAAA) |
|---|---|---|
| `app`, `api` | Dashboard y API de Capsule | ALB hoy; sin cambio |
| `*.apps.tumi-ai.com` | HTTP(S) de proyectos **y** TLS por SNI (una etiqueta: `<servicio>-<proyecto>.apps…`, compatible con un certificado `*.apps`). El esquema actual de `*.apps` se conserva (?: confirmar en `proxy.go`/`alb.tf` cómo se forma hoy el nombre) | comodín |
| `*.db.tumi-ai.com` | Bases por SNI en 5432/3306/6379/27017: `<proyecto>.db…` (base por defecto) y `<nombre>-<proyecto>.db…` | comodín |
| `git.tumi-ai.com` | Forgejo (HTTPS) y SSH (22 directo + SSH sobre TLS en 443 vía `ProxyCommand`) | registro propio |
| `tcp.apps.tumi-ai.com` | Punto de entrada **fijo** del túnel TCP (`capsule://…`, 443/TLS, ALPN `capsule/1`) | A + AAAA |
| `udp.apps.tumi-ai.com` | Punto de entrada fijo del túnel UDP (UDP/443, QUIC) | A + AAAA |
| `tunnel.<…>` | No se usa: el túnel de salida (sección 4.5) entra por `tcp.apps` | — |

Registros: `*.apps`, `*.db` A→3.224.61.221 y AAAA→IPv6 de la instancia; `tcp.apps`, `udp.apps`, `git` A+AAAA. TTL 300 s (el comodín no cambia; TTL bajo solo para migraciones). Nota de diseño: el transporte (`tcp.`/`udp.`) es una etiqueta de **host de entrada**, no el protocolo de aplicación; el protocolo de aplicación lo conoce el servicio (campo `protocol` de la ruta) y solo sirve a la UI/CLI para generar cadenas de conexión.

**Cómo deduce el gateway protocolo y destino:**
1. Puerto de escucha + primer byte: `0x16` = TLS; `00 00 00 08 04 d2 16 2f` = SSLRequest de PostgreSQL; resto = HTTP en claro/otros (cerrar).
2. TLS: ALPN `capsule/1` → túnel (encabezado, sección 5.3); ALPN `postgresql`/SNI de `*.db` → ruta por SNI; otro → tabla SNI → servicio.
3. Servicio (fila de `gateway_routes`) → `dest_host:dest_port` interno (contenedor en `capsule-net`), modo `passthrough|terminate`, política.

### 3.2 Los dos accesos de un servicio (primario y secundario)
Cada servicio expuesto tiene **hasta dos "accesos"** (modelo de datos, sección 5.1):
- `gateway` (por defecto): por nombre (SNI/Host), por URI `capsule://` o por puerto aleatorio de respaldo.
- `direct_port`: el puerto publicado actual (40000-40199 bases, 41000-41999 puertos de proyecto) con regla de security group por IP.

Estados permitidos por servicio: **solo gateway** (por defecto en proyectos nuevos), **solo puerto directo** (compatibilidad), **ambos**. La lista de IP del proyecto aplica **igual** a todos los accesos (el gateway la consulta; el firewall la sigue aplicando en el puerto directo). Cuando el gateway está sano, el puerto directo se cierra por defecto y se abre bajo petición explícita (Decisión 3).

### 3.3 `*.apps` como hospedaje de infinitos servicios; UI y CLI
Web y CLI muestran, por proyecto, los **puertos abiertos configurados** (los de `project_ports`) con dos formas de acceso:
1. **Por el protocolo, por nombre** (SNI/Host): HTTP/HTTPS siempre; TLS con SNI y PostgreSQL cuando el servicio los declara.
2. **Por el comodín como hostname**: `<servicio>-<proyecto>.apps.tumi-ai.com`. Para protocolos no enrutables por nombre se asigna además un **puerto aleatorio del pool público**; todo se re-enruta al puerto interno de esa cápsula.

UI (pestaña "Conexión" del servicio): bloque 1 "Recomendado" (cadena del gateway, comando `capsule connect`, URI `capsule://`); bloque 2 "Puerto aleatorio (respaldo)" con host:puerto y estado del arrendamiento; bloque 3 "Puerto directo (alternativo)" con su aviso (necesita IP permitida; puerto no estándar; certificado autofirmado). CLI: `capsule connect <proyecto>/<servicio> [--print|--direct]`, `capsule gateway routes|ports ls`.

### 3.4 Puerto aleatorio de respaldo: arrendamiento (lease)
**Pool:** rango público `CAPSULE_GW_PORT_POOL` (propuesta 20000-29999, 10 000 puertos; distinto de 40000-41999 que queda para el método directo). Se abre en el security group con **una sola regla de rango** (no una regla por proyecto: el límite por defecto de reglas por security group es 60 (?), y el modelo actual de reglas por IP ya consume ese cupo). El gateway **escucha en cada puerto arrendado** (un `net.Listener` por puerto; ~unos KB cada uno) y aplica la lista de IP del proyecto **en espacio de usuario**, sin tocar el security group.

**Tabla `gateway_port_leases`:** `port int PK`, `route_id`, `org_id`, `state` (`leased|quarantine|free`), `leased_at`, `released_at`, `last_conn_at`.
- **Asignación:** al crear/activar un acceso `random_port`, `UPDATE … SET state='leased' WHERE port = (SELECT port FROM … WHERE state='free' ORDER BY random() LIMIT 1 FOR UPDATE SKIP LOCKED)`; aleatorio para no ser enumerable en secuencia ni predecible. El puerto es **estable mientras el servicio exista** (si cambiara en cada despliegue rompería a los clientes).
- **Liberación:** al borrar el servicio/acceso o por inactividad (sin conexión en 30 días tras aviso a los 23). Pasa a `quarantine` 24 h (evita que un cliente viejo llegue al servicio de otro proyecto) y luego `free`.
- **Reutilización:** solo desde `free`; nunca el mismo puerto al mismo org dentro de la cuarentena.
- **Cuotas:** 5 puertos aleatorios por proyecto y 20 por org por defecto (configurable por plan). Alertas al 80 % del pool; al 100 % la API responde `409 port_pool_exhausted` con `hint: "use capsule://… (no necesita puerto) o libere un acceso"`. El túnel `capsule://` no consume pool, así que el agotamiento solo afecta al respaldo.
- **Visibilidad:** UI/CLI muestran puerto, estado, última conexión y fecha de liberación prevista; auditoría registra asignar/liberar/forzar.
- **IPv6:** el mismo puerto vale para A y AAAA (el listener es de doble pila).

### 3.5 Informe de conexiones internas sin gateway en `capsule deploy`: ver sección 11.

---

## 4. Arquitectura del gateway

### 4.1 Diagrama
```
                Internet (IPv4 3.224.61.221 / IPv6 de la instancia)
                                  |
        +-------------------------+---------------------------+
        |                         |                           |
   ALB (dualstack)          EC2 t3.medium (host unico)         SSH del host (22 -> Forgejo o admin 2200)
   app/api (+ *.apps         +-----------------------------------------------+
   mientras no migre)        | :80/:443 Caddy (HTTP: git-proxy, *.apps opc.)  |
                             |    \__ listener_wrappers? NO: ver 4.3          |
                             | capsule-gateway (Go)                           |
                             |   :443  -> demux: ALPN capsule/1 | SNI | pg    |
                             |   :5432 :3306 :6379 :27017 (SNI/SSLRequest)    |
                             |   :22  (opcional, SSH en claro = Forgejo)      |
                             |   UDP/443 (QUIC)  + pool 20000-29999           |
                             |   tabla de rutas en memoria <- long-poll       |
                             +-----------------+-------------------------------+
                                               | capsule-net (redes Docker por proyecto)
                  backend Capsule (plano de control, authz, Postgres)  contenedores de proyecto / bases
```

### 4.2 Plano de datos vs plano de control
- **Datos** (`capsule-gateway`): acepta, identifica, autoriza, enruta, cuenta bytes. No guarda contenido.
- **Control** (backend Capsule): fuente de verdad de rutas en Postgres; el gateway pide `GET /internal/gateway/routes?since=<rev>` en **long-poll** (o escucha `LISTEN/NOTIFY` vía el backend) y reemplaza la tabla de forma atómica (`atomic.Pointer`). Medido: recarga por archivo cada 1 s en el prototipo, ruta añadida atendida sin reiniciar (`results/gw-reload.txt`: antes sin ruta, después `CN=C`). Si el control cae, el gateway sigue con la última tabla (fail-static) y rechaza altas nuevas; la autorización por token se cachea con TTL corto (30 s) y **falla cerrada** para tokens no cacheados.

### 4.3 Convivencia con lo actual
- **Caddy actual (git-proxy en 80/443):** hoy ocupa 443. Dos opciones: (A) el gateway toma 443 y reenvía HTTP/TLS no reconocido a Caddy en un puerto local (passthrough por SNI `git.*` / `*.apps` / resto → Caddy:8443), o (B) Caddy mantiene 443 con el `layer4` como `listener_wrappers` (documentado en los ejemplos de caddy-l4, **doc**) y reenvía lo demás al gateway. **Recomendación: (A)**, porque el demux del gateway (ALPN `capsule/1`, SSLRequest, SNI) es la pieza crítica y Caddy sigue siendo un servicio simple de HTTP sin plugin personalizado; coste: un salto local adicional (~+0.15 ms medido) para HTTP. Alternativa transitoria sin riesgo: Caddy en 443 y el gateway en 5432/3306/6379/27017/UDP443 y 8443 (SSH/túnel) durante la Fase 1, y mover 443 en la Fase 2.
- **ALB:** sigue para `app`, `api` y `*.apps` (HTTP) en la Fase 1-2; es lo que da los certificados ACM gestionados. No admite TCP, SNI passthrough ni UDP (solo HTTP/HTTPS: `alb.tf`). Migrar `*.apps` HTTP al gateway/Caddy solo si se quiere eliminar el ALB (no es necesario; ahorraría ~el costo del ALB, cifra (?) por verificar).
- **SSH del host:** el 22 sigue siendo el sshd de Forgejo (`deploy/forgejo`), admin en 2200. El gateway **no toma el 22**; el acceso SSH por gateway entra por 443 (TLS+SNI/ALPN) y se reenvía al contenedor de Forgejo. Así `git@git.tumi-ai.com` en 22 sigue funcionando (secundario).
- **Puertos 40000-41999:** intactos (sección 12).

### 4.4 Comparativa de candidatos
| Opción | Passthrough SNI | PostgreSQL clásico passthrough (replay SSLRequest) | Encabezado propio autenticado contra BD | UDP/QUIC | Hot-reload de rutas | Madurez | Veredicto |
|---|---|---|---|---|---|---|---|
| **Caddy + caddy-l4 v0.1.2** (compilado con xcaddy v0.4.7, Caddy v2.11.7) | **Sí (M)** | **No (M: reset del backend)**; sí terminando TLS con `postgres_tls`+`tls` (M) | No (módulos: `tls`, `postgres`, `ssh`, `rdp`, `proxy`, `throttle`… listados por `list-modules`, M; sin módulo de preámbulo propio) | Matcher `quic`/`wireguard`, proxy UDP (docs, no probado) | API de admin/JSON (?) | Medio: versión 0.x | Bueno para SNI/HTTP; insuficiente para el túnel y PG passthrough |
| Traefik (TCP routers `HostSNI`) | Sí por documentación (?; no pude leer la página de routers) | (?) | No | UDP routers (?) | Sí (proveedores) | Alto | Pesado para el beneficio; sin preámbulo propio |
| HAProxy | Sí (`req.ssl_sni`, `use_backend`) (?) | PG clásico con `tcp-request content` + 'S' (?) probable pero frágil | No | UDP solo en 3.x limitado (?) | Runtime API / `map` (?) | Muy alto | Mejor opción "no-Go" si se rechaza código propio |
| Envoy | Sí (`tls_inspector`, `filter_chain_match`) (?) | Filtro `postgres_proxy` no hace SNI routing (?) | Filtro propio en C++/Wasm | UDP proxy (?) | xDS | Muy alto | Demasiado complejo para un host de 4 GB |
| nginx `stream` | **Sí**: `ssl_preread` expone `$ssl_preread_server_name` y `$ssl_preread_alpn_protocols` (**doc**) | No (no repite SSLRequest) | No | UDP en `stream` (?) | `reload` (conexiones largas continúan) | Muy alto | Alternativa estable para SNI; no resuelve PG clásico ni túnel |
| **Gateway propio en Go** (`spikes/cmd/gw`, 270 líneas con túnel y UDP) | **Sí (M)** | **Sí (M)** | **Sí (M, token contra tabla)** | UDP sobre TCP/TLS (M); QUIC por añadir (quic-go (?)) | `atomic.Pointer` (M) | Código propio: riesgo de mantenimiento | **Elegido para plano de datos TCP/UDP/túnel** |

Criterio de elección: (1) cubrir PG clásico en passthrough (privacidad de las bases del cliente), (2) autorización por conexión contra el modelo de Capsule, (3) UDP, (4) cero costo, (5) mantenimiento aceptable. Solo el gateway propio cumple 1-3 sin un fork; el costo es ~2 kLOC con pruebas, comparable a otros paquetes del repo. Caddy se queda para HTTP.

Límites de lo que **no puede hacer cada uno** (resumen): Caddy-l4 no repite SSLRequest (medido); nginx/HAProxy/Traefik/Envoy no autentican contra la base de Capsule sin código; ninguno evita el doble cifrado del túnel `capsule://` (inherente al diseño: el encabezado va dentro de TLS).

### 4.5 Túnel de salida (modelo ngrok/cloudflared/bore)
Para proyectos tras NAT o en **otros hosts**: un agente `capsule-agent` (el mismo binario del CLI en modo `agent`) abre **una conexión saliente persistente** a `tcp.apps:443` (ALPN `capsule/1`, tipo de sesión `agent`), se registra con un token `cgt_` de servicio y publica sus servicios; el gateway usa esa conexión (multiplexada, por ejemplo con yamux (?)) como destino de la ruta en lugar de un `dest_host`. No requiere puertos abiertos en el origen. Fase 3 (ver sección 13); el prototipo `ct` ya prueba el sentido contrario (cliente→gateway→destino).

---

## 5. Plano de control en Capsule

### 5.1 Modelo de datos (migraciones nuevas, `IF NOT EXISTS`, con `.down.sql`, rango a reservar en el siguiente WORKBREAKDOWN)
```
gateway_routes        id, project_id, service_id, name (etiqueta: nombre del puerto configurado), protocol (http|tls|postgres|mysql|redis|mongo|ssh|tcp|udp),
                      dest_host, dest_port, tls_mode (passthrough|terminate|none), default_access ('gateway'|'direct_port'),
                      created_at, updated_at, rev (bigint, para long-poll)
gateway_accesses      id, route_id, kind ('sni_name'|'capsule_uri'|'random_port'|'direct_port'),
                      enabled bool, hostname (para sni_name), port (para random_port/direct_port), lease_id NULL
gateway_port_leases   (ver 3.4)
gateway_policies      route_id, ip_allowlist (reutiliza las filas de DatabaseAccess/PortRule: una sola fuente), required_role, max_conns, max_conns_per_ip
gateway_conn_events   id, ts, route_id, project_id, principal (user/token id), src_ip (inet), result, bytes_in, bytes_out, duration_ms   (sin contenido)
```
Un servicio con **dos accesos** (`gateway` y `direct_port`) es una ruta con dos filas en `gateway_accesses`; `direct_port` apunta a la fila existente de `project_ports`/`databases` (no se duplica el puerto ni la regla de security group). `gateway_policies.ip_allowlist` **no es una tabla nueva de IPs**: es una vista sobre las reglas actuales (`DatabaseAccessRepository`, `PortRule`), de modo que editar la lista en el dashboard cambia ambos caminos a la vez.

### 5.2 API, CLI y authz
- API (bajo `/api/v1`): `GET/POST /projects/{p}/gateway/routes`, `PATCH …/routes/{id}` (accesos, modo, política), `POST …/routes/{id}/connection-token` (emite `cgc_`, TTL 5 min), `GET …/connection-info` (cadenas por acceso; **la del gateway primero**), `POST/DELETE …/ports` (lease), `GET /orgs/{o}/gateway/usage`. Interna: `GET /internal/gateway/routes?since=` y `POST /internal/gateway/authorize` (secreto compartido, como `/internal/git-auth`). Cada ruta declara `x-permission` y la hace cumplir con `internal/authz`: `project:read` para ver cadenas, `project:connect` (nuevo, mapeado a los roles que hoy pueden abrir la base) para conectar, `project:admin` para exponer/cerrar. Nada se decide solo con el rol de org.
- CLI: `capsule connect <proyecto>/<servicio>` (abre túnel local o ejecuta el cliente estándar: `psql`, `ssh`), `capsule tunnel <proyecto>/<servicio> --listen 127.0.0.1:5433`, `capsule ssh <proyecto>/<servicio>`, `capsule gateway routes|ports|usage|expose|close`. **Por defecto generan la cadena del gateway**; `--direct` muestra la secundaria.
- Credenciales: se **reutilizan** los tokens `cap_` (API) y `cgt_` (git) para pedir un token de conexión `cgc_` firmado de corta vida (JWT compacto Ed25519, claims: `sub`, `route`, `exp`≤5 min, `jti`). El gateway valida la firma sin ir a la base y consulta la revocación solo para `jti` marcados (caché). Uso directo de `cap_` en el encabezado también permitido (hash contra la base, caché 30 s). mTLS opcional para agentes (`capsule-agent`) en Fase 3.
- Cuotas/límites por proyecto (config): `max_conns` (def. 200), `max_conns_per_ip` (def. 50), `max_routes` (def. 50), `max_random_ports` (5), tasa de conexiones nuevas (def. 20/s por IP, 100/s por proyecto), tamaño de encabezado ≤1 KiB.

### 5.3 Formato binario del encabezado de enrutamiento `capsule/1` (túnel TCP; la librería Go y la JS implementan **esta** especificación)
Transporte: TCP a `tcp.apps.<zona>:443`, TLS ≥1.2 con SNI `tcp.apps.<zona>` y ALPN `capsule/1`. El cliente valida el certificado del gateway (CA pública; no `InsecureSkipVerify` como en el prototipo). Todos los enteros son big-endian.
```
CLIENTE -> GATEWAY (una sola vez, tras el handshake TLS)
 0   4  magic     "CAP1" (0x43 0x41 0x50 0x31)
 4   1  version   0x01
 5   1  flags     bit0 = quiero PROXY info en la respuesta; bit1..7 reservados = 0
 6   2  hdr_len   longitud total del encabezado (incluye estos campos), maximo 1024
 8   1  proj_len  1..63
 .   n  project   [a-z0-9-], slug de proyecto
 .   1  svc_len   1..63
 .   n  service   nombre del puerto configurado [a-z0-9-]
 .   1  auth_type 1 = cap_ (token API), 2 = cgt_, 3 = cgc_ (token de conexion firmado)
 .   2  auth_len  <= 512
 .   n  auth      bytes ASCII del token
 .   .  TLV opcionales: tipo u8, len u8, valor  (0x01 = nonce de 16 B, 0x02 = id de cliente "lib/version"). Tipos desconocidos con bit alto (0x80+) se ignoran; los demas -> error.

GATEWAY -> CLIENTE (siempre, antes de cualquier byte de datos)
 0   4  magic     "CAPR"
 4   1  version   0x01
 5   1  status    ver tabla
 6   2  code      codigo de detalle (informativo)
 8   1  msg_len   <= 120
 9   n  msg       texto ASCII legible (sin datos internos)
 Si status = 0: a partir de aqui los bytes son TRANSPARENTES en ambos sentidos hasta el cierre.
```
| status | significado | notas |
|---|---|---|
| 0 | OK | |
| 1 | encabezado inválido / versión no soportada | se cierra tras responder; la respuesta incluye la versión máxima soportada |
| 2 | no autorizado **o** servicio inexistente | **misma respuesta y misma latencia** (retardo fijo mínimo) para evitar enumeración de proyectos |
| 3 | IP no permitida por la lista del proyecto | se distingue solo para quien ya se autenticó |
| 4 | destino no disponible (contenedor caído) | |
| 5 | cuota o límite excedido (`retry_after` en msg) | |

Límites: lectura del encabezado con plazo de 5 s y máximo 1024 B (anti slowloris); tras `status=0` el plazo de inactividad lo fija la política (def. 1 h TCP, sin límite para SSH con keepalive); `jti` repetido (reuso del nonce) se rechaza en tokens `cgc_`. IPv6: ninguna parte del formato depende del tipo de dirección; el gateway registra `src_ip` canónica.

**UDP (host `udp.apps.<zona>`).** Preferido: **QUIC** (UDP/443, ALPN `capsule/1`) con datagramas RFC 9221: un flujo bidireccional de control lleva el mismo encabezado `CAP1`; la respuesta `CAPR` crea la **sesión UDP** (`session_id`); cada datagrama QUIC = `varint session_id | payload`, ≤1200 B. El gateway abre **un socket UDP por sesión** (puerto de origen estable hacia el servicio, imprescindible para juegos/VoIP), con **tiempo de inactividad 60 s** (30-300 s configurable por servicio) y un máximo de sesiones por proyecto. La **migración de dirección** de QUIC cubre cambios de red/NAT del cliente. Respaldo cuando UDP esté bloqueado: el **mismo encabezado** sobre TCP/TLS (`tcp.apps`) con trama `len16 | datagrama` (implementada y medida en el prototipo: 1000/1000 ecos, p50 391 µs loopback), con la advertencia de bloqueo de cabeza de línea. **No probado:** QUIC real (requiere `quic-go` (?) y UDP entrante en el security group), WebTransport en navegador.

### 5.4 Cómo conviven el modo `capsule://` y los otros
`capsule://p/s` → la librería resuelve el URI (consulta `GET /gateway/resolve?uri=` o usa los datos de `connection-info`, 1 salto cacheado) y decide: si el servicio es `http`/`tls`/`postgres…` con nombre, puede **usar el nombre** (sin envoltorio, mejor rendimiento); si no, abre `tcp.apps:443` con encabezado. El mismo servicio puede usarse a la vez por nombre, por `capsule://` y por puerto aleatorio; los tres pasan por la **misma política** (rol, lista de IP, cuotas) y el mismo `gateway_conn_events`.

---

## 6. TLS y certificados

| Necesidad | Decisión | Alternativas descartadas |
|---|---|---|
| Comodín `*.apps`, `*.db`, `tcp.`/`udp.` | Let's Encrypt **DNS-01** (único desafío válido para comodines, doc) emitido por Caddy (módulo DNS) o por `lego`/`certbot` en el host, almacenado cifrado y recargado por el gateway al renovar (cada 60 días; reintento diario) | HTTP-01: no sirve para comodines. ACM: **no exporta claves privadas**, solo sirve dentro del ALB/CloudFront; el gateway no puede usarlo (?: doc ACM no leída en esta sesión) |
| API DNS para DNS-01 | **Route53 con subzona delegada** (o solo `_acme-challenge.<zona>` por CNAME) | API del registrador actual: proveedor no identificado en el repo (?) → riesgo de que no tenga API con alcance limitado; acme-dns propio: un servicio más que mantener, útil solo si Route53 se descarta |
| Certificado por proyecto vs comodín | **Comodín** para el modo terminación (`terminate`) en `*.db`/`*.git`; **passthrough** de forma predeterminada para bases (el certificado lo presenta la base: autofirmado hoy, `sslmode=require` no verifica) | Un certificado por proyecto: miles de órdenes, límites de tasa de Let's Encrypt (?: no consultados) |
| Dominios personalizados de clientes | HTTP-01 / TLS-ALPN-01 por Caddy on-demand (Fase 3) | — |
| Protección de claves | Clave comodín en disco con permisos 0600 del usuario del gateway, o KMS cuando exista (memoria del proyecto: KMS llega después en AWS); **el gateway no se ejecuta como root** (puertos <1024 con `setcap cap_net_bind_service`); rotación al restaurar el host | Claves en la base de Capsule |
| Privacidad | `passthrough` por defecto para PostgreSQL/MySQL/Redis/Mongo: el gateway ve SNI, IP origen, bytes y duración; **no ve el contenido**. `terminate` solo cuando el servicio no habla TLS (SSH envuelto, RDP, TCP crudo en el túnel) | Terminar todo: el gateway vería consultas y credenciales de bases ajenas |

Nota sobre el túnel `capsule/1`: el gateway **termina** TLS del túnel (el encabezado va dentro) y reenvía en claro dentro de `capsule-net`. Si el servicio habla TLS propio (PostgreSQL), el cliente lo hace dentro del túnel → doble TLS, y el gateway **sigue sin ver el contenido de la base** (solo ve el túnel externo, no el interno). Con `capsule://` la privacidad de la base depende de que el cliente active TLS interno: la librería lo advierte si el servicio declara `protocol=postgres` y no hay TLS.

---

## 7. IPv6 en todo el gateway

**Requisito:** escucha doble pila (IPv4+IPv6) en 80/443 y puertos estándar; DNS con A y AAAA para cada comodín y para `tcp.`/`udp.`.

| Capa | Qué implica | Estado |
|---|---|---|
| Gateway (Go) | `net.Listen("tcp", "[::]:443")` es doble pila en Linux (`bindv6only=0`); medido: un único `*:8443` aceptó `::1` y `127.0.0.1`; SNI, PostgreSQL, SSH ProxyCommand y `ct` por `[::1]` funcionaron (M, `results/gw-ipv6.txt`). Caddy-l4 también aceptó `[::1]` (M) | M (loopback) |
| DNS | Registros AAAA para `*.apps`, `*.db`, `git`, `tcp.apps`, `udp.apps` apuntando al IPv6 de la instancia. La EIP es **solo IPv4**; la dirección IPv6 es una dirección de la subred asignada a la instancia | Requiere AWS |
| AWS VPC | Asociar bloque IPv6 a la VPC y a la subred; ruta `::/0` a la puerta de enlace de Internet; asignar dirección IPv6 a la interfaz de la instancia (`ipv6_address_count = 1`); security groups con reglas `ipv6_cidr_blocks` (`::/0` para 80/443/5432…; para 22 según política); NACL si existiera. **No hay costo propio de la dirección IPv6 en EC2 (?)**; IPv4 público sí se cobra por hora (?: verificar tarifa actual). Todo se escribe en Terraform y se aplica solo cuando lo ordene el dueño (aquí no se hace `apply`) | Requiere AWS |
| ALB | Modo `dualstack` (`ip_address_type = "dualstack"`) y subredes con IPv6; el ALB apendiza la IPv6 del cliente en `X-Forwarded-For` (el repo ya lo contempla: `netaccess/clientip.go`) | Requiere AWS |
| Docker | Publicar en IPv6 con el proxy de usuario de Docker (`docker-proxy`) escucha en `[::]` si el daemon tiene `"ipv6": true` y `"fixed-cidr-v6"` (?: verificar en la versión instalada); con `ip6tables: true` (experimental en Docker <27 (?)). **Recomendación:** el gateway corre con `network_mode: host` (o publica explícitamente `[::]:443`) y habla **IPv4 con los contenedores internos por `capsule-net`**; los contenedores de proyecto no necesitan IPv6 | A verificar en el host |
| Listas de IP por proyecto | Aceptar CIDR IPv6 (`/32` a `/128`; mínimo recomendado `/48` para sitios, `/64` para un dispositivo; rechazar `/0`-`/31` salvo admin org, igual que hoy rechaza redes públicas amplias en `checkPortCIDR` (?: validar reglas actuales)). `netaccess/cidr.go` y `clientip.go` ya hablan IPv6 ("IPv4 or IPv6, canonical"); el gateway **reutiliza esas funciones** | Parcial (código existente) |
| IP real del cliente | Conexión directa al gateway: `RemoteAddr`. Detrás de ALB: `X-Forwarded-For` (solo de la IP del ALB, nunca de Internet). **PROXY protocol** v1/v2 si algún día hay un balanceador L4 delante. Se normaliza `::ffff:a.b.c.d` a IPv4 | Diseño |
| Túneles/wrapper | La librería resuelve A y AAAA y hace **Happy Eyeballs (RFC 8305)**: Go `net.Dialer` ya lo hace por defecto (DualStack); en Node usar `autoSelectFamily` (por defecto true en Node ≥20 (?)) | Parcial |
| Pruebas | (1) solo-IPv6: cliente con `curl -6`/`openssl -connect [::1]` (M en loopback); (2) solo-IPv4 (M); (3) Happy Eyeballs con AAAA que no responde: simular `drop` en `::`; (4) **red IPv6 real**: **no probable en WSL** (solo loopback `::1`); se prueba en staging con un cliente IPv6 real (p. ej. un VPS con IPv6 o 4G) | (3) y (4) pendientes |

---

## 8. Seguridad y abuso

| Riesgo | Mitigación | Verificable |
|---|---|---|
| Multi-tenencia: un proyecto alcanza a otro | Una red Docker por proyecto; el gateway es el único con patas en varias redes (`docker network connect`), la ruta fija `dest_host` y **nunca** acepta destino dado por el cliente. Los túneles `capsule://` resuelven `project/service` en la tabla, no `host:port` | Prueba de integración: cliente del proyecto A pide `capsule://B/db` con token de A → status 2 |
| SNI spoofing / domain fronting | Con passthrough el nombre del SNI decide la ruta; la autorización es por **IP/rol**, no por conocer el nombre; en terminación se compara SNI con `Host`/header; el certificado presentado coincide con el nombre | Prueba |
| Enumeración de proyectos | Misma respuesta para "no existe" y "no autorizado" (status 2; en SNI, cierre silencioso sin ClientHello de respuesta: medido, `desconocido.test` → conexión cerrada sin certificado, `results/gw-tls-sni.txt`); retardo uniforme; el comodín DNS responde igual para cualquier nombre | M parcial |
| Escaneo de puertos y DoS contra una IP compartida | Una sola IP expuesta con pocos puertos; pool 20000-29999 solo con listeners *activos* (los no arrendados no escuchan); límite de tasa por IP y por proyecto; `max_conns`; plazos de lectura (5 s encabezado); `SYN` cookies del kernel; `nftables` con tasa por IP origen para el pool. **Un DoS volumétrico no se detiene en un solo host de t3.medium**: sin CDN/escudo (fuera de presupuesto), el riesgo se acepta y se documenta | Parcial |
| Fuerza bruta de tokens | Tokens de 256 bits; límite de intentos fallidos por IP (p. ej. 10/min) con bloqueo temporal; `cgc_` firmados con exp ≤ 5 min | Prueba |
| Aislamiento de red / SSRF a servicios internos | Los contenedores de proyecto no alcanzan el metadata `169.254.169.254` (`iptables DOCKER-USER`; verificar hoy (?)), ni la red del control. El informe de `capsule deploy` (sección 11) lo señala | A verificar |
| Registro y auditoría | `gateway_conn_events` (proyecto, principal, IP, resultado, bytes, duración; **sin contenido**) con retención 90 días y exportación; eventos de cambios (exponer/cerrar/asignar puerto) al audit log existente | Diseño |
| Qué ve el gateway | Passthrough: SNI, IP origen, tamaño y tiempos. Terminación/túnel: además los bytes en claro dentro del host (por eso la clave comodín y el proceso se protegen y no se vuelcan a disco ni a logs). Política: **bases del cliente en passthrough por defecto** | Diseño |

---

## 9. Observabilidad y operación

- **Métricas** (Prometheus en `127.0.0.1:9102`, o JSON en `/internal/gateway/metrics` si no hay Prometheus): `gw_conns_active{route}`, `gw_conns_total{route,result}`, `gw_bytes_total{route,dir}`, `gw_handshake_seconds`, `gw_route_rev`, `gw_port_pool_free`, `gw_udp_sessions`.
- **Logs estructurados** JSON (uno por conexión: ruta, resultado, bytes, ms; ejemplo real en `results/gw.log`). Sin datos del contenido ni tokens (se registra el `jti`/id, nunca el token).
- **Health:** `/healthz` (proceso) y `/readyz` (tabla de rutas cargada y control alcanzable); chequeo activo de backend con caché 5 s para `status=4`.
- **Actualización sin cortar conexiones largas (SSH/DB):** (1) la tabla de rutas se actualiza en caliente (medido); (2) para actualizar el **binario**: `SO_REUSEPORT` con dos instancias (la nueva escucha, la vieja deja de aceptar y **drena** hasta cierre natural o plazo de 24 h, estilo `nginx -s reload`/HAProxy seamless reload) o activación por socket de `systemd` + `LimitNOFILE`. **No medido** en el spike; se mide en la Fase 1 con un ssh de 10 min durante la actualización. Nunca `docker restart` a secas.
- **Capacidad en 4 GB (medido, loopback, cliente y servidor en la misma máquina):** gateway propio: base 5.6 MB RSS; passthrough 500→2000 conexiones ociosas: 20→57 MB (≈25 KB/conexión); terminación TLS: 57→155 MB (≈75 KB/conexión). Caddy-l4: base 45 MB, 2000 conexiones passthrough: 101 MB (≈28 KB/conexión). CPU: ≈2-3 ms de CPU por conexión nueva (incluye arranque de handshake, medido con `/proc/<pid>/stat`, impreciso). Extrapolación con presupuesto de **512 MB** de RSS para el gateway: ≈ 15 000 conexiones passthrough o ≈ 6 000 con terminación (Go GC puede retener memoria: tras cerrar las 4000 conexiones la RSS no bajó, 157 MB). Límite real: descriptores (`LimitNOFILE` ≥ 65 536) y la red de la instancia, no la RAM. **Anomalía no explicada:** en passthrough el gateway mostró 6 descriptores por conexión (3008 con 500 conexiones) frente a 2 en terminación (1008); hay que investigar antes de fijar `LimitNOFILE`.
- **Backups/DR:** la tabla de rutas vive en Postgres de Capsule (ya cubierta por los respaldos existentes); el gateway no guarda estado.

---

## 10. Librerías cliente (Go y JS/TypeScript) y CLI

Una **especificación única** (`docs/gateway/PROTOCOL.md`, derivada de la sección 5.3) y dos implementaciones.

| Paquete | Contenido | Entornos |
|---|---|---|
| Go: `github.com/kynto/capsule/pkg/gatewayclient` (módulo propio dentro del repo, versionado con tags `gatewayclient/vX.Y.Z`) | `Dial(ctx, "capsule://p/s", opts) (net.Conn, error)`, `DialUDP`, `Listen(local, uri)` (reenvío local), `Resolve(uri)`, `TokenSource` (cap_/cgt_/cgc_, renovación), Happy Eyeballs | Go ≥1.22; CLI `capsule` lo usa |
| JS: `@capsule/gateway` (npm; paquete TypeScript ESM+CJS, sin dependencias nativas) | `connect(uri, {token}) → Duplex` (Node, `node:tls`), `createServer`/`forward(local, uri)`, `resolve(uri)`, `tokenFromEnv()`; subpath `@capsule/gateway/browser` | Node ≥20; **navegador**: solo WebSocket (`wss://tcp.apps…/v1/ws`, mismo encabezado en el primer mensaje binario); UDP en navegador solo con WebTransport (?, no verificado) |
| JS ayudantes opcionales | `@capsule/gateway-pg` (adaptador `pg`/`postgres.js` con `stream` de `connect`) | Node |
| CLI | `capsule connect|tunnel|ssh|gateway` (Go, una sola binaria; descarga por script firmado) | Linux/macOS/Windows |

API pública (idéntica en forma): `connect(uri, options)`, `forward(listenAddr, uri, options)`, `resolve(uri)`, `issueToken(route)`, errores tipados por `status` (`NotAuthorized`, `IpDenied`, `Unavailable`, `QuotaExceeded`, `UnsupportedVersion`). Resolución de nombres: el URI `capsule://proyecto/servicio` se resuelve contra la API (cacheada 60 s) y cae a `tcp.apps.<zona>` si la API no responde (la zona se configura con `CAPSULE_GATEWAY_ZONE`). Autenticación: token del entorno `CAPSULE_TOKEN` o archivo de credenciales del CLI.

**Empaquetado y publicación:** npm con provenance (`npm publish --provenance`, bajo la cuenta/organización definida; el token de publicación de la memoria del proyecto aplica solo a `bloomx-cli`, **no** a este paquete: pedir uno nuevo con ámbito limitado y confirmar antes de publicar); Go por tags; binarios del CLI con checksums. **No se publica nada en esta tarea.**

**Pruebas de interoperabilidad:** vectores de prueba compartidos (`docs/gateway/testvectors/*.json`: encabezado válido, límites, versión desconocida, token inválido, TLV desconocido) que **ambas** librerías deben codificar/decodificar idéntico; matriz en CI: {cliente Go, cliente JS} × {gateway Go de referencia} × {TCP, UDP-sobre-TCP} × {IPv4, IPv6}; prueba de ida y vuelta "eco" y de `status` por cada código. Fuzz del decodificador del gateway (`go test -fuzz`).

**Versiones:** SemVer; el protocolo lleva `version` propio (`CAP1`, v1); el gateway soporta N y N-1 durante 6 meses; los clientes siempre envían la mayor versión que conocen y el gateway responde `status=1` con la máxima soportada; npm `0.x` hasta que la matriz de interoperabilidad esté verde, `1.0` con el protocolo v1 congelado.

---

## 11. Informe de `capsule deploy`: conexiones internas sin gateway

**Qué es:** al desplegar, Capsule **reporta** si la app usa conexiones al servidor interno **sin pasar por el gateway** y recomienda el nombre que corresponde. Otro agente implementa **ya** una v0 (análisis estático de variables de entorno y fuentes sobre la infraestructura actual, con aviso hacia el endpoint soportado). Aquí se describe la versión final y cómo evoluciona esa v0.

### 11.1 Qué se detecta (patrones y clase)
| Clase | Ejemplos | Recomendación |
|---|---|---|
| `direct-port` | `host:40123` / `41xxx` (40000-41999) del host de Capsule | "Use `<proyecto>.db.tumi-ai.com:5432` o `capsule://proyecto/servicio`" (nombre exacto de la ruta) |
| `elastic-ip` | `3.224.61.221` (y IPv6 de la instancia) | Cambie por el nombre del gateway |
| `loopback` | `localhost`, `127.0.0.1`, `::1` hacia un puerto que **no** es del propio contenedor | Use el nombre de servicio (si no es sidecar) |
| `docker-bridge` | `172.17.0.1`, `172.16/12` de puentes Docker, `host.docker.internal`, `gateway.docker.internal` | Use el nombre del servicio del gateway o la red del proyecto |
| `other-capsule` | nombres de contenedor `capsule-*` de **otros** proyectos | Prohibido cruzar proyectos: use `capsule://otro/servicio` con permiso |
| `rfc1918` | `10/8`, `172.16/12`, `192.168/16` | Direcciones privadas no portables; use nombre |
| `metadata` | `169.254.169.254`, `fd00:ec2::254` | **Error** siempre: el metadata de la instancia no es un servicio de la app |

### 11.2 Dónde se analiza
1. **Variables de entorno** del despliegue (nombres y valores; los valores solo se inspeccionan en memoria y no se almacenan ni registran; secretos: solo host/puerto extraído de URL de conexión, nunca la credencial).
2. **Código fuente del tarball** subido (ya está en el servidor al construir): búsqueda por patrones sobre texto; sin ejecutar código.
3. **`.env`/`.env.*` del repositorio** y configuración conocida: Prisma (`schema.prisma` `datasource url`), Next (`next.config.*`, `.env.production`), Django (`settings.py DATABASES`), Rails (`database.yml`), Spring (`application.properties`), `docker-compose.yml`, Knex/TypeORM/Drizzle. Un registro de extractores por framework.
4. **Observación en tiempo de ejecución** (Fase 3): conexiones establecidas del contenedor (`/proc/<pid>/net/tcp{,6}` vía `docker exec`/`nsenter`, o `conntrack`) durante los primeros minutos tras el despliegue y de forma periódica; se clasifican con las mismas reglas. Detecta lo que el análisis estático no ve (hosts armados en tiempo de ejecución).

### 11.3 Dónde se muestra
- `capsule deploy`: bloque final "Conexiones que no usan el gateway (N)" con archivo:línea, la clase y la recomendación con el nombre exacto. `--strict` hace que el comando termine con código **3** (avisos) / **4** (errores de política); sin `--strict` el código sigue siendo 0 (avisos no rompen).
- API de deployments: `warnings[]` con `{code, class, severity, file, line, env_var, found, recommendation, suppress_id}` en `GET /projects/{p}/deployments/{id}`.
- Dashboard: tarjeta en el despliegue con filtros y botón "Suprimir con justificación".
- CI: salida JSON (`--output json`) y SARIF opcional para el panel de seguridad de Git Capsule.

### 11.4 Falsos positivos y supresión
Falsos positivos típicos: `localhost` hacia un sidecar del **mismo** contenedor o de la misma app; `127.0.0.1:<puerto de la app>`; pruebas y documentación. Reglas: (1) el host `localhost`/`127.0.0.1` solo se marca si el puerto coincide con un puerto de servicio de Capsule conocido (puertos configurados del proyecto u otras bases) y no con el `PORT` de la app; (2) se ignoran archivos en `test/`, `docs/`, `*.md`, `*.test.*`, fixtures; (3) supresión **con justificación obligatoria**: archivo `.capsule/gateway-ignore.yml` (`- rule: loopback, match: "127.0.0.1:6379", reason: "Redis sidecar del mismo contenedor", expires: 2027-03-01`) o supresión desde el dashboard; guarda quién, cuándo y por qué en el audit log; las supresiones **expiran** (máx. 12 meses) y reaparecen en el informe como "suprimidas".

### 11.5 Evolución (v0 → versión final)
| Versión | Alcance | Severidad por defecto |
|---|---|---|
| v0 (en curso por otro agente) | Análisis estático de env y fuentes sobre el endpoint actual; aviso hacia el endpoint soportado (puertos directos) | aviso |
| v1 (Fase 1 del gateway) | Mismas reglas pero la recomendación apunta al **nombre del gateway**; `warnings[]` en la API; `--strict` | aviso |
| v2 (Fase 2) | Extractores por framework (.env, Prisma, etc.), supresiones con justificación, dashboard | aviso |
| v3 (Fase 3) | Observación en tiempo de ejecución; política de organización `gateway_policy: warn|error` | **error opcional por política de org** (por defecto aviso; las clases `metadata` y `other-capsule` son error siempre) |
| v4 (cuando el gateway sea el único camino en proyectos nuevos) | Con `error`, el despliegue falla antes de arrancar si hay clase `direct-port` en una app de un proyecto con puerto directo cerrado | error |

Compatibilidad: v0 ya emite un objeto de aviso; v1 **mantiene los campos de v0** y añade `recommendation.gateway_name`; un campo `schema_version` evita romper clientes del CLI antiguos.

---

## 12. Migración sin romper nada

**Principio:** no se sustituye; se **invierte el orden de preferencia** y se mantienen ambos caminos con la misma autorización y auditoría.

### 12.1 Coexistencia y valores por defecto
- Cada base y cada puerto de proyecto existente queda `default_access = direct_port` al migrar (sin cambios para el usuario); se **añade** el acceso `gateway` en estado `enabled=true` para PostgreSQL por nombre cuando la fase correspondiente esté lista.
- Proyectos **nuevos**: por defecto **solo gateway** (el puerto directo no se publica); abrirlo es una acción explícita (`capsule gateway expose --direct`) y la UI muestra el aviso (puerto no estándar, requiere IP permitida, certificado autofirmado).
- Lista de IP del proyecto: **una sola**, aplicada en ambos caminos (security group por IP en el directo, evaluación en el gateway en el primario). Editar una cambia la otra; no hay divergencias.
- **Qué pasa con los dos activos a la vez:** ambos funcionan, ambos auditados; la UI marca el directo como "alternativo". Cuando el gateway lleva **N días sanos** (p. ej. 14, `gw_conns_total{result="ok"}` sin errores de ruta) y el proyecto no usa el directo (sin conexiones en 30 días), la UI **propone** cerrarlo (no lo cierra solo salvo política de org).
- Cadenas de conexión: la API devuelve `connection_strings: [{access:"gateway", …}, {access:"direct_port", …, warning}]` y **el primer elemento es el del gateway**; los clientes viejos que leen el campo antiguo reciben la cadena directa mientras el campo `connection_string` (hoy) conserve su valor (migración de contrato en 2 pasos).

### 12.2 Fases con criterios de aceptación
| Fase | Entrega | Criterios de aceptación verificables | Camino secundario (sin regresión) |
|---|---|---|---|
| **F0** Cimientos | Esquema de datos, endpoints internos de rutas y authorize, modelo de dos accesos, `PROTOCOL.md` y vectores | Migraciones suben/bajan; `go test ./...` verde; OpenAPI actualizado; vectores revisados | Suite actual de `database_access`/`project_ports`/`netaccess` verde sin modificar una línea de aserción; reglas de security group idénticas (reconcile en seco) |
| **F1** Valor inmediato | Gateway propio en 5432 y 443 (SNI) **sin tocar 443 aún** (`:8443` o IP:puerto de prueba), PostgreSQL por SNI passthrough, SSH sobre TLS (ProxyCommand y `capsule ssh`), IPv6 de doble pila en el gateway, `connection_strings` con gateway primero, informe de deploy v1 | Con libpq ≥14 `psql "host=<proyecto>.db… sslmode=require"` conecta en 5432 y enruta 2 bases; `ssh` con ProxyCommand a 2 sshd; ruta nueva efectiva <5 s; token inválido/ruta inexistente indistinguibles; conexión de 10 min sobrevive a recarga de rutas; **40000-40199 sigue conectando con la misma lista de IP** (prueba de regresión) | Pruebas de `netaccess` y de handlers sin cambios; `psql host:40123` sigue funcionando |
| **F2** Primario | Gateway toma 443 (demux ALPN/SNI/SSLRequest) con Caddy detrás para HTTP; MySQL/Redis/Mongo por SNI; comodín Let's Encrypt DNS-01; IPv6 en AWS (Terraform listo, apply por el dueño); túnel `capsule/1` TCP; librerías Go y JS 0.x; informe v2; UI "Conexión" con gateway primero | Cert comodín emitido y renovado en staging (simulado con vencimiento corto); `git push` por HTTPS sigue pasando por Caddy; matriz de interoperabilidad Go↔JS verde; solo-IPv6 y Happy Eyeballs probados desde un cliente real; actualización del binario con una sesión SSH de 10 min sin corte; métricas y alertas activas | Git SSH en 22 intacto; puertos directos sin regresión; ALB sin cambios |
| **F3** Ampliación | UDP (QUIC) + respaldo TCP, puerto aleatorio con leases y cuotas, `capsule-agent` (túnel de salida), observación en tiempo de ejecución, política de org `warn|error`, split-horizon opcional | Pool: agotamiento devuelve `409 port_pool_exhausted`, liberación y cuarentena verificadas; eco UDP 1000/1000 por QUIC y por TCP; agente detrás de NAT publica un servicio; supresiones con expiración | Directo opcionalmente cerrado en proyectos nuevos; en existentes sigue abierto hasta decisión del dueño |
| **F4** Consolidación | Directo cerrado por defecto cuando el gateway está sano (decisión del dueño); dominios personalizados | Auditoría de que ningún proyecto activo depende del directo; plan de reversa probado | Reabrible en 1 comando |

### 12.3 Plan de reversa
Por fase: (a) el gateway se despliega **al lado** del existente (puerto/IP distinto); (b) cambio de 443 por **flag** `CAPSULE_GW_TAKE_443` y por reversión de una línea de compose a Caddy en 443; (c) la tabla de rutas se puede vaciar y todo sigue por directo; (d) migraciones con `.down.sql`; (e) DNS: los registros AAAA/comodines nuevos se pueden retirar sin tocar los existentes (TTL 300 s). Ningún cambio borra datos ni reglas de security group existentes; el reconciliador actual de `netaccess` sigue siendo dueño de las reglas por IP del camino directo.

---

## 13. Desglose de trabajo (paquetes ejecutables por agentes)

Reglas comunes: las de `docs/git-capsule/WORKBREAKDOWN.md` §0 (propiedad exclusiva de archivos, cableado mínimo en bloques `// gateway:mounts begin/end`, migraciones `IF NOT EXISTS` con `.down.sql`, contrato primero, pruebas contra Postgres real, sin commit/push/despliegue/SSH/AWS/apply, sin las palabras demo/simulado/ficticio). Rango de migración: se reserva a continuación del último en uso (`000070-000079` propuesto, a confirmar contra el estado real del repo (?)). Esfuerzo: S ≤ 0.5 día de agente, M ≈ 1 día, L ≈ 2-3 días.

| Id | Paquete | Posee (archivos) | Contrato que expone / consume | Depende de | Esf. | Fase |
|---|---|---|---|---|---|---|
| G1 | Datos y contrato de rutas | `backend/migrations/0000{70-72}_gateway_*.sql`, `backend/internal/gateway/store/*`, `docs/gateway/API.openapi.yaml` | Tablas de 5.1; interfaz `RouteStore` | — | M | F0 |
| G2 | `PROTOCOL.md` + vectores de prueba | `docs/gateway/PROTOCOL.md`, `docs/gateway/testvectors/*` | Formato `CAP1/CAPR` (5.3) | — | S | F0 |
| G3 | API de control y authz | `backend/internal/gateway/api/*`, handler `connection-info`, `x-permission` `project:connect` | OpenAPI de G1; consume `internal/authz`, `netaccess` (lista única de IP) | G1 | L | F0-F1 |
| G4 | Plano de datos: demux, SNI, PostgreSQL (replay SSLRequest), túnel TCP | `backend/cmd/capsule-gateway/*`, `backend/internal/gateway/data/*` (parte del prototipo `docs/gateway/spikes/cmd/gw` como referencia) | Consume `/internal/gateway/routes` y `/authorize`; métricas | G1, G2 | L | F1 |
| G5 | SSH sobre TLS + `capsule ssh`/ProxyCommand + Forgejo | `backend/internal/gateway/data/ssh.go`, `cli/…ssh*.go`, docs | Ruta `ssh` hacia el contenedor Forgejo | G4 | M | F1 |
| G6 | Cadenas de conexión con gateway primero + UI "Conexión" | `backend/internal/server/handlers/connection_info.go` (nuevo), `frontend/…/connection*` | `connection_strings[]` (gateway primero) | G3 | M | F1 |
| G7 | Informe de conexiones internas v1-v2 (extractores) | `backend/internal/deploycheck/*`, `cli/…deploy_report.go` | `warnings[]` (11.3) | G3, v0 del otro agente | L | F1-F2 |
| G8 | IPv6 e infraestructura (Terraform + docker daemon + SG) | `deploy/terraform/gateway_ipv6.tf` (**sin apply**), `deploy/gateway/*`, `docs/gateway/RUNBOOK-ipv6.md` | — | — | M | F1-F2 |
| G9 | Certificados comodín DNS-01 | `deploy/gateway/certs/*`, `backend/internal/gateway/certs/*` | Recarga en caliente de certificados | G4 | M | F2 |
| G10 | Toma de 443 y convivencia con Caddy/ALB | `docker-compose.prod.yml` (bloque gateway), `deploy/forgejo/Caddyfile` (cambios mínimos) | Flag `CAPSULE_GW_TAKE_443` | G4, G9 | M | F2 |
| G11 | MySQL/Redis/Mongo por SNI (passthrough/terminate) | `backend/internal/gateway/data/proto_*.go` | Modos de 3.1 | G4 | M | F2 |
| G12 | Librería Go `gatewayclient` + `capsule connect/tunnel` | `pkg/gatewayclient/*`, `cli/…connect*.go` | `PROTOCOL.md` | G2, G4 | L | F2 |
| G13 | Librería JS `@capsule/gateway` (+ browser/WebSocket) | `packages/gateway-js/*` | `PROTOCOL.md` | G2 | L | F2 |
| G14 | Interoperabilidad Go↔JS y fuzz | `test/interop/*` | Vectores G2 | G12, G13 | M | F2 |
| G15 | Observabilidad y actualización sin cortes | `backend/internal/gateway/obs/*`, runbook | Métricas de la sección 9 | G4 | M | F2 |
| G16 | Puerto aleatorio: leases y cuotas | `backend/internal/gateway/ports/*`, migraciones | `409 port_pool_exhausted` | G1, G4 | L | F3 |
| G17 | UDP (QUIC + respaldo TCP) | `backend/internal/gateway/data/udp.go` | 5.3 UDP | G4 | L (investigación) | F3 |
| G18 | `capsule-agent` (túnel de salida) | `cli/…agent*.go`, `backend/internal/gateway/data/agent.go` | Sesión `agent` | G4, G12 | L | F3 |
| G19 | Informe v3 (runtime) y política de org | `backend/internal/deploycheck/runtime.go`, política | `gateway_policy` | G7 | M | F3 |
| G20 | Cierre del directo por defecto (decisión del dueño) | `backend/internal/server/handlers/database_access.go` solo con flag | Sin cambios de comportamiento por defecto | G6 | S | F4 |

Camino crítico: G1 → G3 → G4 → (G5, G6) = primera entrega usable (HTTP/PostgreSQL por SNI + SSH por ProxyCommand), ≈ 8-10 días-agente con G2/G8 en paralelo. Esfuerzo total F0-F2 ≈ 25-30 días-agente; F3 ≈ 12-15 (UDP es investigación: el recorte seguro es entregar solo el respaldo UDP-sobre-TCP).

---

## 14. Experimentos reales (resultados y límites)

Entorno: Windows 11 + WSL2 Ubuntu (OpenSSH 10.2p1, OpenSSL 3.5.5, Python 3, 12 CPU, 7.6 GB), Go 1.25.3. Todo en **loopback**, cliente y servidor en la misma máquina; sin Docker. Las herramientas se descargaron **por el proxy de módulos de Go (verificación `sum.golang.org`)** y se compilaron en `C:\Users\ejane\AppData\Local\Temp\gwbuild` (fuera del repo); ejecutadas desde `~/gw` en WSL. Caddy v2.11.7 + caddy-l4 v0.1.2 compilado con xcaddy v0.4.7 (checksum SHA-256 del binario de Windows `6954a1e7…6404`). `psql` no existe: se usó **libpq 18.x real** (`psycopg[binary]` 3.3.6 trae su libpq) y **pgx v5.12.0**. Los "PostgreSQL" y "sshd" de los backends son **servidores falsos en Go** que responden con su nombre (el de SSH usa `golang.org/x/crypto/ssh`, no OpenSSH sshd): prueban el enrutamiento, no la compatibilidad completa del protocolo.

| Exp. | Qué se hizo | Resultado real | Archivo |
|---|---|---|---|
| (a) | Caddy+layer4 enruta por SNI a dos servidores TLS en el mismo puerto (18443) | **OK**: `a.test`→CN=A, `b.test`→CN=B; también por `[::1]` | `results/caddy-l4.txt`, `caddy-l4.json` |
| (b) openssl | `openssl s_client -starttls postgres -servername X` | **OK** en gateway propio: pg-a→CN=A, pg-b→CN=B | `results/gw-pg.txt` |
| (b) pgx | cliente Go real, `sslmode=require`, ServerName=host | **OK**: enruta A y B (passthrough) y TA/TB (terminación) | `results/gw-pg.txt` |
| (b) libpq 18 | `sslsni` por defecto, `sslmode=require` | **OK**: `backend=A` / `backend=B` según el nombre; libpq **envía SNI** (doc: `sslsni=1` por defecto; desde PG14 (?, la página no fecha, la fecha es conocimiento propio)). Con `sslsni=0`: sin ruta, `unexpected eof` | `results/gw-pg.txt` |
| (b) directo | libpq `sslnegotiation=direct` (PG17+) | **OK** en ambos gateways (ALPN `postgresql` visto por el backend) | `gw-pg.txt`, `caddy-l4.txt` |
| (b) Caddy-l4 PG clásico | passthrough con `postgres_tls` | **FALLA** (reset del backend, esperado: no repite SSLRequest). Terminación con `connection_policies.alpn=postgresql`: **OK** tras corregir (sin ello, `tlsv1 alert no application protocol`) | `results/caddy-l4.txt`, `caddy.log` |
| (c) | `ssh -o ProxyCommand="openssl s_client -quiet -servername X"` a 2 servidores SSH en el mismo puerto; también `ct` | **OK** en gateway propio y en Caddy (terminando TLS) | `results/gw-ssh.txt`, `caddy-l4.txt` |
| (d) | Túnel TCP (`ct` + gateway, ~270+150 líneas con UDP) | Autorización por token OK (token inválido → `denegado`); **latencia p50**: directo TLS 103 µs, passthrough 265 µs, directo TCP 126 µs, túnel 348 µs; **throughput** 1 GB: directo 3174 MB/s, túnel 632 MB/s. Bug real hallado y corregido: sin `CloseWrite` (half-close) el túnel se colgaba con un destino que responde al EOF | `results/gw-bench.txt` |
| (e) | UDP sobre trama len16 en el túnel TLS | **OK** 1000/1000, p50 391 µs, p99 2.1 ms (loopback). **QUIC/WebSocket no probados** (no hay quic-go ni red UDP real) | `results/gw-udp.txt` |
| (f) | RSS con 500/2000 conexiones ociosas | gateway propio: base 5.6 MB; passthrough 2000 → 56.5 MB; terminando TLS 2000 → 155 MB; Caddy-l4: base 45 MB, 2000 passthrough → 101.5 MB. Anomalía de descriptores (6 por conexión en passthrough) sin explicar | `results/gw-mem.txt`, `caddy-l4.txt` |
| IPv6 | gateway en `[::]`, clientes por `::1` y `127.0.0.1` | **OK** en TLS/SNI, pgx, SSH ProxyCommand y `ct`; **solo loopback**: no hay red IPv6 real | `results/gw-ipv6.txt` |
| Recarga | ruta añadida en caliente | **OK**: antes sin ruta (conexión cerrada), después `CN=C` | `results/gw-reload.txt`, `quick` |
| Sin ruta | SNI desconocido | Conexión cerrada sin certificado (sin enumeración) | `results/gw-tls-sni.txt` |

**NO ejecutado / NO probado (no darlo por validado):** QUIC y WebTransport; MySQL/Redis/Mongo con clientes reales; RDP; Minecraft; HAProxy, Traefik, Envoy y nginx (solo documentación de nginx leída; Traefik no se pudo leer); actualización del binario sin cortes (reuso de socket); IPv6 de red real y Happy Eyeballs con AAAA caída; concurrencia en una t3.medium real; Docker/`ip6tables`; DNS-01 real contra Let's Encrypt; Route53; comportamiento con 10 000+ conexiones; fuga de descriptores observada. Las cifras de rendimiento son de loopback y **no** predicen la red de la instancia (límite de ancho de banda de t3.medium (?)).

---

## 15. Costos

| Concepto | Incremento | Nota |
|---|---|---|
| NLB / segunda IP / Kubernetes | **0** | No se usan |
| IPv6 en EC2 | 0 propio (?) | Verificar tarifas actuales de IPv4 público |
| Route53 (subzona o `_acme-challenge`) | ≈ 0.50 USD/mes por zona (?) | Opcional |
| Let's Encrypt | 0 | |
| ALB actual | sin cambio | Quitarlo (si algún día se mueve `*.apps` al gateway) ahorraría su costo mensual (cifra (?)) |
| Memoria del host | +100-500 MB en el peor caso | Presupuesto de 512 MB; Forgejo ya usa 768 MB |
| Esfuerzo de agentes | F0-F2 ≈ 25-30 días-agente; F3 ≈ 12-15 | Sección 13 |

Sin NLB: un NLB daría passthrough y preservación de IP, pero costaría dinero por hora y por LCU y **no aporta** lo que necesitamos (demux por SNI/preámbulo) que ya cubre el gateway propio en el host.

---

## 16. Riesgos

| Riesgo | Prob./Impacto | Mitigación |
|---|---|---|
| Un único host: el gateway cae y se llevan HTTP, bases, SSH | Media/Alto | Los puertos directos son el respaldo (por eso se mantienen); `systemd` con reinicio; actualizaciones con drenado; alertas |
| Código propio de red con fallo de seguridad (parser del encabezado) | Media/Alto | Fuzz, límites duros, revisión de seguridad, plazos, sin `unsafe`; vectores compartidos |
| DoS volumétrico contra la IP compartida | Media/Alto | Sin CDN no se resuelve; límites por IP/proyecto; documentar |
| Clientes sin SNI (libpq con `sslsni=0`, ciertos drivers por IP) | Media/Medio | Mensaje claro; recomendar `capsule://` o el directo; el gateway no adivina |
| Doble TLS en `capsule://` y cifrado de bases a través del gateway que termina | Baja/Medio | Passthrough por defecto; la librería avisa si falta TLS interno |
| Dependencia de Let's Encrypt/DNS | Baja/Medio | Certificado emitido con 30 días de margen; alerta de expiración |
| Fuga de descriptores / anomalía medida | Media/Medio | Investigar antes de F1; prueba de carga larga |
| Divergencia entre lista de IP del gateway y del security group | Baja/Alto | Fuente única; prueba de equivalencia en CI; reconciliador existente intacto |
| IPv6 mal configurado deja clientes sin acceso (AAAA presente sin ruta) | Media/Alto | Publicar AAAA **solo después** de probar desde un cliente IPv6 real |
| Falsos positivos del informe de deploy erosionan confianza | Media/Bajo | Supresión con justificación y expiración; `warn` por defecto |

---

## 17. Decisiones que necesita el dueño (máx. 5)

1. **Gateway propio en Go para el plano de datos (Caddy solo HTTP), en lugar de un proxy genérico.** *Recomiendo sí:* es lo único que cubre PostgreSQL clásico en passthrough, autorización por conexión y UDP sin forks. Alternativa: HAProxy/nginx solo para SNI y renunciar a `capsule://` y a UDP.
2. **¿Quién toma el 443?** *Recomiendo:* en F1 el gateway no toca 443 (puertos estándar de datos y 8443/túnel); en F2 toma 443 con Caddy detrás. Riesgo: un fallo del gateway afecta también a HTTP de git; reversa de una línea.
3. **Puerto directo con el gateway sano: cerrado por defecto y abierto solo bajo petición (proyectos nuevos); en los existentes, proponer el cierre tras 14 días sanos y 30 sin uso, sin cerrarlo solo.** *Recomiendo así.* Riesgo si se cierra antes: clientes y scripts viejos (`db.tumi-ai.com:40123`) dejan de conectar sin aviso; riesgo de dejarlo abierto: superficie de ataque y certificado autofirmado sin verificar. El informe de `capsule deploy` es lo que hace seguro el cierre.
4. **DNS y certificados:** confirmar quién aloja hoy el DNS de `tumi-ai.com` (no consta en el repo) y aprobar la **delegación de `_acme-challenge` a una zona Route53** (costo ≈ 0.50 USD/mes (?)) para el comodín. *Recomiendo sí;* no operar DNS propio.
5. **Alcance del primer entregable y de UDP:** F1 = HTTP+PostgreSQL por SNI + SSH por ProxyCommand + informe de deploy + IPv6 del gateway; **UDP y puerto aleatorio de respaldo en F3**, y el pool 20000-29999 (regla única de security group). *Recomiendo así;* el respaldo UDP-sobre-TCP primero, QUIC solo si hay un caso de uso real.
