# Runbook: UDP por el gateway y puertos aleatorios del pool (G17 + G16, plano de datos)

Requisito: UDP funciona por el gateway (con túnel) y por puerto directo sin túnel (`docs/udp-ports.md`, ya hecho). Este documento cubre las dos rutas del gateway. Especificación normativa: `PROTOCOL.md` sección 10.

## 1. UDP con túnel (capsule/1, transport 2)

- El cliente abre TLS 1.3 con ALPN `capsule/1` a `tcp.<zona>` (o `udp.<zona>`), envía `CAP1` con `transport = 2` y, si el gateway responde `CAPR status 0`, intercambia tramas `len16 | datagrama` (`len = 0` es keepalive, máximo 2048).
- La ruta debe ser de `transport: "udp"` en la tabla y llevar `project`/`project_slug` y `service` (como las de TCP). Una ruta TCP no se alcanza con transport 2 ni al revés (ambos dan `not authorized`, indistinguible de un servicio inexistente).
- El gateway abre **un socket UDP por sesión**, conectado al destino de la ruta (puerto de origen estable), con el mismo guardia SSRF que TCP. `CAPR` devuelve `session_id` (8 B), `max_datagram` e `idle_timeout`. Una primera trama enviada junto al encabezado (datos optimistas) se reenvía al destino cuando la sesión está autorizada.
- Inactividad: cuenta una trama del cliente (datos o keepalive) o un datagrama del destino; el keepalive que el gateway envía al cliente cada `UDP_KEEPALIVE` **no** reinicia el reloj (así un cliente que perdió el túnel no mantiene la sesión para siempre). Al vencer, cierre ordenado (FIN/close_notify) y `close_reason=idle`.
- Un datagrama mayor que `max_datagram` se descarta (contador `oversize_in`); una trama de más de 2048 B cierra la conexión (`protocol_error`). Si el cliente no lee, la cola destino-cliente (256 KiB) descarta y cuenta en vez de bloquear.
- Límites: por ruta, por (ruta, IP) y por proyecto -> `CAPR 5/0x0504` con `retry_after`. Además cada sesión ocupa un cupo de conexiones de la ruta (los mismos `max_conns` del plano de control que TCP).
- QUIC con datagramas (transport 3): **no implementado**; `1/0x0109`. Interfaz y pasos pendientes en `data/udp_quic.go` (`datagramConn`, `QUICDatagramsAvailable = false`).

## 2. Puertos aleatorios del pool (leases)

- El plano de control entrega `leases[]` en `GET /internal/gateway/routes`. Por cada lease el gateway abre un listener **TCP** (passthrough, sin TLS propio) si el servicio tiene una ruta TCP y un socket **UDP** si tiene una ruta UDP, ambos en el puerto arrendado. Un lease puede llevar `route_id` y/o `transport` (`tcp|udp|both`, opcionales); sin ellos se usan todas las rutas del servicio y, si hay varias del mismo transporte, gana el `id` menor (con aviso en el log).
- Reconciliación en cada cambio de tabla: lease nuevo = listener nuevo; ruta cambiada = las conexiones **nuevas** usan el destino nuevo; lease liberado = el listener TCP se cierra (las conexiones abiertas siguen hasta que terminen o pasen `POOL_DRAIN`, 10 min) y el socket UDP deja de aceptar flujos nuevos (los existentes siguen; el socket se cierra con el último o a los `POOL_DRAIN`). Si el lease vuelve para el mismo servicio durante el drenado, se reutiliza el mismo socket. Si el puerto pasa a **otro** servicio, el socket UDP anterior y sus flujos se cierran de inmediato.
- Nunca se escucha fuera de `CAPSULE_GW_POOL` (20000-29999) ni en un puerto de los listeners del propio gateway. Un bind fallido (p. ej. el proceso viejo aún retiene el puerto UDP mientras drena) se reintenta cada 30 s (`gw_pool_bind_errors_total`).
- Autorización: la misma lista de IP del servicio. Por conexión TCP / flujo UDP nuevo el gateway llama a `/internal/gateway/authorize` con `credential_type: "none"`, `access: "random_port"`, `port` y `src_ip` (el origen real; IPv4 normalizado). La respuesta se cachea unos segundos (`cache_ttl_seconds`, tope 30 s positivo / 5 s negativo). Los flujos UDP se vuelven a autorizar cada `POOL_REVALIDATE` (30 s) y se cierran si la IP ya no está permitida (efecto en ~30-60 s). Si el plano de control cae, no se admiten flujos nuevos y los existentes siguen.
- UDP sin conexión: un flujo = la dirección:puerto de origen del cliente; el gateway le abre un socket conectado al destino y devuelve las respuestas desde el puerto arrendado. Inactividad de flujo `POOL_FLOW_IDLE` (60 s). Se limita con: tope global de flujos nuevos por segundo por puerto (`POOL_FLOW_RATE`, 100) **antes** de crear estado por IP, máximo de 256 autorizaciones en curso, tope duro `POOL_MAX_FLOWS` (2048) y los `max_conns`/`max_conns_per_ip` de la autorización. El primer datagrama de un flujo se conserva mientras se autoriza (hasta 4); los que no caben se descartan y el cliente UDP debe retransmitir, como en cualquier red con pérdida.
- Aviso de seguridad: la lista de IP no autentica a un origen UDP (se puede falsificar). Los topes anteriores acotan el coste y la reflexión, pero un servicio UDP expuesto por el pool debe validar sus propios paquetes.
- Contrato con el plano de control: la autorización con `credential_type: "none"` y `access: "random_port"` debe decidir solo por la lista de IP del servicio (y que el puerto esté arrendado); hoy `authenticate` del plano de control devuelve `nil` para `none`, lo que deniega siempre (ver el informe de la entrega).

