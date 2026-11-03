# Protocolo `capsule/1` del gateway de Capsule (especificación normativa)

Estado: ESPECIFICACIÓN v1.0-borrador. Derivada de `PLAN.md` §3, §5.3, §5.4, §7, §8 y §10; donde difiere del plan, manda este documento (ver §17 "Cambios respecto al plan"). Vectores de prueba: `testvectors/`. Verificador de referencia: `testvectors/verify/`.

Objetivo: que dos implementaciones independientes (Go y JavaScript/TypeScript) y el gateway de referencia interoperen leyendo solo este documento.

## 1. Alcance y convenciones

1. Las palabras DEBE, NO DEBE, DEBERÍA, PUEDE se usan como en RFC 2119 (DEBE = obligatorio; DEBERÍA = recomendado salvo razón justificada; PUEDE = opcional).
2. Todos los enteros multibyte son **big-endian** (orden de red). `u8`, `u16` = sin signo de 8/16 bits.
3. Los campos de texto son **ASCII**. Un byte ≥ 0x80 en un campo de texto es inválido salvo donde se indique.
4. "Cliente" = quien abre la conexión (librería, CLI, agente). "Gateway" = el servidor `capsule-gateway`. "Destino" = el servicio interno al que se enruta (contenedor en `capsule-net`).
5. El protocolo `capsule/1` es un **preámbulo de enrutamiento autenticado** que viaja dentro de TLS. Tras una respuesta `CAPR` con estado 0, los bytes son transparentes (transporte `tcp`) o se encuadran como datagramas (transporte `udp` sobre flujo, §10).
6. Definiciones de nombre:
   - `name` = 1 a 63 caracteres de `[a-z0-9-]`, que no empieza ni termina en `-`. Expresión: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`. Se usa para `proyecto` (slug) y `servicio` (nombre del puerto configurado).
   - `dnsname` = una o más etiquetas `name` separadas por `.`, longitud total ≤ 253, **en minúsculas**.
7. Resumen de capas:

```
 aplicación del usuario (ssh, psql, juego, ...)
 ------------------------------------------------
 capsule/1: encabezado CAP1 -> respuesta CAPR -> bytes transparentes | datagramas len16
 ------------------------------------------------
 TLS 1.3, ALPN "capsule/1", SNI tcp.<zona> | udp.<zona>
 ------------------------------------------------
 TCP (443)    [QUIC/UDP 443: FUTURO, §10.6]
```

## 2. URI `capsule://`

### 2.1 Gramática (ABNF, RFC 5234)

```
capsule-uri = "capsule://" project "/" service [ "?" query ]
project     = name
service     = name
name        = ALNUM-LC *61( ALNUM-LC / "-" ) ALNUM-LC / ALNUM-LC   ; 1..63, ver §1.6
ALNUM-LC    = %x61-7A / DIGIT
query       = param *( "&" param )
param       = key "=" value
key         = 1*( %x61-7A / DIGIT / "-" / "_" )
value       = 1*( unreserved / pct-encoded / sub-delims / ":" / "[" / "]" )
pct-encoded = "%" HEXDIG HEXDIG
```

El esquema `capsule` no distingue mayúsculas de minúsculas (`CAPSULE://` es válido, RFC 3986 §3.1). **Todo lo demás distingue**: `project` y `service` DEBEN estar en minúsculas; un analizador **NO DEBE** normalizar mayúsculas (rechaza). No hay `userinfo`, ni puerto, ni fragmento, ni barra final, ni segmentos adicionales de ruta, y el URI **NO DEBE** contener secretos: el token jamás viaja en el URI (§11).

### 2.2 Parámetros opcionales

| clave | valores | por defecto | significado |
|---|---|---|---|
| `transport` | `tcp`, `udp` | `tcp` | Transporte lógico del servicio. Determina la etiqueta del host (§3) y el campo `transport` del encabezado (§5) |
| `family` | `4`, `6`, `any` | `any` | Restringe las familias de direcciones IP usadas al resolver y conectar |
| `zone` | `dnsname` con ≥2 etiquetas | zona configurada (`CAPSULE_GATEWAY_ZONE`) | Zona del gateway: host = `<tcp\|udp>.<zona>` |
| `gateway` | `host[:puerto]` | derivado de la zona | Anula el punto de entrada. `host` = `dnsname`, IPv4 literal, o IPv6 literal **entre corchetes** `[2001:db8::1]`; puerto 1..65535 (def. 443). Sin identificador de zona IPv6 (`%eth0` es inválido) |
| `sni` | `dnsname` | el host del gateway | Nombre para SNI **y** para validar el certificado. **Obligatorio** si `gateway` es un literal IP |
| `x-*` | cualquiera | — | Extensiones locales: se **ignoran**; no se validan |

Reglas: cada clave a lo sumo una vez; `gateway` y `zone` son mutuamente excluyentes; una clave desconocida sin prefijo `x-` es error; valores vacíos y consultas vacías (`?`) son errores. Los valores se decodifican de `%XX` (hex en mayúsculas o minúsculas) **una sola vez**, el resultado DEBE ser ASCII visible (0x21..0x7E). Los generadores DEBERÍAN codificar `[`, `]` como `%5B`, `%5D`; los analizadores DEBEN aceptar ambas formas. La zona por defecto la aporta la configuración del cliente (no viaja en el URI); el valor de fábrica de la implementación Capsule es `apps.tumi-ai.com`.

Resultado del análisis: `project`, `service`, `transport`, `family`, `connect_host`, `connect_port`, `sni`. Los IPv6 literales se devuelven en forma canónica comprimida RFC 5952 en minúsculas, sin corchetes.

### 2.3 Errores del analizador (nombres normativos)

Orden de evaluación (el primer fallo gana; los vectores `uri.json` lo fijan):

1. esquema distinto de `capsule://` → `bad_scheme`
2. aparece `#` → `fragment`
3. se separa la consulta en el primer `?`; se separa `project` en la primera `/`
4. `@` en la parte de proyecto → `userinfo`; `:` → `port`
5. `project` no es `name` → `bad_project` (incluye vacío, mayúsculas, `%`, `_`, 64+ caracteres)
6. falta `/` o hay más `/` en el resto → `bad_path`; servicio no es `name` (incluye vacío) → `bad_service`
7. consulta: vacía, `clave` sin `=`, valor vacío → `bad_param`; clave repetida → `dup_param`; clave desconocida (sin `x-`) → `unknown_param`; `%` mal formado → `bad_escape`; valor fuera de su dominio → `bad_param`; `gateway`+`zone` → `bad_param`; host de `gateway` mal formado, puerto fuera de 1..65535, IPv6 sin corchetes o con zona → `bad_gateway`; literal IP sin `sni` → `sni_required`

Ejemplos: `capsule://mi-proyecto/db`; `capsule://mi-proyecto/minecraft?transport=udp`; `capsule://p/s?gateway=%5B2001:db8::1%5D:8443&sni=tcp.apps.example.test` (IPv6: la dirección va solo en `gateway`; el URI en sí no tiene "host IP").

