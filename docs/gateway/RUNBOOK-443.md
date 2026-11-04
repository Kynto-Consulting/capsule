# RUNBOOK-443: el gateway toma el 443 y Caddy sigue detrás (G10)

Qué es: hoy `git-proxy` (Caddy) publica 80 y 443 y el túnel `capsule://` entra por `tcp.apps.tumi-ai.com:8443`. Con este runbook el gateway escucha el **443** y reparte por el primer paquete; Caddy sigue terminando TLS de `git.tumi-ai.com` y renovando por HTTP-01 en el **80**. Todo lo que sigue está medido en WSL2/Docker con Caddy 2.11.7 real, el binario real del gateway y la librería Go del CLI (sección 8). Nada se ha aplicado en producción.

## 1. Diseño

```
cliente --443--> capsule-gateway ([::]:443, host network)
                   |  lee el ClientHello (sin responderlo)
                   |-- ALPN capsule/1 + SNI tcp.apps.<zona> ........ túnel capsule/1 (el gateway termina TLS 1.3)
                   |-- SNI con ruta en la tabla (<proyecto>.db...) .. su manejador (PostgreSQL, SSH, http por SNI...)
                   |-- SNI bajo un sufijo del gateway (.db.<zona>) sin ruta ... se cierra sin certificado
                   |-- cualquier OTRO SNI (git.tumi-ai.com, ...) .... passthrough TCP puro --PROXY v2--> 127.0.0.1:8444 (Caddy)
                   |-- hello sin SNI ................................. se cierra (CAPSULE_GW_NO_SNI=upstream lo entrega a Caddy)
                   `-- clear text (HTTP/SSH) en el 443 ................ se cierra (el HTTP en claro llega al 80, que sigue en Caddy)
