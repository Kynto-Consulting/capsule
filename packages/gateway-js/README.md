# @kyntocg/capsule-gateway

Cliente JavaScript/TypeScript del gateway de Capsule (protocolo `capsule/1`). Sin dependencias de runtime, ESM + CJS, Node >= 20.

Abre un túnel TCP (o una sesión UDP sobre flujo) a un servicio de un proyecto con un URI `capsule://<proyecto>/<servicio>`, de modo que cualquier cliente de base de datos pueda conectar a `127.0.0.1:<puerto>`.

La especificación normativa es `docs/gateway/PROTOCOL.md` del repositorio de Capsule; los vectores de prueba están en `docs/gateway/testvectors/`.

```
npm i @kyntocg/capsule-gateway
```

## Uso rápido

### Túnel local para cualquier cliente

```js
import { listen } from "@kyntocg/capsule-gateway";

const tunnel = await listen("capsule://mi-proyecto/db", { token: process.env.CAPSULE_TOKEN });
console.log(`psql -h ${tunnel.host} -p ${tunnel.port}`);
// ...
await tunnel.close();
```

`listen` solo enlaza direcciones de bucle local (`127.0.0.1` por defecto): el puerto reenvía con las credenciales de su proceso. Para enlazar otra interfaz hay que pasar `allowNonLoopback: true`.

### Conexión directa

```js
import { connect } from "@kyntocg/capsule-gateway";

const sock = await connect("capsule://mi-proyecto/db", { token: "cgs_..." });
sock.write("hola");
sock.end();                       // half-close: close_notify; se sigue pudiendo leer
for await (const chunk of sock) process.stdout.write(chunk);
```

`connect` devuelve un `tls.TLSSocket` (un `Duplex`) con los bytes del destino ya transparentes, y la respuesta del gateway en `sock.capsule`.

### PostgreSQL, Redis, MySQL

```js
import { Client } from "pg";
import { postgresConnectionOptions } from "@kyntocg/capsule-gateway";

const conn = await postgresConnectionOptions("capsule://mi-proyecto/db", { user: "app", password: "...", database: "app" });
const client = new Client({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: conn.database });
await client.connect();
// ...
await client.end();
await conn.close();
```

`conn.connectionString` entrega `postgres://usuario:clave@127.0.0.1:puerto/base` (usuario y clave codificados). Para Redis, MySQL u otros TCP use `openLocal(uri)` (devuelve `{ host, port, close }`). Ver `examples/` (`pg.mjs`, `ioredis.mjs`, `mysql2.mjs`, `tunnel.mjs`, `connect.cjs`); `pg`, `ioredis` y `mysql2` no son dependencias de esta librería. Si el servicio habla TLS propio (PostgreSQL), actívelo en el cliente: viaja dentro del túnel y el gateway no ve el contenido.

### UDP sobre flujo (transport 2)

```js
import { connectUdp } from "@kyntocg/capsule-gateway";

const udp = await connectUdp("capsule://mi-proyecto/minecraft?transport=udp");
udp.on("message", (datagrama) => { /* ... */ });
udp.send(Buffer.from("ping"));    // keepalive automático cada idle_timeout/3
udp.close();
```

Una conexión es una sesión UDP (un 5-tuple hacia el destino). Es el respaldo universal: hay bloqueo de cabeza de línea y la latencia es mayor que UDP nativo (PROTOCOL.md §10.5).

## URI `capsule://`

`capsule://<proyecto>/<servicio>[?parámetros]`. Reglas estrictas (PROTOCOL.md §2): proyecto y servicio son `[a-z0-9-]{1,63}` sin guion al inicio ni al final, en minúsculas (no se normalizan mayúsculas); sin usuario, puerto, fragmento ni barra final. **El token nunca va en el URI.**

| parámetro | valores | significado |
|---|---|---|
| `transport` | `tcp` (def.), `udp` | etiqueta del host (`tcp.<zona>`/`udp.<zona>`) y campo `transport` |
| `family` | `4`, `6`, `any` (def.) | restringe las familias IP usadas al conectar |
| `zone` | dnsname con >= 2 etiquetas | zona del gateway (def.: `CAPSULE_GATEWAY_ZONE` o `apps.tumi-ai.com`) |
| `gateway` | `host[:puerto]`, IPv6 como `%5B2001:db8::1%5D:8443` | punto de entrada explícito; excluyente con `zone` |
| `sni` | dnsname | nombre para SNI y validación del certificado; obligatorio si `gateway` es una IP |
| `x-*` | cualquiera | se ignoran |

```ts
import { parseUri, formatUri } from "@kyntocg/capsule-gateway";

parseUri("capsule://mi-proyecto/db");
// { project: "mi-proyecto", service: "db", transport: "tcp", family: "any",
//   connectHost: "tcp.apps.tumi-ai.com", connectPort: 443, sni: "tcp.apps.tumi-ai.com" }
formatUri({ project: "p", service: "s", transport: "udp" }); // "capsule://p/s?transport=udp"
```

`parseUri` lanza `UriError` con `reason` = nombre normativo (`bad_scheme`, `fragment`, `userinfo`, `port`, `bad_project`, `bad_path`, `bad_service`, `bad_param`, `dup_param`, `unknown_param`, `bad_escape`, `bad_gateway`, `sni_required`).

## Opciones de `connect` / `listen` / `connectUdp`