## 3. Host de conexión y red

- Punto de entrada por defecto: `tcp.<zona>` (transport `tcp`) o `udp.<zona>` (transport `udp`), puerto **443**. Ej.: `tcp.apps.tumi-ai.com`. La etiqueta `tcp.`/`udp.` es un **transporte lógico en el host de entrada**, no el protocolo de aplicación (PLAN §3.1).
- Ambos nombres tienen registros **A y AAAA**. Hoy resuelven a la misma IP; el protocolo no lo supone: el cliente DEBE resolver y conectar por nombre.
- El gateway DEBE atender en `443/TCP` los dos nombres (`tcp.<zona>` y `udp.<zona>`) con el mismo certificado. El campo `transport` del encabezado (§5) es **la fuente de verdad** para el comportamiento; la etiqueta SNI es solo una pista de red. Combinaciones válidas por TCP/TLS: SNI `tcp.*` con transport 1 o 2; SNI `udp.*` con transport 1 o 2 (el respaldo UDP-sobre-flujo puede ir por cualquiera de los dos).
- Clientes: DEBEN resolver A y AAAA y conectar con **Happy Eyeballs** (RFC 8305), respetando `family`. Los servidores escuchan en doble pila.
- El cliente NO DEBE conectarse por dirección IP sin `sni` explícito (§2.2). No hay redirecciones: el gateway no reenvía a otro host.
- El cliente NO DEBE abrir la conexión ni enviar el encabezado si no hay TLS establecido (§4).

## 4. TLS

| Requisito | Valor |
|---|---|
| Versión mínima | **TLS 1.3** (RFC 8446). Clientes y gateway DEBEN rechazar TLS ≤ 1.2 en `capsule/1`. Razón: el cierre ordenado con half-close (§9) solo está definido con semántica de lado de escritura en TLS 1.3 |
| ALPN | El cliente DEBE ofrecer `capsule/1` (RFC 7301). El gateway DEBE seleccionar `capsule/1` si lo ofrecen y abortar con alerta `no_application_protocol` (120) si no. El cliente DEBE abortar si el servidor no selecciona `capsule/1`. ALPN futuros (`capsule/2`) se ofrecen en orden de preferencia, ver §14 |
| SNI | DEBE enviarse: `tcp.<zona>`, `udp.<zona>` o el `sni` del URI. El gateway sin SNI reconocido cierra sin respuesta de aplicación |
| Certificado del gateway | El cliente DEBE validar la cadena contra las raíces de confianza del sistema (o la CA fijada por configuración para despliegues privados) y que el nombre (SAN `dNSName`, RFC 6125) coincida con el SNI efectivo. **NO DEBE** desactivar la verificación en producción (la opción `InsecureSkipVerify` del prototipo no existe en la API pública; solo un parámetro explícito de prueba contra `localhost`/`.test`) |
| Certificado de cliente | No requerido (mTLS opcional para agentes, PLAN §5.2, fuera de v1) |
| 0-RTT / early data | **PROHIBIDO.** El gateway NO DEBE aceptar early data; el cliente NO DEBE enviarla. El encabezado se envía solo tras completar el handshake |
| Reanudación de sesión | Permitida (tickets). No cambia las reglas de autenticación: el encabezado se envía en cada conexión |
| Suites | Las de TLS 1.3 obligatorias (`TLS_AES_128_GCM_SHA256`, `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`) |
| Plazo de handshake | 10 s (cliente y gateway) |

El gateway termina TLS en este puerto; el destino se alcanza **en claro** dentro de `capsule-net`. Si el servicio habla TLS propio (PostgreSQL), el cliente DEBERÍA negociarlo **dentro** del túnel (doble TLS) para que el gateway no vea el contenido (PLAN §6).

## 5. Encabezado de solicitud `CAP1` (cliente → gateway)

Se envía **una sola vez**, justo después del handshake TLS, como primeros bytes de datos de aplicación. Un solo mensaje, longitud autodescrita.

```
off  tam  campo       descripción
 0    4   magic       "CAP1" = 43 41 50 31
 4    1   version     0x01
 5    1   flags       bit0 = want_proxy_info (pide la TLV 0x04 en la respuesta)
                      bits 1..7 RESERVADOS = 0 (si no, error 0x0104)
 6    2   hdr_len     longitud TOTAL del encabezado en bytes, incluye magic..TLV. 17 <= hdr_len <= 1024
 8    1   transport   1 = tcp (flujo transparente)
                      2 = udp sobre flujo (datagramas len16, §10)
                      3 = udp sobre QUIC (FUTURO; sintácticamente válido, §10.6)
 9    1   proj_len    1..63
10    n   project     `name` ASCII
 .    1   svc_len     1..63
 .    m   service     `name` ASCII
 .    1   auth_type   1 = cap_ (token de API)   2 = cgt_ (token git)
                      3 = cgc_ (token de conexión firmado)   4 = cgs_ (token de servicio)
 .    2   auth_len    8..512
 .    k   auth        bytes ASCII del token completo, con su prefijo
 .    *   TLV*        extensiones opcionales hasta hdr_len (puede no haber ninguna)
```

Longitud real mínima de un encabezado válido: 9 + 2 + 2 + 3 + 8 = 24 bytes. El valor 17 de `hdr_len` es solo el **piso estructural** que se comprueba en el paso 3 (valores menores → `0x0103`); entre 17 y 23 el error sale de los pasos 5-6 (`0x010B`). Máximo 1024. Longitud máxima sin TLV: 9 + 1 + 63 + 1 + 63 + 1 + 2 + 512 = 652.

**Reglas de campo.**
- `auth`: el prefijo DEBE corresponder a `auth_type` (`cap_`, `cgt_`, `cgc_`, `cgs_`) y los caracteres ∈ `[A-Za-z0-9_.-]`.
- Los campos de longitud DEBEN caber en `hdr_len`; los campos consumen el encabezado **exactamente** hasta el inicio de las TLV, y las TLV hasta `hdr_len` exacto (sin bytes sobrantes).
- No hay relleno de alineación. El relleno de tamaño opcional se hace con la TLV `0x80`.

**TLV** (`tipo u8`, `len u8`, `valor`):

| tipo | nombre | valor | notas |
|---|---|---|---|
| 0x01 | nonce | 16 bytes aleatorios | a lo sumo una vez. Fresco **en cada intento** de conexión (también en reintentos). El gateway PUEDE rechazar un nonce repetido en 5 min (`status 2`, `0x0203`) |
| 0x02 | client_id | ASCII `[A-Za-z0-9._/+-]{1,64}`, p. ej. `capsule-go/0.1.0` | a lo sumo una vez; solo informativo y para auditoría; NO DEBE contener datos personales |
| 0x80 | padding | `len` bytes (DEBERÍAN ser 0x00) | cualquier número de veces; se ignora. Sirve para ocultar la longitud del token |
| 0x81..0xFF | — | cualquiera | desconocidos con bit alto: se **ignoran** (compatibilidad hacia adelante) |
| 0x00, 0x03..0x7F | — | — | desconocidos sin bit alto: **error** `0x0108` |