```

Decisiones y razones:

* **Passthrough, no terminación.** El gateway no toca el certificado de git: Caddy lo sigue emitiendo y renovando (HTTP-01 por el 80, sin cambios) y HTTP/2, WebSocket y las conexiones largas de `git push` pasan intactos (medido).
* **IP real con PROXY protocol v2**, no `X-Forwarded-For`: el gateway no ve HTTP. Caddy lo soporta en el listener (`listener_wrappers { proxy_protocol { allow … fallback_policy reject } tls }`, archivo `deploy/gateway/Caddyfile.take443`). Sin esto Caddy vería siempre `127.0.0.1`/la IP del puente y se perderían la auditoría y el límite de tasa de Forgejo. Medido: `xff=127.0.0.1` y `xff=::1` en el servidor de pruebas; con el 443 en Caddy y docker-proxy se veía `172.22.0.1`.
* **Quién es de confianza** (`GW_PROXY_TRUSTED`): Caddy ve llegar a docker-proxy desde la IP del puente de Docker (no desde 127.0.0.1). `switch-443.sh` la mide con una sonda efímera por cada red de `git-proxy` y escribe `GW_PROXY_TRUSTED` en `/opt/capsule/.env`. **Medido: `fallback_policy reject` no "exige" el encabezado: RECHAZA un encabezado que venga de un origen no confiable** (un contenedor de proyecto que mande `PROXY` falso recibe conexión cerrada) y acepta una conexión sin encabezado como hoy. Por eso el Caddy del 8444 sigue aceptando conexiones sin encabezado desde loopback/puente: no es una regresión (hoy cualquier contenedor de `capsule-net` ya llega a Caddy), solo no hay forma de falsear la IP.
* **Sin SNI → cierre.** Un ClientHello sin SNI no tiene sitio al que ir: Caddy sin `default_sni` lo rechazaría igual, y el gateway evita abrir una conexión a Caddy por cada escaneo por IP. Si algún monitor externo pega al 443 por IP, `CAPSULE_GW_NO_SNI=upstream` lo entrega a Caddy.
* **`.db.<zona>` sin ruta se cierra, no va a Caddy**, para no revelar si un proyecto existe (PROTOCOL 15.3) ni mandar a Caddy basura de ese espacio de nombres.
* **ALPN `capsule/1` con un SNI que no es de túnel jamás va a Caddy** (se cierra).
* **Solo el puerto compartido reenvía.** 5432 y 8443 con un nombre desconocido siguen cerrando (el cambio no altera sus semánticas).
* **Hallazgos que obligaron a cambiar el compose** (todos medidos):
  1. Con `user: 65532` y `cap_add: NET_BIND_SERVICE` el gateway **no puede** abrir el 443 (`bind: permission denied`): Docker no da capabilities ambientales y `no-new-privileges` anula las de archivo. El `setcap` que menciona el comentario del compose base no funcionaría. El override corre el contenedor como `0:0` con `cap_drop: ALL` + `NET_BIND_SERVICE` + `DAC_READ_SEARCH` (solo lectura de archivos), `read_only` y `no-new-privileges`.
  2. Root sin `DAC_OVERRIDE` **no lee** la clave `0600` de uid 65532 que deja `sync-certs.sh` (`permission denied`): de ahí `DAC_READ_SEARCH`.
  3. `SO_REUSEPORT` solo se comparte entre procesos con el **mismo uid**. El gateway actual (65532) y el nuevo (0) no pueden compartir 8443/5432. Solución en el binario: `CAPSULE_GW_BIND_RETRY` (el nuevo reintenta cada 100 ms el puerto ocupado; el viejo, tras SIGTERM, deja de aceptar a los ~2 s y suelta el puerto). Entre procesos root↔root (relevos posteriores) SO_REUSEPORT funciona sin reintento.
  4. **La zona del gateway debe ser `apps.tumi-ai.com`**, no `tumi-ai.com`: el gateway atiende `tcp.<zona>`; el cliente usa por defecto `tcp.apps.tumi-ai.com` (`gatewayclient.DefaultZone`), igual que el certificado de `sync-certs.sh` y el sitio del Caddyfile. El `gateway.env.example` anterior decía `tumi-ai.com`. Como los nombres de base son `<proyecto>.db.tumi-ai.com`, `CAPSULE_GW_OWNED_SUFFIXES=.db.tumi-ai.com`.

Variables nuevas del gateway (`take443.go`, ya en `gateway.env.example`): `CAPSULE_GW_TAKE_443`, `CAPSULE_GW_443_ADDR`, `CAPSULE_GW_HTTP_UPSTREAM`, `CAPSULE_GW_HTTP_UPSTREAM_PROXY`, `CAPSULE_GW_NO_SNI`, `CAPSULE_GW_OWNED_SUFFIXES`, `CAPSULE_GW_BIND_RETRY`. Métrica `gw_take443_bound`. Con `CAPSULE_GW_TAKE_443=0` (defecto) el gateway no escucha el 443 ni cambia nada (medido: SNI desconocido en 8443 cerrado, `gw_take443_*` ausente).

## 2. Archivos

| Archivo | Qué es |
|---|---|
| `deploy/gateway/docker-compose.take443.yml` | Override (tercer `-f`): `git-proxy` publica `80:80` y `127.0.0.1:8444:443` (`ports: !override`, exige compose ≥ 2.24.4), monta `Caddyfile.take443`, exige `GW_PROXY_TRUSTED`; `capsule-gateway` con `TAKE_443=1`, `BIND_RETRY=10m`, uid 0 + capacidades mínimas. |
| `deploy/gateway/Caddyfile.take443` | `deploy/forgejo/Caddyfile` con un único cambio en el bloque global (`servers :443 { listener_wrappers … }`). `check-caddyfile-drift.sh` comprueba que los sitios siguen idénticos. |
| `deploy/gateway/switch-443.sh` | Conmutación (por defecto solo lectura). |
| `deploy/gateway/rollback-443.sh` | Reversa de una orden. |
| `deploy/gateway/lib-443.sh` | Funciones comunes. |
| `deploy/gateway/verify.sh` | Ampliado: `--host` informa dueño del 443, 8444 solo en loopback, PROXY, métrica; modo cliente (`--git-domain`) prueba HTTPS de git y `capsule/1` por el 443. |

No se editó `docker-compose.prod.yml` ni `deploy/forgejo/Caddyfile`.

## 3. Antes de conmutar (el dueño)

1. El gateway ya corre en modo F1 (`capsule-gateway` healthy; 8443/5432 sirviendo) y `gateway.env` tiene `CAPSULE_GW_ZONE=apps.tumi-ai.com` y `CAPSULE_GW_OWNED_SUFFIXES=.db.tumi-ai.com` (sección 1, punto 4). Imagen con el código de `take443.go`.
2. Security group: el 443 ya está abierto (era de Caddy). **No hay cambio de AWS** para este paso (sin tocar `deploy/terraform`).
3. Certificado de `tcp.apps.tumi-ai.com` en `/opt/capsule/gateway/certs` (`sync-certs.sh`). Si falta, el HTTPS de git funciona igual pero el túnel `capsule://` no tendrá TLS.
4. Ventana de poco tráfico: un `git push` por HTTPS que esté en curso **se corta** cuando se recrea Caddy (inevitable: Docker no permite quitar el 443 a un contenedor vivo). El script espera hasta 30 s a que el 443 quede quieto y aborta si no.
5. `docker compose version` ≥ 2.24.4 en el host (`!override`).
6. Sube el límite de tasa por IP si hay oficinas/CGNAT que usen el HTTPS de git: `CAPSULE_GW_NEW_CONNS_PER_IP` (defecto 20/s, ráfaga 40) se cuenta **antes** de saber el SNI, también para git (medido: con 20/s por IP las conexiones nuevas por encima de la ráfaga se cierran). Sugerido 100 con el 443 tomado.

