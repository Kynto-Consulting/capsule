# Vectores de prueba de `capsule/1`

Acompañan a `docs/gateway/PROTOCOL.md`. Toda implementación (cliente Go, cliente JS/TS, gateway) DEBE reproducirlos.

## Contenido

| Archivo | Qué prueba | Sección del protocolo |
|---|---|---|
| `request.json` | Decodificar (y, si `canonical`, codificar) el encabezado `CAP1`: válidos, límites (nombres de 63, token de 8 y 512, encabezado de 1024), inválidos por cada código `0x0101..0x010B`, versiones desconocidas, truncados, datos tras el encabezado | §5 |
| `response.json` | Decodificar/codificar `CAPR`: cada status, TLV de respuesta (incluida dirección IPv6), TLV desconocidas, errores de formato, truncados | §6, §7 |
| `uri.json` | Analizar `capsule://…`: válidos (IPv6 en `gateway`, zona, UDP) e inválidos con el nombre de error normativo. Zona por defecto de los vectores: `apps.tumi-ai.com` | §2 |
| `udp_frames.json` | Trama `len16` de UDP sobre flujo: datagramas, keepalive (`len=0`), parciales, tope 2048 | §10 |
| `ip_allowlist.json` | Lista de IP por familia: IPv4, IPv6, IPv4 mapeada, lista vacía | §12 |
| `hex/*.hex`, `bin/*.bin` | Cada vector de `request.json` (`req_*`) y `response.json` (`resp_*`) como hex en una línea y como binario | — |
| `verify/` | Codificador/decodificador de referencia en Python (solo biblioteca estándar), generador y verificador | — |

## Formato de un vector de solicitud/respuesta

```
{ "name": ..., "desc": ..., "hex": "<bytes del flujo>", "eof": true|false,
  "canonical": true,            // opcional: codificar los campos debe dar EXACTAMENTE este hex
  "expect": ... }
```
- `eof`: `true` = el flujo terminó tras esos bytes; `false` = sigue abierto (faltan datos).
- `expect` puede ser:
  - `{"incomplete": true}`: el decodificador debe pedir más bytes (solo con `eof:false`).
  - `{"ok": true, "consumed": N, "fields": {...}}`: decodificación correcta; `consumed` = bytes del encabezado (lo que sigue son datos de aplicación y NO se consume). Campos de solicitud: `transport`, `flags`, `project`, `service`, `auth_type`, `auth`, `ignored_tlvs` (cantidad de TLV >=0x80 ignoradas) y, si existen, `nonce_hex`, `client_id`. Campos de respuesta: `version`, `status`, `code`, `msg`, `tlvs` (`max_version`, `retry_after`, `session_id_hex`, `client_addr {ip, port}`, `max_datagram`, `idle_timeout`).
  - Solicitud inválida: `{"ok": false, "status": 1, "code": "0x0105"}` (el decodificador del gateway debe producir exactamente ese `status` y `code`).
  - Respuesta inválida: `{"ok": false, "error": "<nombre>"}` con los nombres `truncated`, `bad_magic`, `bad_version`, `msg_too_long`, `bad_msg`, `ext_too_long`, `bad_ext`. (Un decodificador de cliente puede usar su propio tipo de error; basta con una asignación 1 a 1 con estos nombres en la prueba.)
- Los campos con `canonical: true` también prueban el **codificador**: con los `fields` (más `nonce_hex`/`client_id`/`padding` si aplica) debe generar el mismo hex. Los vectores sin `canonical` (relleno, TLV ignoradas, datos tras el encabezado) son solo de decodificación.
- Los vectores `ok` deben seguir dando el mismo resultado si se agregan bytes arbitrarios al final (envío optimista).

### `uri.json`
`{"uri", "default_zone", "expect": {"ok": true, "fields": {project, service, transport, family, connect_host, connect_port, sni}} | {"ok": false, "error": "<nombre>"}}`. Los IPv6 literales salen en forma canónica comprimida, sin corchetes.

### `udp_frames.json`
`hex` es el flujo recibido; `expect` = `{"datagrams": [hex...], "keepalives": n, "pending": bytes_sin_completar}` o `{"error": "frame_too_large"}`.

### `ip_allowlist.json`
`{"cidrs": [...], "ip": "...", "allowed": bool}`.

## Cómo usarlos desde otra implementación

1. Cargar el JSON y, por cada vector, pasar `hex` (decodificado a bytes) al decodificador, con el indicador de fin de flujo `eof`.
2. Comparar con `expect` (campos, `consumed`, o `status`/`code`).
3. Para `canonical`, codificar `fields` y comparar los bytes.
4. Un buen arnés en Go: `testing` con `//go:embed`; en JS: `node:test` leyendo los mismos archivos. Ambos DEBEN ejecutar todos los archivos.
5. Fuzz: tomar los vectores válidos como semilla (`go test -fuzz`, `fast-check`); invariantes: sin pánico, sin asignar más de `hdr_len` bytes, resultado ∈ {incompleto, ok, error de tabla}.

## Verificador de referencia

```
python -I docs/gateway/testvectors/verify/verify.py        # comprueba todo: debe imprimir "... 0 fallos"
python -I docs/gateway/testvectors/verify/gen_vectors.py   # regenera JSON, hex y bin
```
`gen_vectors.py` construye los bytes a mano (sin usar `codec.py`) y `verify.py` los decodifica/codifica con `codec.py`: son dos caminos independientes que deben coincidir. Si se cambia la especificación: actualizar `gen_vectors.py`, `codec.py`, regenerar, ejecutar el verificador y commitear los tres juntos. Los tokens que aparecen (`cap_AAAA…`, etc.) son cadenas de prueba sin validez.

Qué NO cubren los vectores (se prueba con integración): TLS y ALPN, el retardo uniforme de estado 2 (`T_UNIF`), plazos, half-close, límites de conexiones, la validación criptográfica de `cgc_`, auditoría y UDP real.