**Algoritmo de decodificación del gateway (normativo; el orden fija el código de error):**

1. Acumular bytes. Si hay <8 bytes: con el flujo abierto, esperar; con EOF → `0x010A`.
2. `magic` ≠ `CAP1` → `0x0102`. `version` ≠ 1 → `0x0101` (sin leer más: el cuerpo de una versión desconocida no se interpreta).
3. Leer `hdr_len`; fuera de [17, 1024] → `0x0103`. Esperar hasta tener `hdr_len` bytes (EOF antes → `0x010A`; plazo de §9 agotado → `0x010A`).
4. `flags` con bits reservados → `0x0104`. `transport` ∉ {1,2,3} → `0x0109`.
5. `proj_len`, `project`, `svc_len`, `service`: longitud fuera de 1..63 → `0x0105`; si excede lo que queda del encabezado → `0x010B`; no es `name` → `0x0105`.
6. `auth_type` ∉ 1..4 → `0x0106`; `auth_len` fuera de 8..512 → `0x0106`; excede el encabezado → `0x010B`; prefijo/caracteres inválidos → `0x0106`. (Si falta algún byte de los campos fijos antes de poder leerlos → `0x010B`.)
7. TLV hasta `hdr_len`: un solo byte restante, `len` que excede, longitud incorrecta para un tipo conocido, duplicado de 0x01/0x02 o `client_id` mal formado → `0x0107`; tipo desconocido sin bit alto → `0x0108`.
8. Los bytes **después** de `hdr_len` no pertenecen al encabezado: son datos de aplicación enviados de forma optimista. El gateway DEBE conservarlos en búfer y NO DEBE reenviarlos al destino hasta autorizar (si falla la autorización, los descarta).

Solo tras pasar 1-8 el gateway evalúa autenticación y política (§11, §12). Los vectores `testvectors/request.json` cubren cada código.

El cliente DEBE: construir `hdr_len` correcto, enviar `flags` reservados = 0, no repetir TLV 0x01/0x02, y poder esperar la respuesta (el envío optimista de datos es PUEDE; recomendado solo cuando el servicio habla primero el cliente).

## 6. Respuesta `CAPR` (gateway → cliente)

El gateway DEBE enviarla antes de cualquier dato de aplicación, siempre que el encabezado se haya leído completo **o** haya error de formato (en cuyo caso se envía si es posible y luego se cierra). Tras `status ≠ 0` el gateway cierra la conexión TLS con `close_notify`.

```
off  tam  campo     descripción
 0    4   magic     "CAPR" = 43 41 50 52
 4    1   version   versión efectiva (= version de la solicitud) si status 0; si status=1/0x0101: la MÁXIMA versión que soporta el gateway
 5    1   status    ver §7
 6    2   code      detalle (informativo; §7)
 8    1   msg_len   0..120
 9    n   msg       texto ASCII visible (0x20..0x7E); NO DEBE contener datos internos, nombres de proyectos ajenos ni el token
 .    2   ext_len   0..256
 .    e   ext       TLV de respuesta (mismo formato tipo/len/valor)
```
Si `status = 0` el `code` es `0x0000`. Los bytes que siguen a `ext` son datos del destino (transparentes).

TLV de respuesta (**cualquier tipo desconocido se ignora**; los conocidos se validan; cada conocido a lo sumo una vez):

| tipo | nombre | valor |
|---|---|---|
| 0x01 | max_version | `u8` — con `status=1`: versión máxima soportada |
| 0x02 | retry_after | `u16` segundos — con status 5 o 6 |
| 0x03 | session_id | 8 bytes — identificador de sesión (solo `transport` 2/3; en transport 1 NO se envía). Es único en el gateway durante la vida de la sesión; el cliente lo usa solo para correlacionar con la auditoría |
| 0x04 | client_addr | solo si el cliente pidió `want_proxy_info`: dirección que el gateway ve del cliente tras NAT: `family u8` (4 o 6) + 4 o 16 bytes + `puerto u16`. Longitud 7 o 19 |
| 0x05 | max_datagram | `u16` — tamaño máximo de datagrama aceptado (transport 2/3); ≤ 2048 en transport 2 |
| 0x06 | idle_timeout | `u16` segundos — inactividad tras la cual el gateway cierra la sesión UDP (def. 60) |
| 0x80+ | relleno/futuras | se ignoran |

Decodificación en el cliente: <9 bytes → esperar (o `truncated` en EOF); `magic` ≠ `CAPR` → error de protocolo; `version` 0 → error; `msg_len` >120, caracteres fuera de 0x20..0x7E, `ext_len` >256, TLV conocida con longitud/familia incorrecta o repetida → error de protocolo. Un `status` desconocido (p. ej. 9) se **decodifica** y se trata como error **no reintentable**. Errores de protocolo en la respuesta cierran la conexión y NO son reintentables automáticamente más de una vez.

## 7. Códigos de estado y de error

`status` (u8) es la clase; `code` (u16) = `0xSSNN` donde `SS` es el status; es informativo y estable. **Reintentable** = la librería PUEDE reintentar automáticamente con retroceso exponencial (inicio 500 ms, factor 2, tope 30 s, jitter ±20 %, máx. 5 intentos; respetando `retry_after`).