## 4. Conmutación

```bash
cd /opt/capsule
deploy/gateway/switch-443.sh            # SOLO LECTURA: previas + plan (dueño del 443, GW_PROXY_TRUSTED, compose config, caddy validate)
deploy/gateway/switch-443.sh --yes      # ejecuta
```

Orden exacto (el 443 nunca queda sin dueño más de un tick de 100 ms; lo medido está en la sección 8):

1. Previas (compose ≥ 2.24.4, deriva de Caddyfile, imagen, dueño del 443 = docker-proxy, sondas de IP de origen → `GW_PROXY_TRUSTED`, `compose config`, `caddy validate` con la misma imagen de Caddy, certificado del túnel, conexiones abiertas en el 443). Cualquier falla aborta **sin cambiar nada**.
2. Escribe `GW_PROXY_TRUSTED` en `.env` (copia `.env.bak-443`).
3. Arranca `capsule-gateway-next` (modo 443). Sus puertos ocupados (el 443 de Caddy; 8443/5432 del gateway viejo) quedan en reintento cada 100 ms; `/readyz` responde. Hasta aquí producción sigue idéntica.
4. Espera 443 quieto (`--wait-idle`, `--max-established`; `--force` salta).
5. Recrea **solo** `git-proxy` con el override: Docker detiene el viejo (suelta el 443), crea el nuevo (publica 80 y 127.0.0.1:8444). El gateway toma el 443 en ≤ 100 ms; si un cliente llega antes de que Caddy esté arriba, el gateway **reintenta la conexión a Caddy cada 100 ms hasta 5 s** en vez de fallar.
6. Comprobaciones por `127.0.0.1:443`: HTTPS de git responde, Caddy acepta PROXY en 8444, `capsule/1` negocia. **Si algo falla, ejecuta `rollback-443.sh --yes` solo.**
7. SIGTERM al gateway viejo: deja de aceptar a los ~2 s y mantiene las conexiones abiertas (drenado de G4; sesiones de bases/SSH sobreviven). Medido: una sesión `psql` de 40 s abierta por 15432 antes de conmutar terminó bien.
8. Cuando el viejo termine (`docker ps`): `deploy/gateway/switch-443.sh --finish` crea el `capsule-gateway` administrado por compose y drena `capsule-gateway-next` (ambos comparten el 443 por SO_REUSEPORT mientras tanto); después `docker rm capsule-gateway-next`.

### Recargar el gateway ya conmutado (nueva versión) sin cortar `git push`

Dos instancias del mismo uid comparten el 443 (SO_REUSEPORT): `compose … run -d --no-deps --name capsule-gateway-next -e CAPSULE_GW_METRICS_ADDR=127.0.0.1:9112 capsule-gateway`, esperar `curl 127.0.0.1:9112/readyz`, `docker kill -s TERM capsule-gateway` (drena, el push sigue), y repetir `--finish` al terminar. **Nunca `docker restart` ni `compose up --force-recreate capsule-gateway`**: cortan todo. Medido: un `git-receive-pack` de 73 s con datos continuos, y 473 peticiones HTTPS nuevas (una cada 100 ms) durante el relevo: push completo (1 500 000 bytes, `close_reason=drain`), 0 peticiones fallidas.