## 3. Variables

| Variable | Defecto | Efecto |
|---|---|---|
| `CAPSULE_GW_UDP_TUNNEL` | on | `off` responde `1/0x0109` a transport 2 |
| `CAPSULE_GW_UDP_IDLE` / `CAPSULE_GW_UDP_KEEPALIVE` | 60s / idle/3 | inactividad y keepalive del gateway |
| `CAPSULE_GW_UDP_MAX_DATAGRAM` / `CAPSULE_GW_UDP_QUEUE_BYTES` | 2048 / 262144 | tope anunciado y cola destino-cliente |
| `CAPSULE_GW_UDP_SESSIONS_ROUTE` / `_IP` / `_PROJECT` | 50 / 10 / 50 | sesiones concurrentes |
| `CAPSULE_GW_POOL` | 20000-29999 | rango; `off` desactiva los listeners del pool |
| `CAPSULE_GW_POOL_BIND` | `[::]` | dirección de escucha (doble pila) |
| `CAPSULE_GW_POOL_DRAIN` / `CAPSULE_GW_POOL_FLOW_IDLE` / `CAPSULE_GW_POOL_REVALIDATE` | 10m / 60s / 30s | drenado, inactividad de flujo, reautorización |
| `CAPSULE_GW_POOL_FLOW_RATE` / `CAPSULE_GW_POOL_MAX_FLOWS` | 100 / 2048 | flujos nuevos por segundo y tope por puerto |

En el despliegue, el rango del pool debe estar publicado para TCP **y** UDP (grupo de seguridad y mapeo de puertos del contenedor).

## 4. Métricas y diagnóstico

`gw_udp_sessions`, `gw_udp_sessions_total{reason}`, `gw_udp_datagrams_total{route,dir}`, `gw_udp_bytes_total{dir}`, `gw_udp_dropped_total{reason}` (`oversize_in|oversize_out|queue_full|dest_write|flow_rate|flow_cap|lease_closed|ip_*`), `gw_pool_listeners{proto}`, `gw_pool_udp_flows`, `gw_pool_tcp_conns`, `gw_pool_rejected_total{reason}` (`out_of_range|reserved|duplicate|no_route`), `gw_pool_bind_errors_total`. `gw_conns_total{route,result}` cuenta también los rechazos del pool (`ip_denied`, `denied`, `limit_*`, `control_down`). Cierre de un flujo/sesión: línea `conn` con `kind=pool-tcp|pool-udp|tunnel`, `close_reason` y bytes.

## 5. Pruebas

`go test -race ./internal/gateway/data/` (unidad, túnel, pool con plano de control falso, IPv6 `::1`, fuzz `FuzzReadUDPFrame`). En Linux/WSL: `CAPSULE_GW_REAL=1` activa `nc -u` real contra un puerto del pool; `CAPSULE_GW_BIN=<capsule-gateway linux> CAPSULE_GW_LOAD_N=2000 go test -run ProcessUDP -v` mide memoria y descriptores por sesión/flujo (ver `RESOURCES.md` sección 5).