| status | nombre | `code` | semántica | reintentable | libreria: error tipado |
|---|---|---|---|---|---|
| 0 | OK | 0x0000 | conexión establecida; bytes transparentes o datagramas | — | — |
| 1 | BadRequest | 0x0101 | versión no soportada (`version`≠1 en solicitud). `CAPR.version` y TLV 0x01 = versión máxima | solo tras renegociar versión (§14); no automático si ya se bajó | `UnsupportedVersion` |
| 1 | | 0x0102 | `magic` incorrecto | no | `BadRequest` |
| 1 | | 0x0103 | `hdr_len` fuera de [17,1024] | no | `BadRequest` |
| 1 | | 0x0104 | banderas reservadas activas | no | `BadRequest` |
| 1 | | 0x0105 | nombre de proyecto/servicio inválido | no | `BadRequest` |
| 1 | | 0x0106 | `auth_type`/token con formato inválido | no | `BadRequest` |
| 1 | | 0x0107 | TLV mal formada | no | `BadRequest` |
| 1 | | 0x0108 | TLV crítica desconocida | no | `BadRequest` |
| 1 | | 0x0109 | `transport` inválido **o no habilitado** (p. ej. 3 sin QUIC) | no | `UnsupportedTransport` |
| 1 | | 0x010A | encabezado truncado o plazo de 5 s agotado | sí (1 vez) | `BadRequest` |
| 1 | | 0x010B | longitudes internas incoherentes con `hdr_len` | no | `BadRequest` |
| 2 | NotAuthorized | 0x0201 | **respuesta uniforme**: token inválido, revocado, sin permiso, proyecto inexistente, servicio inexistente o servicio no expuesto por gateway. Mensaje fijo `not authorized` | no | `NotAuthorized` |
| 2 | | 0x0202 | token `cgc_` con firma válida pero expirado o aún no válido (`exp`/`nbf`). Se emite solo si la firma es válida, antes de resolver proyecto o servicio, por lo que no revela su existencia | tras renovar el token | `TokenExpired` |
| 2 | | 0x0203 | `jti` (cgc_) o nonce repetido (reproducción) | no con el mismo token | `NotAuthorized` |
| 3 | IpDenied | 0x0301 | autenticado y autorizado para el servicio, pero la IP de origen no está en la lista del proyecto | no | `IpDenied` |
| 4 | Unavailable | 0x0401 | destino caído / sin salud | sí | `Unavailable` |
| 4 | | 0x0402 | el destino no aceptó la conexión en 5 s | sí | `Unavailable` |
| 5 | QuotaExceeded | 0x0501 | máximo de conexiones del proyecto | sí, con `retry_after` | `QuotaExceeded` |
| 5 | | 0x0502 | máximo de conexiones por IP | sí | `QuotaExceeded` |
| 5 | | 0x0503 | tasa de conexiones nuevas | sí | `QuotaExceeded` |
| 5 | | 0x0504 | máximo de sesiones UDP | sí | `QuotaExceeded` |
| 6 | GatewayBusy | 0x0601 | gateway drenando por actualización | sí (a otra conexión inmediata) | `GatewayBusy` |
| 6 | | 0x0602 | plano de control no alcanzable y el token no está en caché (**falla cerrada**) | sí | `GatewayBusy` |
| 6 | | 0x0603 | error interno | sí (1-2 veces) | `GatewayBusy` |

Notas: (a) los estados 1-3 NO son reintentables, salvo `0x010A` (una vez) y la renovación de `0x0202`; (b) sin respuesta (el gateway cerró antes de poder escribir, o reinició TCP): el cliente lo trata como `Unavailable` reintentable; (c) un `status` o `code` desconocido: no reintentable; (d) el estado 3 SOLO se emite tras autenticar y autorizar el servicio; antes, la misma condición produce estado 2 (§15.3).

## 8. Handshake paso a paso

### 8.1 TCP (transport 1), éxito

```
Cliente                                          Gateway                         Destino
   | --- DNS A/AAAA tcp.<zona> ------------------->  (resolvedor)                   |
   | === TCP SYN/SYN-ACK/ACK (443, Happy Eyeballs) ==>                              |
   | --- TLS ClientHello (SNI=tcp.<zona>, ALPN=capsule/1, min TLS1.3) -->           |
   | <-- ServerHello ... Finished (certificado válido para SNI) ---                 |
   | --- Finished ------------------------------------>   (handshake completo)      |
   | --- CAP1{proyecto, servicio, token, transport=1} --> plazo 5 s de lectura      |
   |                                          decodificar (§5) -> autenticar (§11)  |
   |                                          autorizar+IP (§12) -> abrir ---TCP---> |
   | <-- CAPR{status=0} --------------------------------   (tras conectar al destino)
   | <=== bytes transparentes en ambos sentidos ==========================>        |
```
El gateway DEBE responder `status=0` **solo después** de que la conexión al destino esté establecida (así los errores 4xx se informan antes de datos). Si el destino habla primero (SSH), esos bytes aparecen justo después de `CAPR`.

### 8.2 Rechazo (estado 2), con retardo uniforme

```
Cliente                                   Gateway
   | --- CAP1{proyecto-inexistente, token} -->
   |                      t0 = fin de lectura del encabezado
   |                      decodificar ok; token no valida / proyecto no existe
   |                      esperar hasta t0 + T_UNIF (300 ms +- 50 ms de jitter)
   | <-- CAPR{status=2, code=0x0201, msg="not authorized"} --
   | <-- close_notify ------------------------
   | --- close_notify -->
```
`T_UNIF` se aplica a **todas** las respuestas de estado 2 (con 0x0201) y se mide desde que se completó el encabezado, independientemente de la causa (§15.3).

### 8.3 Reintento con versión menor (negociación, §14)

```
Cliente (soporta 1 y 2)                         Gateway (soporta solo 1)
   | -- ClientHello ALPN=[capsule/2, capsule/1] -->
   | <- ServerHello ALPN=capsule/1 --------------   (selección TLS: ya negociado v1)
   | -- CAP1 version=1 ... -->   (el cliente usa la versión de la ALPN elegida)
```
Si el servidor ignora la preferencia y la solicitud llega con una versión mayor de la soportada: `CAPR{version=1, status=1, code=0x0101, ext=[max_version=1]}` + cierre; el cliente PUEDE reabrir **una vez** con `capsule/1` si su política lo permite (`min_version`).

### 8.4 UDP sobre flujo (transport 2), éxito

```
Cliente (socket UDP local)                Gateway                           Destino (UDP)
   | -- TLS (SNI=udp.<zona>) + CAP1{transport=2, flags=bit0} -->
   | <- CAPR{status=0, ext=[session_id, client_addr, max_datagram, idle_timeout]}
   |                                        | crea UN socket UDP (puerto de origen estable)
   | -- [len16|datagrama] ------------------> -- UDP ------------------------>  |
   | <- [len16|datagrama] <---------------- <-- UDP -------------------------   |
   | -- [0000] (keepalive) -->  (reinicia inactividad; no se reenvía)
```

## 9. Semicierre, cierre ordenado, límites y tiempos de espera

### 9.1 Semicierre (half-close) — transport 1
Tras `CAPR status=0`, las dos direcciones son independientes:
- Cliente → gateway: cuando la aplicación local termina de escribir, el cliente envía `close_notify` de TLS (en Go `tls.Conn.CloseWrite`; en Node `socket.end()` con `allowHalfOpen: true`). El gateway DEBE traducirlo a `shutdown(SHUT_WR)` (FIN) hacia el destino **y seguir copiando** destino → cliente hasta que el destino cierre.
- Destino → gateway: un FIN del destino se traduce en `close_notify` hacia el cliente; el gateway sigue aceptando bytes del cliente hacia el destino (que el destino pueda ya no leer: se descartan).
- La conexión se cierra por completo cuando ambas direcciones terminaron, o por plazo (§9.3), o por error.
- Un RST, un fallo de TLS o una alerta distinta de `close_notify` cierran ambas direcciones inmediatamente (y el otro extremo recibe RST/`close_notify` de aborto).
- Orden de cierre normal: (1) el primer extremo en terminar de escribir envía `close_notify`; (2) el otro lo recibe como EOF de lectura, termina de escribir lo pendiente y envía su `close_notify`; (3) se cierra el TCP subyacente. Un cliente NO DEBE tratar la ausencia de `close_notify` antes del cierre TCP como finalización limpia (truncamiento): DEBE reportar error de fin inesperado **salvo** que el protocolo de aplicación indique su propio fin.
- UDP sobre flujo (transport 2): no hay half-close; el cierre de cualquier lado termina la sesión.