## 5. Reversa (una orden)

```bash
deploy/gateway/rollback-443.sh          # solo lectura: estado y plan
deploy/gateway/rollback-443.sh --yes
```

Orden: (1) arranca `capsule-gateway-r0` en modo F1 (sin 443; espera 8443/5432 del que drena); (2) SIGTERM a los gateways que tienen el 443 (a los ~2-3 s sueltan todos los puertos; lo abierto sigue); (3) recrea `git-proxy` con **`docker-compose.prod.yml`** (80 y 443:443, Caddyfile de producción) reintentando hasta que el 443 esté libre (≤ 60 s); (4) comprueba `https://git.tumi-ai.com`; luego `rollback-443.sh --finish`. **Esta reversa sí tiene un hueco de HTTPS** (Caddy debe recrearse con el 443 libre): medido **4,5 s** de conexiones fallidas (10 s en total hasta Caddy publicado). Las conexiones abiertas hacia 8444 se cortan. No toca Forgejo, backend, bases, puertos 40000-41999, security group, DNS, `docker-compose.prod.yml` ni el Caddyfile de producción. Reversa manual equivalente: `docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate git-proxy` tras soltar el 443.

## 6. Qué vigilar después

* `verify.sh --host`: dueño del 443 = gateway, 8444 solo en `127.0.0.1`, PROXY aceptado, `gw_take443_bound 1`. Desde fuera: `verify.sh --ipv4 … --ipv6 … --git-domain git.tumi-ai.com`.
* Renovación de Let's Encrypt (HTTP-01 por el 80, sin cambios): `docker logs capsule-git-proxy | grep -i certificate`. Es lo que más conviene mirar la primera vez que venza.
* Límites: ver `RESOURCES.md` sección 6 (las conexiones de Caddy cuentan contra `CAPSULE_GW_MAX_CONNS`).

## 7. Riesgos de la conmutación en producción

1. **El gateway pasa a ser punto único del HTTPS de git y de la web.** Si cae, git por HTTPS cae con él (hasta ~5 s de reinicio con `restart: always`; el SSH de git en el 22 no depende). Es el riesgo ya anotado en PLAN 16; la reversa es de una orden pero tiene el hueco de 4,5 s.
2. **Un `git push` HTTPS en curso se corta al recrear Caddy** en la conmutación y en la reversa. Cualquier recarga posterior de Caddy (cambio de Caddyfile, nueva imagen) también.
3. **`GW_PROXY_TRUSTED` mal medido = Caddy rechaza todo el tráfico del gateway** (HTTPS de git roto). Mitigaciones: las sondas, la comprobación posterior y la reversa automática (~15 s de fallo en el peor caso). Si Docker cambia el puente (red recreada con otra subred), la IP cambia: hay que volver a medirla (`switch-443.sh` en solo lectura la muestra) y recrear `git-proxy`. Si alguien vuelve a levantar `git-proxy` con el compose base sin `GW_PROXY_TRUSTED`/override, Caddy volvería a publicar el 443 contra el gateway: choque de puertos, y el gateway sigue reintentando.
4. **Límite de tasa por IP (20/s) y `MAX_CONNS` afectan ahora al HTTPS de git/web** (sección 3, punto 6). Una IP con muchas conexiones nuevas por segundo se corta antes de llegar a Caddy.
5. **Contenedor del gateway como root con tres capacidades** (hallazgo 1-2). Alternativa si no se acepta: `setcap cap_net_bind_service` en la imagen y quitar `no-new-privileges` del gateway, o repartir con un sysctl de puertos sin privilegios en el host (`net.ipv4.ip_unprivileged_port_start=443`, cambia el sistema entero). No se tocó ninguna.
6. **Zona mal puesta** (`tumi-ai.com` en vez de `apps.tumi-ai.com`): el túnel no sería `tcp.apps.…` y el cliente por defecto no conectaría (el HTTPS de git sí).
7. Después de `--finish` queda un solo gateway administrado por compose; mientras dura el drenado conviven dos (el viejo con sus sesiones largas, hasta `CAPSULE_GW_DRAIN_TIMEOUT`).

## 8. Medido (WSL2, Docker 29.1, Caddy 2.11.7, binario real del gateway, Forgejo y Forgejo-auth sustituidos por un servidor de pruebas propio, PostgreSQL 16 y 17 reales; loopback)

