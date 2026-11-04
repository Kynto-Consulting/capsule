# Gateway: conectar a MySQL/MariaDB, Redis y MongoDB por nombre

Paquete G11. Código: `backend/internal/gateway/data/proto_common.go`, `proto_mysql.go`, `proto_redis.go`, `proto_mongo.go` (pruebas `proto_test.go`, `proto_fuzz_test.go`). Todo se identifica por el **nombre** (SNI) que el cliente pone en el TLS; el gateway pregunta a `/internal/gateway/authorize` en cada conexión (`credential_type` `none`, `access` `sni_name`, lista de IP del servicio, el resto lo hereda del servicio) y, si el nombre no existe, la lista de IP lo niega o el control no responde, la conexión se cierra **sin respuesta** tras el mismo retardo uniforme (`CAPSULE_GW_DENY_DELAY`, 300 ms ± 50): no hay pista de si el servicio existe.

## 1. Puertos y `kind` (`CAPSULE_GW_LISTEN`)

Los puertos estándar los abre la configuración, no el código; en producción no se abren hasta F2 (ver `RUNBOOK-ipv6.md` y `gateway_standard_ports`).

| Puerto | Entrada de `CAPSULE_GW_LISTEN` | `kind` | Qué hace |
|---|---|---|---|
| 3306 | `[::]:3306=mysql` | `mysql` | El gateway **habla primero** (saludo MySQL); TLS con SNI tras el SSLRequest. Listener **dedicado**: el `kind` debe ir solo, no se mezcla con otros. |
| 6379 | `[::]:6379=tls` | `tls` | Redis con TLS directo. Con `tls+redis-plain` un cliente sin TLS (`*...`) recibe `-ERR TLS ... required` en vez de un cierre mudo. |
| 27017 | `[::]:27017=tls` | `tls` | MongoDB con `tls=true`. Con `tls+mongo-plain` un mensaje sin TLS se reconoce y se cierra (sin respuesta). |

Ejemplo: `CAPSULE_GW_LISTEN='[::]:3306=mysql,[::]:6379=tls,[::]:27017=tls'`. `[::]` es doble pila (IPv4 e IPv6, probado con `127.0.0.1` y `::1`). El `protocol` del servicio (`mysql`/`mariadb`, `redis`, `mongo`/`mongodb`) decide el manejador: un nombre de otro protocolo que llegue por la puerta equivocada se trata como «sin ruta». Una ruta `redis` o `mongo` que llegue tras un `SSLRequest` de PostgreSQL se rechaza (`protocol_mismatch`) y no se reenvía al backend.

Límites y métricas por protocolo (además de los de ruta/IP del control):

- `CAPSULE_GW_PROTO_MAX_CONNS="mysql=1500,redis=1500,mongo=1500"` (por omisión 1500 cada uno; `0` = sin tope). Al llegar al tope la conexión autorizada se cierra (`limit_proto`); las existentes no se tocan.
- Métricas: `gw_proto_conns_active{protocol}`, `gw_proto_conns_total{protocol,result}`, `gw_proto_denied_total{protocol,reason}` (`no_tls`, `bad_hello`, `no_sni`, `no_route`, `protocol_mismatch`, `limit_proto`). Las negativas de Redis/MongoDB anteriores a conocer la ruta (nombre desconocido) caen en `gw_conns_total{route="-"}`, porque el protocolo se sabe por la ruta.
- Preautenticación: el reloj de `CAPSULE_GW_HELLO_TIMEOUT` (10 s) cubre saludo + SSLRequest + ClientHello en MySQL, y el ClientHello en Redis/Mongo (slowloris: se corta a los 10 s). Tope por IP: `CAPSULE_GW_PREAUTH_PER_IP` y `CAPSULE_GW_NEW_CONNS_PER_IP`, y el bloqueo por intentos fallidos de siempre.

## 2. Redis

El servicio se crea con `protocol: redis`. Cadena: `rediss://<nombre>:6379`.

- `passthrough` (por omisión): el Redis del servicio debe servir TLS (`--tls-port`); el cliente ve **el certificado del Redis**.
- `terminate`: el gateway termina TLS con su certificado (comodín) y habla en claro con un Redis sin TLS; el cliente puede verificar el nombre contra la CA del gateway.

Requisitos del cliente: **debe enviar SNI**. Las bibliotecas lo envían con el nombre del host (no probadas aquí: go-redis, ioredis, redis-py). **`redis-cli` no lo envía por el host: hay que pasar `--sni`**:

```
redis-cli --tls --sni mi-redis-proy.db.tumi-ai.com -h mi-redis-proy.db.tumi-ai.com -p 6379 ping
redis-cli --tls --sni mi-redis-proy.db.tumi-ai.com -h 203.0.113.10 -p 6379 --cacert ca.crt ping   # por IP, solo con --sni
```

Sin SNI la conexión se cierra (`SSL_connect failed: unexpected eof`), igual que un nombre desconocido.

## 3. MongoDB

`protocol: mongo`. Cadena: `mongodb://<usuario>:<clave>@<nombre>:27017/?tls=true`. Modo `passthrough`: el mongod debe usar `--tlsMode requireTLS` (el cliente ve su certificado; para verificar hay que darle la CA del servicio o `tlsAllowInvalidCertificates` en pruebas). `terminate` funciona igual que en Redis, pero el plan solo ofrece passthrough.

Requisitos: `tls=true` y conectar **por nombre** (los controladores envían SNI con el nombre del host; con una IP no hay SNI y no se puede enrutar). Con `mongosh --tls --host <nombre>` verificado.

## 4. MySQL / MariaDB

`protocol: mysql` (o `mariadb`). Cadena: `mysql://usuario:clave@<nombre>:3306/?ssl-mode=REQUIRED`.