### 9.2 Cierre iniciado por el gateway
Por inactividad, drenado, o política: `close_notify` y cierre TCP. Con el servidor en drenado (actualización de binario), las conexiones existentes siguen hasta cerrarse por sí solas o hasta 24 h; las nuevas reciben `status 6 / 0x0601`.

### 9.3 Límites y tiempos (valores por defecto; configurables por el operador salvo los marcados FIJO)

| Concepto | Valor | Notas |
|---|---|---|
| Establecer TCP (cliente) | 10 s por dirección (Happy Eyeballs, retardo 250 ms entre familias) | |
| Handshake TLS | 10 s | |
| Lectura del encabezado `CAP1` (gateway) | **5 s** FIJO tras completar TLS, medido hasta tener `hdr_len` bytes | expira → `0x010A` si aún es posible escribir, si no cierre |
| Tamaño máx. del encabezado | **1024 B** FIJO | |
| Mínimo bytes para decidir | 8 | |
| Retardo uniforme de estado 2 | 300 ms ± 50 ms | §15.3 |
| Conexión al destino | 5 s | → `0x0402` |
| Espera de `CAPR` por el cliente | 20 s desde el envío del encabezado | expira: error `Unavailable` |
| Inactividad TCP tras OK | 3600 s por defecto; `0` = sin límite (p. ej. SSH con keepalive) según política del servicio | cualquier byte en cualquier sentido reinicia |
| Inactividad tras semicierre | 300 s | evita conexiones colgadas |
| Inactividad UDP | 60 s (30..300) | informada en TLV 0x06 |
| Drenado en actualización | 24 h máx. | §9.2 |
| `msg` de respuesta | ≤120 B | |
| Conexiones por proyecto / por IP | 200 / 50 | PLAN §5.2 |
| Conexiones nuevas por IP / por proyecto | 20/s / 100/s | |
| Fallos de autenticación por IP | 10/min, luego bloqueo temporal | §15.5 |
| Tokens cgc_ | vida máx. 300 s; tolerancia de reloj ±30 s | §11 |

El gateway NO DEBE leer del cliente más de `hdr_len` + 64 KiB antes de autorizar (tope del envío optimista); excedido: cierra.

## 10. UDP

### 10.1 Transportes
- `transport = 2`: **UDP sobre flujo**. Misma conexión TLS/TCP, host `udp.<zona>` o `tcp.<zona>`, mismo encabezado `CAP1` y `CAPR`. Es el transporte normativo de v1 (el que el gateway de referencia DEBE implementar).
- `transport = 3`: **UDP sobre QUIC**: FUTURO (§10.6); en v1 el gateway responde `status 1 / 0x0109`.

### 10.2 Una conexión = una sesión UDP
En transport 2 la conexión TLS **es** la sesión: un flujo UDP lógico (un "5-tuple" hacia el destino). El gateway abre **un socket UDP por sesión**, con puerto de origen estable durante toda la sesión (necesario para juegos y VoIP), conectado al `dest_host:dest_port` de la ruta. `session_id` (TLV 0x03 de `CAPR`) es de 8 bytes aleatorios, único entre sesiones activas, solo para correlación y auditoría. No se admite reanudar sesión en v1 (si el flujo TCP cae, se abre sesión nueva; el puerto de origen hacia el destino cambia).

### 10.3 Trama de datagramas (transport 2)
Tras `CAPR status=0`, cada mensaje en ambos sentidos es:

```
 0   2   len      u16 big-endian
 2   len datagrama (payload UDP tal cual; sin cabeceras IP/UDP)
```
- `len = 0`: **keepalive** (sin datagrama; no se reenvía al destino ni al cliente).
- `1 ≤ len ≤ 2048` (FIJO). `len > 2048` → el receptor cierra la conexión (error de protocolo). `max_datagram` (TLV 0x05) puede anunciar un tope menor; un datagrama mayor se descarta sin cerrar. Los datagramas > MTU de la ruta los fragmenta IP o TCP; el tamaño útil recomendado es ≤ 1472.
- No hay confiabilidad entre cliente y destino: el gateway descarta datagramas (con contador) si la cola de la sesión supera 256 KiB, en lugar de aplicar contrapresión indefinida (bloqueo de cabeza de línea inherente al flujo; documentado, §10.5).
- Una trama parcial (menos bytes que `len`) espera más datos; ver `udp_frames.json` (`pending`).

### 10.4 Keepalive, inactividad y NAT
- Cualquier trama (datos o keepalive) en cualquier sentido, **o** tráfico UDP del destino, reinicia el reloj de inactividad (`idle_timeout`, def. 60 s).
- El cliente DEBE enviar keepalive si no ha enviado nada en `idle_timeout / 3` (def. 20 s). El gateway PUEDE enviar keepalive al cliente en el mismo intervalo.
- NAT: como el túnel es TCP, el mapeo del NAT del cliente lo mantiene la propia conexión; el gateway NO DEBE basarse en la IP:puerto UDP del cliente (no existe). El socket UDP hacia el destino mantiene su mapeo por tráfico y por la política de 60 s; si el destino se comunica con un NAT intermedio, se espera que los keepalives de aplicación (juego) lo sostengan.
- Aplicación de la lista de IP: se evalúa **una vez** con la IP de la conexión TCP (§12).
- Recursos: un máximo de sesiones UDP por proyecto (def. 50) → `status 5 / 0x0504`.

### 10.5 Limitaciones declaradas
Bloqueo de cabeza de línea (una pérdida TCP retrasa los datagramas siguientes), latencia mayor que UDP nativo (medido en loopback p50 391 µs, PLAN §5.3), y doble búfer. Es el **respaldo universal** para redes que bloquean UDP; el camino preferido en el futuro es QUIC.

### 10.6 Opción QUIC — FUTURO (no normativa en v1; reserva de diseño)
Marcada como **no implementada y no probada**. Reservas para que v1 no la impida:
- Host `udp.<zona>`, **UDP/443**, ALPN `capsule/1` sobre QUIC v1 (RFC 9000) con datagramas RFC 9221 habilitados.
- Un flujo bidireccional (id 0) lleva `CAP1` (con `transport=3`) y `CAPR` con el mismo formato; `CAPR.status=0` crea la sesión y devuelve `session_id`.
- Cada datagrama QUIC: `session_id (8 B) | payload` (payload ≤ 1200 − 8); un solo `session_id` por flujo de control activo en v1 de QUIC. El keepalive es el PING de QUIC.
- La migración de conexión QUIC cubre el cambio de red/NAT del cliente.
- Hasta que el operador la habilite (capacidad anunciada fuera de banda), `transport=3` produce `0x0109`.