| opción | por defecto | descripción |
|---|---|---|
| `token` | `CAPSULE_TOKEN` | cadena (`cap_`, `cgt_`, `cgc_`, `cgs_`) o función (sincrónica o asíncrona) que la entrega; con función, un `cgc_` expirado se renueva una vez |
| `defaultZone` | `CAPSULE_GATEWAY_ZONE` / `apps.tumi-ai.com` | zona cuando el URI no la indica |
| `tlsOptions` | — | p. ej. `{ ca }` para despliegues privados. Se ignoran `servername`, `ALPNProtocols`, `minVersion`, etc.; `rejectUnauthorized:false` se rechaza |
| `signal` | — | `AbortSignal`: cancela intentos y esperas y destruye el socket (también después de conectar) |
| `connectTimeoutMs` / `handshakeTimeoutMs` / `responseTimeoutMs` | 10000 / 10000 / 20000 | plazos de TCP, handshake TLS y espera de `CAPR` |
| `retry` | 5 intentos, 500 ms x2, tope 30 s, jitter 20 % | reintentos de errores reintentables; `false` los desactiva; respeta `retry_after` |
| `clientId` | `capsule-js/0.1.0` | TLV informativo (`false` lo omite) |
| `wantProxyInfo` | `false` | pide la dirección de origen que ve el gateway (`sock.capsule.tlvs.clientAddr`) |
| `padding` | — | relleno TLV 0x80 para ocultar la longitud del token |
| `lookup` | `dns.lookup` | resolvedor propio |
| `insecureSkipVerifyForTest` | `false` | SOLO PRUEBAS: se rechaza si el host no es `localhost`, bucle local o `.test`/`.localhost` |

Seguridad: TLS 1.3 obligatorio, ALPN `capsule/1` obligatorio, certificado y nombre verificados siempre (PROTOCOL.md §4), sin 0-RTT, nonce nuevo por intento, el token solo viaja en el campo `auth` del encabezado y nunca se registra ni aparece en mensajes de error. La librería no escribe en consola.

Resolución: el cliente conecta por nombre y usa Happy Eyeballs de Node (`autoSelectFamily`, 250 ms entre familias) respetando `family`.

## Errores tipados

Todos extienden `CapsuleError` (`kind`, `retryable`, `status`, `code`, `retryAfter`). Reintentable = la librería reintenta sola con retroceso exponencial (PROTOCOL.md §7).

| clase | cuándo | reintentable |
|---|---|---|
| `UriError` | URI mal formado (`reason`) | no |
| `ConfigError` | token ausente/con prefijo desconocido, opciones inseguras, uso incorrecto | no |
| `AbortedError` | cancelado con `AbortSignal` | no |
| `TlsError` | certificado/nombre no válido, TLS < 1.3, ALPN no negociado | no |
| `Unavailable` | 4/0x0401-0x0402; sin conexión TCP, gateway cerró sin responder, plazo de `CAPR` agotado | sí |
| `QuotaExceeded` | 5/0x0501-0x0504 (`retryAfter`) | sí |
| `GatewayBusy` | 6/0x0601-0x0603 (drenado, plano de control, interno) | sí |
| `NotAuthorized` | 2/0x0201 (respuesta uniforme), 0x0203 (reproducción) | no |
| `TokenExpired` | 2/0x0202 (`cgc_` expirado) | no (se renueva si `token` es función) |
| `IpDenied` | 3/0x0301 | no |
| `UnsupportedVersion` | 1/0x0101 (`maxVersion`) | no |
| `UnsupportedTransport` | 1/0x0109 | no |
| `BadRequest` | 1/0x0102-0x0108, 0x010A, 0x010B | no (0x010A, una vez) |
| `ProtocolError` | `CAPR` inválido o truncado (`reason`: `truncated`, `bad_magic`, ...), trama UDP > 2048 | una vez |
| `UnknownStatus` | `status` no definido | no |

Un `code` desconocido de un `status` conocido se trata según el `status`.

## Cierre y half-close

`socket.end()` envía `close_notify` (half-close) y el socket sigue pudiendo leerse hasta que el destino cierre; el gateway lo traduce en FIN hacia el destino. En el servidor-túnel local, el fin de escritura del cliente local y el FIN del destino se propagan en cada sentido.

Limitación de Node: `TLSSocket` no expone si el otro extremo envió `close_notify`; un TCP cerrado sin `close_notify` llega como fin de flujo normal. El truncamiento debe detectarlo el protocolo de aplicación (los de bases de datos lo hacen con su propio encuadre). La librería sí detecta respuestas `CAPR` truncadas (`ProtocolError`/`Unavailable`).

## Navegador

Un navegador no puede abrir TCP crudo ni negociar ALPN `capsule/1`, y PROTOCOL.md no define un transporte WebSocket (solo PLAN.md §10 lo menciona, sin endpoint ni formato). Por eso `@kyntocg/capsule-gateway/browser` exporta solo las piezas puras (URI, códec CAP1/CAPR, tramas UDP, errores), la interfaz `BrowserTransport` para un transporte futuro, y `connect()` lanza `UnsupportedEnvironment`. Use Node.js o el CLI (`capsule tunnel`).

## API de bajo nivel

`encodeRequest` / `decodeRequest(bytes, eof)` (CAP1), `encodeResponse` / `decodeResponse(bytes, eof)` (CAPR), `encodeFrame` / `encodeKeepalive` / `FrameDecoder` (UDP len16), `ipAllowed(cidrs, ip)` (lista de IP por familia, PROTOCOL.md §12.1). Los decodificadores no lanzan excepciones: devuelven `incomplete`, `ok` o el error de la tabla.

## Desarrollo

```
npm ci
npm run typecheck
npm test        # vectores, integración contra un servidor-túnel en memoria con TLS autofirmado, fuzz
npm run build   # dist/ (ESM + CJS + .d.ts)
```

Las pruebas leen los vectores de `../../docs/gateway/testvectors` (o de `CAPSULE_TESTVECTORS`). Los certificados de `test/fixtures` son autofirmados y solo sirven para pruebas.