### Cómo funciona (y por qué difiere de los otros)

En MySQL el servidor habla primero, así que el gateway no puede leer el nombre antes de decir algo. Lo que hace en un listener `=mysql`:

1. Envía **su propio saludo** (HandshakeV10, `CLIENT_SSL` anunciado, plugin `caching_sha2_password`, versión `8.0.0-capsule-gw`).
2. El cliente responde con el SSLRequest corto y arranca TLS: el ClientHello trae el SNI. Un cliente que no pasa a TLS recibe `ERROR 3159 ... insecure transport are prohibited` y se cierra (el mensaje no depende del nombre).
3. Nombre → ruta → `authorize`. Nombre desconocido: cierre sin respuesta tras el retardo uniforme.
4. **passthrough**: marca al backend, lee y descarta su saludo, le repite el SSLRequest y el ClientHello del cliente y relaya bytes: TLS de extremo a extremo con el MySQL. Como el cliente calculó la clave con la sal del gateway y no la del backend, funciona porque el servidor la rehace: con `caching_sha2_password` pasa a autenticación completa (la clave viaja dentro del TLS) y con otro plugin envía `AuthSwitchRequest` con su propia sal. Verificado con usuarios `caching_sha2_password` y `mysql_native_password`; una clave mala devuelve el `1045 Access denied` del propio backend.
   **terminate**: el gateway termina el TLS del cliente con su certificado y abre una sesión TLS nueva hacia el backend (sin verificar el certificado del backend: red interna, destino fijado por la ruta); el backend **debe ofrecer TLS** (MySQL 8 lo trae y así se probó; MariaDB: probado con certificado configurado, el valor por omisión de 11.4+ no se verificó) o la conexión se cierra (`dest_no_tls`).

### Qué clientes funcionan (medido)

| Cliente | ¿Envía SNI? | Resultado |
|---|---|---|
| Controlador Go `go-sql-driver/mysql` v1.10 con `tls.Config{ServerName: <nombre>}` (`tls=true` con host por nombre: no probado) | Sí | **OK** passthrough (MySQL 8.4 y MariaDB 11.8), terminate (verificando con la CA del gateway), IPv4 e IPv6. Con `InsecureSkipVerify` el controlador **no** rellena `ServerName`: hay que ponerlo a mano. |
| `mariadb` CLI (MariaDB Connector/C 11) con `--ssl` | Sí | **OK** contra MariaDB 11.8 y contra MySQL 8.4 (passthrough). |
| `mysql` CLI 8.4.13 (libmysqlclient) con `--ssl-mode=REQUIRED` o `PREFERRED` | **No** | **No se puede enrutar por nombre**: el gateway ve un ClientHello sin SNI y cierra (`no_sni`). |
| `mysqlsh` | **No verificado** | Usa libmysqlclient como `mysql`: se espera el mismo comportamiento (no se probó, no estaba disponible). |
| Node `mysql2`, Connector/J, otros con JSSE/`tls.connect` | **No verificado** | Deberían enviar SNI si reciben el nombre del host (`servername`); no se probaron. |
| Cualquiera con `ssl-mode=DISABLED` | — | `ERROR 3159` (TLS obligatorio). |

### Qué hacer con los clientes sin SNI (`mysql`, `mysqlsh`)

La opción de menor riesgo, sin tocar el gateway: **puerto arrendado** (PLAN 3.4, pool 20000-29999, G16). Ese puerto es TCP en passthrough directo al backend, sin SNI, y MySQL funciona tal cual porque el backend habla primero. Verificado: `mysql -h 127.0.0.1 -P 20001 --ssl-mode=REQUIRED` por un puerto arrendado conectó con TLS 1.3 al MySQL 8.4 del servicio. La UI/CLI debe ofrecer para MySQL la cadena con puerto (`-P <puerto arrendado>`) junto a la cadena con nombre. Alternativa futura **no implementada**: enrutar por el usuario dentro del TLS terminado (`usuario#servicio`), que exigiría reescribir el paquete de autenticación y un `access` nuevo en `/authorize`; no se hizo para no cambiar el contrato del control.

Otros límites del lado MySQL:

- Verificación del certificado: en `passthrough` el cliente ve el certificado del backend, así que `VERIFY_IDENTITY` falla (el nombre no está en él); usar `terminate` (certificado comodín del gateway) o `REQUIRED`.
- Compresión (`--compress`, `zstd`) y atributos de consulta no se ofrecen en el saludo; no funcionan por el gateway. `LOAD DATA LOCAL` se anuncia, pero depende del backend y el cliente.
- La versión del servidor que el cliente lee en el saludo es la del gateway; la real llega después (`SELECT @@version` devuelve la del backend).
- MySQL del backend con `max_connections` agotado: el gateway cierra (`dest_down`); el cliente ve un error de TLS, no el `1040` del servidor (el saludo del backend nunca se reenvía).
- Con `terminate` la carga es mayor (dos sesiones TLS por conexión).

## 5. Dónde se probó y qué cifras salieron

Binario real `backend/cmd/capsule-gateway` (Linux, `CGO_ENABLED=0`) en WSL Ubuntu, contenedores desechables `mysql:8` (8.4.13) ×2, `mariadb:11` (11.8.9), `redis:7` ×2 con TLS y 1 sin TLS, `mongo:7` ×2 con `requireTLS`, y un control mínimo local. Resultados y números: informe del paquete (no se vuelven a contar aquí). Para repetir: ruta por nombre con dos instancias de cada motor (`a`/`b`), una ruta `terminate` por motor, y los clientes de la tabla. El bloqueo por intentos fallidos (`source blocked`) afecta a la IP de pruebas tras varios nombres desconocidos seguidos: reiniciar el gateway de prueba o usar otra IP de origen.