## 11. Autenticación

### 11.1 Credenciales
La credencial viaja **solo** en el campo `auth` del encabezado, dentro de TLS ya establecido (§4). NO DEBE enviarse en URI, parámetros, nombres DNS, SNI, ni en claro; el cliente que no haya completado TLS 1.3 con certificado válido NO DEBE emitir el encabezado.

| auth_type | prefijo | qué es | alcance | vida |
|---|---|---|---|---|
| 1 | `cap_` | token de API de usuario (hash en la base de Capsule) | los permisos `project:connect` del usuario sobre el proyecto pedido | los de su token (expiración configurada; revocable) |
| 2 | `cgt_` | token git | **solo** servicios marcados `git` (SSH a Forgejo); para cualquier otro servicio → 2/0x0201 | los de su token |
| 3 | `cgc_` | token de conexión firmado de corta vida, emitido por la API (`POST …/connection-token`) | **una** ruta `proyecto/servicio`; **un solo uso** | ≤ 300 s |
| 4 | `cgs_` | token de servicio (agentes, CI, aplicaciones) | **un proyecto** y, opcionalmente, un servicio; `project:connect`, sin permisos de administración | expiración obligatoria ≤ 90 días, revocable |

Los tokens `cap_`, `cgt_` y `cgs_` son opacos para el cliente, con ≥ 256 bits de entropía; el gateway los valida por hash (SHA-256 en comparación en tiempo constante) contra la base de Capsule con caché de 30 s (PLAN §5.2). Una **revocación** surte efecto a más tardar a los 30 s en conexiones nuevas. Las conexiones ya establecidas **no** se cortan por revocación salvo política `revoke_kills` activada por proyecto.

### 11.2 Formato de `cgc_`
`cgc_` + JWT compacto (RFC 7519) `b64url(header).b64url(payload).b64url(firma)` (base64url sin relleno; caracteres `[A-Za-z0-9_-]` y `.`).
- header: `{"alg":"EdDSA","typ":"cgc"}` (Ed25519, RFC 8037). Otros `alg` (incluido `none`) → 2/0x0201.
- payload: `sub` (id del principal), `route` (`"<proyecto>/<servicio>"`, DEBE coincidir con el encabezado), `iat`, `nbf` (opcional), `exp` (`exp − iat ≤ 300`), `jti` (único, ≥ 96 bits, ASCII), `kid` opcional para rotación de la clave de firma.
- Validación: firma con la clave pública vigente (el gateway acepta la actual y la anterior), `exp`/`nbf` con ±30 s de tolerancia, `route` coincide, `jti` no visto (caché hasta `exp + 30 s`). Fallo de firma/`alg`/`route` → 0x0201; expirado/no válido aún → 0x0202; `jti` visto → 0x0203. El gateway NO ve el contenido del payload más allá de estas comprobaciones y registra solo `jti`.

### 11.3 Reglas generales
- Comparaciones en tiempo constante; nunca se registra el token (solo id/`jti` y tipo).
- El orden de comprobación es: formato (§5) → firma/hash del token → permiso sobre `proyecto/servicio` → política (§12). Todo fallo en los dos pasos centrales produce 2/0x0201 tras el retardo uniforme.
- `auth_type`-prefijo inconsistente es error de formato (1/0x0106), no de autenticación.
- Si el plano de control no está accesible y un `cap_`/`cgt_`/`cgs_` no está en caché → 6/0x0602 (falla cerrada); un `cgc_` se valida sin plano de control (solo `jti` repetido requiere memoria local).

## 12. Autorización por conexión y lista de IP

Cada conexión se autoriza individualmente (no hay sesión de usuario persistente):
1. Resolver `proyecto/servicio` en la tabla de rutas (`gateway_routes`) del gateway; la ruta fija el destino (`dest_host:dest_port`). **El cliente nunca fija host ni puerto de destino.**
2. Permiso: el principal del token tiene `project:connect` (o `cgt_` + servicio `git`) sobre el proyecto; el acceso `gateway` del servicio está habilitado.
3. **Lista de IP del proyecto**: la IP de origen de la conexión TCP (`RemoteAddr` del gateway; nunca una cabecera ni un TLV del cliente) se compara con las CIDR del proyecto. Solo se evalúa **después** del paso 2 (§15.3). Si la lista del proyecto no existe o contiene `any` explícito, no restringe; **una lista vacía explícita deniega todo**.
4. Cuotas (§9.3). 5. Conectar al destino. 6. `CAPR`.

### 12.1 Reglas de la lista de IP (IPv4 e IPv6)
- Entradas en notación CIDR; IPv4 `a.b.c.d/0..32`, IPv6 `x:x::/0..128` (la política de Capsule limita los prefijos amplios, no el protocolo; PLAN §7).
- **Canonicalización de la IP de origen**: se analiza en forma textual o binaria; una dirección IPv4 mapeada en IPv6 (`::ffff:a.b.c.d`) se **convierte a IPv4** antes de comparar. No se acepta identificador de zona (`%eth0`).
- Comparación **por familia**: una IP IPv4 solo coincide con entradas IPv4; una IPv6 solo con entradas IPv6 (la regla IPv4 `0.0.0.0/0` NO cubre a un cliente IPv6; la regla `::ffff:0:0/96` no se considera: ya se canonicalizó).
- IPv6 comparado por prefijo de bits, sin importar la forma de escritura (`2001:db8::1` = `2001:0db8:0:0:0:0:0:1`).
- La IP registrada en auditoría es la canónica.
- Vectores: `ip_allowlist.json`.

## 13. Auditoría

El gateway DEBE registrar **un evento por conexión** (`gateway_conn_events`, PLAN §5.1) para **todo** resultado, también los rechazados antes de autenticar, **sin contenido de datos y sin tokens**:

| campo | contenido |
|---|---|
| `ts` | inicio (UTC, ms) |
| `src_ip` | IP canónica del cliente (IPv4/IPv6) |
| `sni` | SNI recibido |
| `route_id`, `project_id` | si se resolvió; si no, nulos (no se infiere del encabezado) |
| `principal` | id del usuario/token (**nunca** el token; para `cgc_` el `jti` y `sub`) |
| `auth_type` | 1..4 o nulo |
| `transport`, `session_id` | |
| `result` | `status` y `code` enviados |
| `client_id` | TLV 0x02 si existe |
| `bytes_in`, `bytes_out`, `duration_ms` | al cerrar |
| `close_reason` | `normal`, `idle`, `peer_reset`, `drain`, `error` |

El `project`/`service` pedidos por un cliente **no autenticado** se registran solo como hash truncado (para investigar enumeración sin guardar texto arbitrario). Retención 90 días. Los intentos fallidos alimentan el limitador por IP (§15.5). Cambios de configuración (exponer, cerrar, asignar puerto) se auditan en el registro de auditoría existente.

## 14. Evolución, negociación de versión y compatibilidad