| Prueba | Resultado |
|---|---|
| `curl https://git.fake` por 443 IPv4 e IPv6 `::1` | HTTP/2, 200; el servidor recibió `X-Forwarded-For: 127.0.0.1` y `::1` (con Caddy directo se veía la IP del puente `172.22.0.1`) |
| Túnel `capsule://p/echo` con `cli/pkg/gatewayclient` (sin `CAPSULE_GATEWAY_PORT`, el cliente rechaza cualquier puerto que no sea 443) | OK por 127.0.0.1 y `::1`; dial+TLS+cabecera 5-24 ms |
| `psql` (libpq 18) por SNI `pg1.db…` al 443 (SSLRequest clásico y `sslnegotiation=direct`), y por el puerto estándar del lab (15432), IPv4 e IPv6 | `select` correcto en los 8 casos (el directo exige PostgreSQL ≥ 17: contra PG 16 falla también sin gateway) |
| HTTP/2 y WebSocket por el passthrough | `http_version=2`; `101 Switching Protocols` y eco de bytes |
| `git-receive-pack` de 73 s a 20 kB/s durante un relevo de gateway | completo, `close_reason=drain`; 473 peticiones nuevas concurrentes, 0 fallidas |
| SNI `*.db` sin ruta, hello sin SNI, HTTP en claro, ALPN `capsule/1` con otro SNI | cerrados, sin certificado; el 8443 con nombre desconocido sigue cerrando |
| Contenedor de `capsule-net` con encabezado PROXY falso hacia Caddy:443 | rechazado (`000`); sin encabezado: 200 como antes |
| Conmutación (2 veces, con una sesión `psql` de 40 s abierta en la primera) | el gateway tomó el 443 a los **2,3 s y 3,7 s** de ordenar recrear Caddy; conexiones fallidas al 443 (sonda cada ~20 ms): **0 y 1** (ventana ≤ 20 ms); sesión vieja sobrevivió |
| Reversa (con sondeo continuo del HTTPS) | 10 s en total; **49 fallos / 4,5 s** de ventana sin servicio; después idéntico al estado inicial (IP del puente, 8443 cierra, sin métrica `gw_take443`) |
| Latencia añadida por el salto (300 conexiones nuevas por medición, `curl`, 3 pares alternados contra Caddy directo por 8444+PROXY) | handshake p50: +1,1 / −0,3 / +0,7 ms; total p50: +1,3 / −0,25 / +0,8 ms. **≈ +0,5 a +1 ms, dentro del ruido** de la máquina de pruebas (la línea base sola se movió de 4,3 a 7,9 ms entre repeticiones por la carga de otros contenedores) |
| 500 conexiones TLS inactivas hacia Caddy por el 443 | gateway: 11 → 1011 descriptores (**2 por conexión**, sin pipes: el relevo es de espacio de usuario), RSS 13,3 → 23,4 MB (**≈ 20 kB por conexión**); `gw_conns_active{route="default-upstream"}=500`; Caddy 17,8 → 35,8 MB |
| Tests unitarios/integración nuevos (`take443_test.go`) | 8 pruebas, `-race` limpio; el resto de `./internal/gateway/...` verde |

## 9. No verificado

* **En el host real**: versión de Docker/compose (¿≥ 2.24.4?), si `userland-proxy` está activo y desde qué IP ve Caddy a docker-proxy (por eso se mide con sondas), IPv6 de docker-proxy, carga real.
* IPv6 desde un cliente con IPv6 de Internet (solo `::1`).
* La emisión y renovación reales de Let's Encrypt con el 443 en el gateway (el HTTP-01 va por el 80, que no cambia; en el lab Caddy usó certificados internos). Forgejo real y el `forward_auth` real (se sustituyeron por un servidor de pruebas; la cabecera `Authorization` no se probó con el gateway delante).
* Más de 500 conexiones simultáneas por el passthrough, tráfico sostenido con muchos flujos y la memoria de sockets del cgroup (ver `RESOURCES.md`).
* El comportamiento de clientes sin SNI, ECH (el SNI que se ve es el público), TLS 1.0/1.1 y ClientHello fragmentados raros (el parser los cubre en pruebas de G4; no se probó contra Caddy).