1. **Dos niveles.** (a) *Generación del protocolo*: ALPN `capsule/N` y el byte `version` = N (hoy 1). Un cambio de generación puede cambiar por completo el formato tras la `magic`. (b) *Extensiones dentro de la generación*: TLV nuevas (§5, §6), bits de `flags` reservados, nuevos `transport`, nuevos `code`. Estas NO cambian `version`.
2. **Negociación primaria por ALPN.** El cliente ofrece todos los ALPN `capsule/N` que soporta, del mayor al menor; TLS elige. El `version` del encabezado DEBE ser igual al N del ALPN elegido. Esto evita bajadas no autenticadas: la elección ocurre dentro del handshake TLS, protegido por Finished.
3. **Respaldo en banda.** Si llega `version` mayor que el soporte del gateway (o menor que su mínimo): `CAPR{version=<máx. soportada>, status=1, code=0x0101, TLV 0x01=<máx.>}` y cierre. El cliente PUEDE reabrir **una vez** con `min(su máx., máx. del gateway)` si ≥ su `min_version` configurado; **jamás** baja de su `min_version` ni reintenta más de una vez (sin bucles). Un cliente DEBE validar que la versión rebajada la había configurado como aceptable.
4. **Compatibilidad hacia atrás.** El gateway soporta N y N−1 durante 6 meses desde el lanzamiento de N+1 (PLAN §10). `hdr_len` y la `magic`/`version` en posiciones fijas permiten a un gateway nuevo detectar y rechazar con claridad a un cliente viejo.
5. **Reglas de extensibilidad dentro de v1:** el cliente puede enviar TLV `0x81..0xFF` que un gateway antiguo ignora; las TLV `0x03..0x7F` desconocidas son error, de modo que solo se usan cuando el cliente ha confirmado capacidad (fuera de banda o por `CAPR` previo). Los TLV de respuesta desconocidos siempre se ignoran. `flags` reservados deben ser 0 en v1; un bit nuevo exige subir la generación **o** anunciarlo por una TLV `0x81+` de petición.
6. Los `code` nuevos de un `status` ya conocido se aceptan: el cliente actúa por `status` si no conoce el `code`.
7. Congelación: el protocolo v1 se declara estable cuando la matriz de interoperabilidad (PLAN §10) esté en verde; los vectores se versionan con el protocolo.

## 15. Seguridad

### 15.1 Downgrade
- TLS ≥ 1.3 obligatorio; ALPN obligatorio en ambos extremos (§4). Un atacante en la red no puede forzar una versión inferior de TLS ni cambiar la ALPN (Finished autentica el handshake).
- El respaldo en banda (§14.3) solo baja a versiones que el cliente ya consideró aceptables, una vez.
- No hay modo sin TLS: el puerto 443 de entrada rechaza texto claro (cierra) y `capsule/1` no define variante en claro.

### 15.2 Replay
- Todo el encabezado va dentro de TLS 1.3 sin 0-RTT: un atacante externo no puede reproducirlo.
- `cgc_` es de un solo uso (`jti`) y ≤ 300 s; `nonce` (TLV 0x01) es de refuerzo: un gateway con caché puede rechazar repeticiones (0x0203). Un cliente DEBE generar un `nonce` nuevo por cada intento.
- Un `cap_`/`cgt_`/`cgs_` robado es reutilizable por naturaleza: se mitiga con alcance, expiración, revocación (30 s), lista de IP y límites de intentos; para cargas sensibles el cliente DEBERÍA preferir `cgc_`.

### 15.3 Enumeración de proyectos y servicios (respuesta uniforme)
- "No existe" y "no autorizado" producen **idéntica** respuesta: bytes de `CAPR` (`status 2`, `0x0201`, `msg` `not authorized`, sin TLV), **mismo retardo** (`T_UNIF` medido desde el fin del encabezado: la respuesta se emite en `t0 + T_UNIF`, con la ruta rápida en un plazo ≤ `T_UNIF` obligatoriamente; si el cómputo excede `T_UNIF`, se responde en cuanto termine, y el operador DEBE dimensionar para que sea raro) y mismo cierre.
- El trabajo de verificación se hace **siempre completo** (hash del token y búsqueda de ruta aunque el token ya sea inválido) para no filtrar por tiempo.
- El estado 3 (IP) y los demás solo aparecen para quien ya acreditó permiso sobre ese servicio. Un token válido sin permiso sobre otro proyecto obtiene 2/0x0201, igual que si no existiera.
- El comodín DNS responde igual para cualquier nombre; SNI desconocido: cierre sin certificado (PLAN §8).
- El `msg` no incluye el nombre del proyecto ni del servicio.

### 15.4 Tamaños y DoS
- Encabezado ≤ 1024 B, lectura ≤ 5 s (anti slowloris); búfer optimista ≤ 64 KiB; el gateway no reserva memoria proporcional a campos declarados antes de validar (`hdr_len` ya está acotado).
- Límites por IP y por proyecto (§9.3), tasa de conexiones nuevas, límite de sesiones UDP, descarte con contador en las colas UDP.
- Limitador anterior a TLS: se aplica al aceptar el TCP (conexiones concurrentes sin autenticar por IP, def. 100).
- El gateway no crea trabajo caro (consultas a la base) antes de validar formato; el caché de 30 s limita la carga en el plano de control; los fallos no se cachean más de 5 s.
- Un DoS volumétrico no se contiene en el host (PLAN §8).

### 15.5 Fuerza bruta
10 intentos con estado 2 por IP y minuto → bloqueo temporal de 5 min (se cierra con `status 5 / 0x0503`; **el bloqueo no distingue** si el token existía). Los tokens tienen ≥ 256 bits.

### 15.6 Otros
- El destino lo fija la ruta; no hay forma de que el cliente indique `host:puerto` (SSRF).
- `msg` y logs: sin tokens, sin datos de otros proyectos.
- Información visible al gateway: con transport 1/2 el gateway ve los bytes en claro (termina TLS); el cliente cifra dentro del túnel para servicios sensibles (§4).
- Prueba obligatoria de multi-tenencia: token del proyecto A pidiendo `B/db` → 2/0x0201 (idéntico a "no existe").

## 16. Apéndice A: conformidad

Una implementación es conforme con `capsule/1` si:

**Cliente (A1–A10)**
- A1 Analiza URI según §2 y rechaza los casos de `uri.json` con los nombres de error normativos (o sus equivalentes tipados).
- A2 Construye `CAP1` byte a byte idéntico a los vectores canónicos de `request.json` (campos `canonical: true`).
- A3 Decodifica `CAPR` según `response.json` (incluyendo ignorar TLV desconocidas y rechazar las mal formadas).
- A4 TLS ≥ 1.3, ALPN `capsule/1`, validación de certificado y SNI (§4); no envía datos de aplicación antes del handshake.
- A5 Nonce nuevo por intento; no repite TLV 0x01/0x02.
- A6 Clasifica los errores según §7 (tipados) y solo reintenta los reintentables, con el retroceso indicado.
- A7 Half-close según §9.1; no confunde cierre TCP sin `close_notify` con fin limpio.
- A8 Transport 2: trama len16 de §10.3 (`udp_frames.json`), keepalive cada `idle_timeout/3`.
- A9 Happy Eyeballs y `family`.
- A10 Nunca coloca el token fuera de `auth`; nunca lo registra.

**Gateway (B1–B10)**
- B1 Decodifica con los pasos de §5 y devuelve exactamente `status`/`code` de `request.json`; los bytes tras `hdr_len` no se reenvían antes de autorizar.
- B2 Codifica `CAPR` válida (§6) para cada `status`.
- B3 Respuesta uniforme de estado 2 con retardo `T_UNIF` (§15.3), verificado por prueba temporal.
- B4 Orden de comprobación de §11.3/§12 (el estado 3 solo tras autorizar).
- B5 Lista de IP por familia con canonicalización de IPv4 mapeada (`ip_allowlist.json`).
- B6 Plazos y límites de §9.3; ningún `hdr_len` > 1024.
- B7 Half-close hacia el destino (FIN) y de vuelta.
- B8 Un socket UDP por sesión con puerto estable, inactividad y keepalive (§10).
- B9 Auditoría por conexión sin tokens (§13).
- B10 Rechaza TLS ≤ 1.2, 0-RTT y ALPN distinto.

**Interoperabilidad (CI)**: {cliente Go, cliente JS} × {gateway Go de referencia} × {transport 1, 2} × {IPv4, IPv6}: eco, y un caso por cada `status` y por cada `code` de §7. Además fuzz del decodificador del gateway: ninguna entrada puede provocar pánico ni asignar más de `hdr_len` bytes, y el resultado ∈ {incompleto, ok, error de la tabla}.

## 17. Cambios respecto al plan

Esta especificación manda sobre `PLAN.md`. Se aplicaron estas correcciones en el PLAN (§5.3, §10):

| # | PLAN decía | Esta especificación | Motivo |
|---|---|---|---|
| 1 | ALPN `capsule/1` y TLS ≥1.2 | TLS **≥1.3** | el half-close (§9.1) depende de la semántica de TLS 1.3; 0-RTT prohibido |
| 2 | Encabezado sin campo de transporte; `bit1..7` reservados | Campo `transport` (u8) en el offset 8 (1 tcp, 2 udp sobre flujo, 3 QUIC futuro) | el mismo punto de entrada TCP sirve el respaldo UDP; el host `tcp.`/`udp.` es solo etiqueta |
| 3 | `auth_type` 1-3 | 4 = token de servicio `cgs_` | tokens de agentes/CI con alcance de proyecto |
| 4 | `hdr_len` ≤ 1024, `auth_len` ≤ 512 | además `auth_len` ≥ 8, nombres sin guion inicial/final, `hdr_len` ≥ 17 | fija decodificación determinista |
| 5 | TLV `0x01` nonce, `0x02` id, ≥0x80 ignorar, otros error | igual, más `0x80` = relleno normativo; `client_id` limitado a `[A-Za-z0-9._/+-]{1,64}`; duplicados de 0x01/0x02 son error | |
| 6 | Respuesta `CAPR`: magic, version, status, code, msg_len, msg | se añade `ext_len` (u16) + TLV de respuesta tras `msg` (max_version, retry_after, session_id, client_addr, max_datagram, idle_timeout) | transportar versión máxima, `retry_after` y la sesión UDP sin abusar de `msg` |
| 7 | status 0-5 | se añade status 6 (GatewayBusy: drenado, plano de control, interno) y tabla de `code` por status | clasificar reintentables |
| 8 | `capsule/1`: "mismo encabezado sobre TCP/TLS con trama len16" para UDP; "datagrama QUIC = varint session_id" | transport 2 normativo (len16, 1..2048, `len=0` keepalive); QUIC futuro con `session_id` de 8 B fijo (no varint) | simplicidad y datos reservados |
| 9 | `jti` repetido se rechaza | además nonce repetido PUEDE rechazarse (0x0203); expirado usa 0x0202 solo con firma válida | no revela existencia |
| 10 | `cgt_` mencionado también para el agente de salida (PLAN §4.5: "token `cgt_` de servicio") | el token de servicio es `cgs_`; `cgt_` queda para git | `cgt_` es el token git (PLAN §5.2) |
| 11 | La resolución consulta `GET /gateway/resolve?uri=` | el protocolo **no** exige la API: el URI + zona bastan para conectar; `resolve` solo sirve para optimizar (usar nombre SNI) | la conexión funciona si la API cae |
| 12 | El prototipo usa ALPN `capsule-tunnel/1` y una línea de texto `…\n` como encabezado | superado: el prototipo (`spikes/cmd/gw`, `spikes/cmd/ct`) debe migrar a `capsule/1` + `CAP1` binario en el paquete G3; el prototipo queda como referencia histórica | la especificación es la binaria |

Los cambios 1-3, 6-8 y 10 se reflejaron como notas en `PLAN.md` §5.3 y §10 (apuntan a este documento). Nada más del PLAN cambió.

## Apéndice B: ejemplo completo (hex)

Solicitud (`req_valid_nonce_clientid`: `cap_` + 43 × `A`; nonce `000102…0f`; `client_id` `capsule-go/0.1.0`), 110 bytes:

```
43415031 01 00 006e 01 0b 6d692d70726f7965 63746f 02 6462 01 002f
 magic   v  fl hdrl  tr pl  "mi-proyecto"        sl "db" at alen
6361705f41...41 (47 B: "cap_" + 43 "A")
01 10 000102030405060708090a0b0c0d0e0f   TLV nonce (16 B)
02 10 63617073756c652d676f2f302e312e30   TLV client_id "capsule-go/0.1.0"
```
(Archivo: `testvectors/hex/req_valid_nonce_clientid.hex`.)

Respuesta OK de sesión UDP (`resp_ok_udp_session_ipv4`):
```
43415052 01 00 0000 02 6f6b 001b | 03 08 1122334455667788 | 04 07 04 c000020a c822 | 05 02 05c0 | 06 02 003c
 CAPR   ver st  code ml "ok" ext_len  session_id           client_addr 192.0.2.10:51234  max_dg 1472  idle 60
```
Rechazo uniforme (`resp_status2_uniform`): `4341505201020201 0e 6e6f7420617574686f72697a6564 0000`.

## Apéndice C: referencias
RFC 2119, RFC 3986 (URI), RFC 5234 (ABNF), RFC 5952 (IPv6 textual), RFC 6125 (identidad en certificados), RFC 6066 (SNI), RFC 7301 (ALPN), RFC 7519/8037 (JWT/EdDSA), RFC 8305 (Happy Eyeballs), RFC 8446 (TLS 1.3), RFC 9000/9221 (QUIC y datagramas, solo FUTURO).
