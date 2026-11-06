# IA multimodal (`capsule ai`)

Fuente: `docs/AI_MULTIMODAL.md`. Todos los comandos de abajo se comprobaron con `capsule ai --help` y `capsule ai <sub> --help` del CLI compilado
desde el código actual. Trabajan sobre un proyecto: `--org` y `--project`, o el directorio enlazado (`capsule link`). Cada comando acepta `--json`;
el resultado va por stdout y el costo estimado por stderr.

```bash
capsule ai models [--capability stt|tts|image|embed|rerank|chat|vision|speech-to-speech|video] [--available]   # catálogo vivo, con motivo si no hay acceso
capsule ai chat "¿qué hay en la foto?" --image foto.jpg [--stream]      # también --video, --document, --audio (se transcribe primero)
capsule ai transcribe reunion.mp3 --diarize --lang es-US -o reunion.srt # .txt .srt .vtt .json; --source bucket/key; --save-to bucket/; --no-wait
capsule ai jobs <id> --wait -o reunion.vtt                              # estado de un trabajo largo
capsule ai speak "Hola" --voice Lupe -o hola.mp3 ; capsule ai voices --lang es-US
capsule ai image "una manzana roja" --n 2 --size 1024x1024 -o ./out/    # genera
capsule ai image --image foto.png --operation remove-background -o ./recorte/   # edita; inpaint necesita --mask (el blanco de la máscara cambia, el negro se conserva)
capsule ai embed "texto" --json ; capsule ai embed search "factura de luz" --bucket docs --top 3
capsule ai rerank "consulta" --doc "a" --doc "b" [--top 3]
capsule ai talk pregunta.wav -o respuesta.wav                           # voz a voz, un turno por archivo (WAV PCM16 mono)
capsule ai talk --live                                                  # en vivo: PCM 16 kHz por stdin, PCM 24 kHz por stdout
capsule ai usage                                                        # gasto estimado de hoy y tope diario
```

`capsule ai` sin subcomando (asistente interactivo), `explain-failure`, `dockerfile`, `optimize-costs` y `keys` no cambiaron.

## Qué modelo usa cada cosa

- Voz a texto: Amazon Transcribe (`transcribe`). **Voxtral no sirve para audio en Bedrock** (lo rechaza): no lo propongas.
- Texto a voz: Polly (`polly-neural` por defecto, `polly-generative`, `polly-standard`). Voz por defecto según `--lang` (es-US: Lupe).
- Voz a voz: Nova Sonic (`nova-2-sonic`, `nova-2-5-sonic`); el CLI no abre el micrófono: con `--live` usa tuberías (ejemplo en `docs/AI_MULTIMODAL.md`).
- Imágenes: sin `--image`, `stability-image-control-sketch` genera desde el texto (no hay un modelo de texto a imagen dedicado). Con `--image`,
  `--operation` elige el servicio Stability: `inpaint`, `erase-object`, `remove-background`, `search-replace` (`--search-prompt`), `search-recolor`
  (`--select-prompt`), `outpaint`, `style-transfer` (`--style-image`), `style-guide`, `fast-upscale`, `conservative-upscale`, `creative-upscale`.
- Embeddings: `titan-embed-v2` por defecto; `nova-embed`, `cohere-embed-v4`, `marengo-embed-3` (texto e imagen). Rerank: `cohere-rerank-3-5`.
- Chat, visión, video: `nova-2-lite` por defecto; con `--image`/`--video` solo salen modelos que ven.
- Con un modelo no disponible la respuesta dice por qué (`capsule ai models --available` lista los que sí funcionan).

## Reglas

- Los archivos de entrada y salida pueden vivir en el almacén de objetos del proyecto: `--source bucket/key`, `--save-to bucket/prefijo/`
  (`references/almacenamiento-objetos.md`).
- Cada llamada cuesta dinero. Usa entradas pequeñas al probar, mira el costo en stderr y `capsule ai usage`. El tope diario por proyecto
  (por defecto 5 USD) se agota con exit 5 y el código `QUOTA_EXCEEDED`: no lo evites, avisa al usuario.
- Exit 5 también es `MODEL_UNAVAILABLE`, `NO_MODEL` o `MODEL_ACCESS`: el modelo no se puede usar en la cuenta; no insistas, corre `capsule ai models`.
- Quién puede qué: leer (chat, embed, rerank, jobs, usage) pide `project:read`; lo que produce archivos (transcribe, speak, voices, image, talk) pide
  `storage:presign`. Un 403 `FORBIDDEN` es de rol, no del modelo.
- Cada llamada queda en la auditoría de la organización (`ai.<capacidad>`) con modelo, tamaños y costo, **sin el contenido**. No pegues audios ni
  prompts sensibles en chats ni logs por tu cuenta.
- La transcripción es asíncrona: `transcribe` espera y escribe el archivo; con `--no-wait` devuelve el id y se retoma con `capsule ai jobs <id> --wait`.

## Usar `capsule ai` por API y con tokens (sin probar con token en producción)

Las rutas son `POST /api/v1/orgs/{org}/projects/{proyecto}/ai/{chat|embeddings|embeddings/search|rerank|transcribe|speech|images|talk}`,
`GET .../ai/{models|voices|usage|jobs/{id}}`. Se autentican con `Authorization: Bearer <token>`: la sesión de `capsule login` o un token `cap_`
(`capsule tokens create --name x --project <id> [--scope ...]`; también en la web, Ajustes). `chat`, `embeddings`, `rerank`, `jobs` y `usage` piden el
permiso `project:read`; `transcribe`, `speech`, `voices`, `images` y `talk` piden `storage:presign`. `talk --live` abre un WebSocket con un ticket
de un solo uso (`POST .../ai/talk/ticket`). Un token con alcance (`--scope`) solo funciona si ese alcance incluye el permiso de la ruta.

## Contrato de la API: cuerpos de entrada y salida

Base: `https://<api>/api/v1`. En los ejemplos `B=/orgs/$ORG/projects/$PROJ/ai` (con `capsule api` el prefijo `/api/v1` ya va puesto; en Git Bash
de Windows exporta `MSYS_NO_PATHCONV=1` o la ruta se reescribe y da `NOT_FOUND`). Con curl: `-H "Authorization: Bearer $TOKEN"`.
Estado de la verificación: **[vivo]** = probado contra producción el 06-nov-2026 con `capsule api` o `capsule ai`; **[sin verificar]** = solo leído del código.

### Cómo se leen las entradas (`parseForm`)

Casi todas las rutas POST aceptan **dos formatos**, según el `Content-Type`:

- `multipart/form-data` (si empieza por eso): cada parte con `filename` es un archivo; las demás son campos de texto (un campo repetido es una lista).
- **Cualquier otro** content-type se lee como **un objeto JSON** (`application/json`). Los strings, números y booleanos son campos; un arreglo de
  strings es una lista (`documents`, `input`); los objetos anidados se ignoran. Booleano = `true`/`1`/`yes` (también como string).
- Los archivos en JSON se pasan como `<campo>_base64` (base64 estándar, puede repetirse como arreglo) o `<campo>_source: "bucket/key"` (o
  `s3://bucket/key`; lee del almacén del proyecto, exige buckets activos). En multipart también valen `_base64` y `_source`.
- Cuerpo mayor que el límite de la ruta: `413 TOO_LARGE`. JSON inválido: `400 INVALID_JSON`; multipart inválido: `400 INVALID_BODY`.
- `save_to: "bucket/key"` (o `bucket/prefijo/`, o solo `bucket`) guarda el resultado en el almacén del proyecto; `inline=false` junto con `save_to`
  omite el base64 de la respuesta.
- Toda respuesta con costo lleva `cost_estimate_usd` (estimación, no factura).

### Errores comunes (todas las rutas)

Forma: `{"error":{"code":"...","message":"..."}}` (el CLI imprime `error CODE: mensaje`).

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `INVALID_ID` / `INVALID_JSON` / `INVALID_BODY` | id de org mal formado, cuerpo ilegible |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | sin token, o el rol/alcance no tiene el permiso de la ruta |
| 403 | `MODEL_ACCESS` | el backend no tiene acceso al modelo en Bedrock (lo habilita un admin de AWS) |
| 404 | `MODEL_NOT_FOUND` | `model` no existe en el catálogo |
| 404 | `NOT_FOUND` | trabajo (`jobs/{id}`) inexistente, vencido o de otro proyecto |
| 404 | `BUCKET_NOT_FOUND` | `bucket`, `*_source` o `save_to` apuntan a un bucket que no es del proyecto |
| 409 | `MODEL_UNAVAILABLE` / `NO_MODEL` | el modelo existe pero la cuenta no puede usarlo (`details.reason`), o no hay ninguno para la capacidad |
| 413 | `TOO_LARGE` | cuerpo o archivo sobre el límite |
| 422 | `VALIDATION_ERROR` / `UNSUPPORTED` | falta un campo, valor inválido, o el modelo no hace esa capacidad |
| 429 | `QUOTA_EXCEEDED` | **tope diario** del proyecto (por defecto 5 USD, día UTC): `details = {used_usd, limit_usd, needed_usd}` |
| 502 / 504 | `UPSTREAM_ERROR` / `TIMEOUT` | falló el proveedor o no contestó a tiempo |
| 503 | `SERVICE_UNAVAILABLE` | IA, transcripción, Polly o caché sin configurar en la plataforma |

Permisos: `project:read` para `chat`, `embeddings`, `embeddings/search`, `rerank`, `jobs/{id}`, `usage`; `storage:presign` para `transcribe`,
`speech`, `voices`, `images`, `talk`, `talk/ticket`. Todo exige token del usuario; solo `GET /ai/models` y el WebSocket son públicos.

### GET /api/v1/ai/models (y alias /api/v1/models) [vivo]

**No está bajo el proyecto** (`.../projects/{p}/ai/models` da 404) y no pide permiso de proyecto. Sin `capability` ni `catalog` devuelve la lista antigua
(la de `capsule ai keys`); con `?capability=<cap>` o `?catalog=1` devuelve el catálogo vivo. Parámetros: `capability`
(`chat|vision|stt|tts|speech-to-speech|image-generate|image-edit|embed|rerank|video`; otro valor es 422) y `available=true`.

```bash
capsule api GET /ai/models -f capability=rerank
```
```json
{"capabilities":[{"id":"rerank","available":true,"models":1}],
 "data":[{"id":"cohere-rerank-3-5","name":"Cohere Rerank 3.5","provider":"Cohere","service":"bedrock","family":"cohere-rerank",
          "bedrock_id":"cohere.rerank-v3-5:0","invoke_id":"cohere.rerank-v3-5:0","capabilities":["rerank"],
          "input_modalities":["TEXT"],"output_modalities":["TEXT"],"price":{"unit":"1k_searches","per":2},
          "available":true,"source":"live","verified":true}],
 "live":true,"region":"us-east-1"}
```
`reason` explica por qué un modelo no está disponible. Ojo: `capsule ai models --json` re-empaqueta la salida como `{"capabilities":[...],"models":[...]}`
(clave `models`, sin `live` ni `region`); la API cruda usa `data`. `capsule ai models` no acepta `--org/--project` (no los necesita).

### GET .../ai/usage [vivo]

```bash
capsule api GET $B/usage
```
`{"day":"2026-11-06","limit_usd":5,"unlimited":false,"used_usd":0.070914}` (`unlimited:true` si el tope es 0).

### POST .../ai/chat (JSON o multipart; 60 MB) [vivo]

| Campo | Tipo | Oblig. | Defecto / límite |
|---|---|---|---|
| `prompt` | string | sí | sin él, 422 `prompt is required` |
| `model` | string | no | `nova-2-lite`, luego `nova-pro`, `claude-sonnet-4.5`; con imagen solo modelos con visión, con video solo con video |
| `system` | string | no | |
| `max_tokens` | int | no | 1024; fuera de 1..8192 vuelve a 1024 |
| `stream` | bool | no | false |
| `image`, `video`, `document` | archivo(s) (`_base64`/`_source` en JSON) | no | imagen 8 MB, video 40 MB, documento 8 MB por archivo |
| `audio` | archivo(s) | no | se transcribe primero (espera hasta ~2 min) y el texto se antepone al prompt; necesita el servicio de transcripción |
| `lang` | string | no | idioma del audio adjunto (`es-US`...) |

```bash
echo '{"prompt":"Responde solo: ok","max_tokens":20}' > c.json
capsule api POST $B/chat --input c.json
# curl: curl -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d @c.json "$API/api/v1$B/chat"
```
```json
{"model":"nova-2-lite","text":"ok","usage":{"input_tokens":51,"output_tokens":2},"cost_estimate_usd":0.0000203}
```
Con `stream=true` la respuesta es `text/event-stream`: eventos `data: {"delta":"..."}` y al final `data: {"done":true,"usage":{...},"cost_estimate_usd":...}`;
un error a mitad llega como `data: {"error":"..."}` con HTTP 200 ya enviado. **Hallazgo en producción (06-nov): con `stream:true` el servidor
contesta `502 UPSTREAM_ERROR: streaming is not supported by this connection`** (también con `capsule ai chat --stream`): el escritor de respuesta
de la cadena de middleware no expone `http.Flusher`. Hasta corregirlo, no uses `--stream`/`stream:true` contra producción.

### POST .../ai/embeddings (JSON o multipart; 40 MB) [vivo]

| Campo | Tipo | Oblig. | Notas |
|---|---|---|---|
| `input` | string o [string] | uno de los tres | textos (en multipart, repite el campo) |
| `text` | string o [string] | | igual que `input`; se concatenan |
| `image` | archivo(s) | | máx. 10 MB c/u; formato por extensión o content-type, `png` por defecto |
| `model` | string | no | `titan-embed-v2`, luego `nova-embed` |
| `dimensions` | int | no | 0 = el del modelo (Titan v2: 256, 512 o 1024) |
| `purpose` | `document`\|`query` | no | |

```bash
echo '{"input":["hola mundo","adios"],"dimensions":256,"purpose":"document"}' > e.json
capsule api POST $B/embeddings --input e.json
```
```json
{"model":"titan-embed-v2","dimensions":256,"vectors":[[0.0123,"..."],["..."]],"usage":{"tokens":7},"cost_estimate_usd":1.4e-7}
```

### POST .../ai/embeddings/search (JSON o multipart; 1 MB) [sin verificar con datos; el error de bucket inexistente sí]

Campos: `query` (obl.), `bucket` (obl.), `prefix`, `top_k` (1..50, defecto 5), `model` (como embeddings). Indexa hasta 100 objetos de texto del bucket
(txt, md, json, csv, html, log, yaml, xml, rst o sin extensión; cada uno de 1 B a 32 KB; el resto cuenta en `skipped`); los vectores (256 dim)
se cachean 7 días por contenido. Sin objetos válidos: 422. Bucket ajeno: 404 `BUCKET_NOT_FOUND` [vivo]. Sin `query` o `bucket`: 422 [vivo].
```bash
echo '{"query":"factura de luz","bucket":"docs","top_k":3}' > se.json && capsule api POST $B/embeddings/search --input se.json
```
```json
{"model":"titan-embed-v2","bucket":"docs","documents":12,"skipped":1,
 "hits":[{"key":"facturas/luz.txt","score":0.71,"snippet":"Recibo de electricidad..."}],"usage":{"tokens":900},"cost_estimate_usd":0.00002}
```
(Respuesta armada a partir del código.)

### POST .../ai/rerank (JSON o multipart; 8 MB) [vivo]

Campos: `query` (obl.), `documents` ([string], obl.), `top_n` (int, 0 = todos), `model` (defecto `cohere-rerank-3-5`). Cobra 2 USD por 1000 búsquedas, una búsqueda por cada 100 documentos.
```bash
echo '{"query":"factura de luz","documents":["recibo de electricidad","receta de pastel","contrato de alquiler"],"top_n":2}' > r.json
capsule api POST $B/rerank --input r.json
```
```json
{"model":"cohere-rerank-3-5","results":[{"index":0,"score":0.4869,"document":"recibo de electricidad"},{"index":2,"score":0.0410,"document":"contrato de alquiler"}],"cost_estimate_usd":0.002}
```
Un modelo sin la capacidad (`nova-2-lite`): 422 `UNSUPPORTED: model nova-2-lite does not do rerank` [vivo].

### POST .../ai/transcribe (multipart o JSON; audio hasta `MaxAudioBytes` + 2 MB) [vivo]

Asíncrona. Campos: `file` (archivo), `file_base64` o `file_source=bucket/key` (obl.; formato por extensión/content-type: mp3, wav, m4a, flac, ogg, webm), `lang` (es-US...; vacío = detectar), `diarize` (bool), `speakers` (int, máx. de hablantes), `save_to` (bucket/prefijo donde dejar el transcrito), `save_format` (`json` por defecto; `txt|srt|vtt`), `model` (`transcribe`, el único). Responde **202**. Sin audio: 422 [vivo].
```bash
curl -H "Authorization: Bearer $T" -F file=@reunion.mp3 -F lang=es-US -F diarize=true "$API/api/v1$B/transcribe"
```
```json
{"job":{"id":"a5758a0c-...","status":"queued","language":"es-US","cost_estimate_usd":0.0002783,"saved_to":"","result":null},"poll":"jobs/a5758a0c-..."}
```

### GET .../ai/jobs/{id}[?format=txt|srt|vtt|json] [vivo]

Estados `queued`, `running`, `completed` o `failed` (con `error`). Con `completed` trae `result` (`text`, `language`, `duration_seconds`, `segments[{start,end,text}]`, más `speaker` si hubo `diarize`).
Con `?format=` y el trabajo terminado devuelve el transcrito renderizado como archivo (content-type del formato); si no ha terminado, devuelve el JSON del estado. `NOT_FOUND` si el id no es de este proyecto.
```json
{"job":{"id":"a5758a0c-...","kind":"transcribe","status":"completed","bytes":11132,"diarize":false,"language":"es-US","cost_estimate_usd":0.000696,
 "result":{"text":"hola, esto es una prueba.","language":"es-US","duration_seconds":1.74,"segments":[{"start":0.039,"end":1.74,"text":"hola, esto es una prueba."}]}}}
```
(Verificado con el mp3 de `speech`; tardó unos 25 s. `capsule api` no decodifica el cuerpo de `?format=txt`; usa curl o `capsule ai jobs <id> -o x.txt`.)

### POST .../ai/speech (JSON o multipart; 1 MB) [vivo]

Campos: `text` (obl.), `model` (`polly-neural`; también `polly-generative`, `polly-standard`), `voice` (según `lang`; es-US: `Lupe`), `lang`, `format` (`mp3` por defecto), `rate`, `save_to`, `inline`.
Respuesta por defecto: **cuerpo binario** de audio (content-type del formato, p. ej. `audio/mpeg`) con cabeceras `X-Capsule-Cost-USD` y `X-Capsule-Chars`.
Si se pide `Accept: application/json` o hay `save_to`, devuelve JSON:
```bash
curl -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"text":"Hola","voice":"Lupe","lang":"es-US"}' "$API/api/v1$B/speech" -o hola.mp3
capsule api POST $B/speech --input s.json -H "Accept: application/json"
```
```json
{"model":"polly-neural","voice":"Lupe","format":"mp3","content_type":"audio/mpeg","chars":25,"cost_estimate_usd":0.0004,"saved_to":"","audio_base64":"<base64>"}
```
El binario se verificó con `capsule ai speak` (mp3 de 3644 bytes); `capsule api` no decodifica cuerpos binarios (falla con `decoding response`).

### GET .../ai/voices?lang=es-US [vivo]

`{"data":[{"id":"Lupe","name":"Lupe","lang":"es-US","gender":"Female","engines":["generative","neural","standard"]}]}` (en es-US: Carlos, Lupe, Miguel, Pedro, ...).

### POST .../ai/images (JSON o multipart; 40 MB) [sin verificar: la generación falló en vivo]

Sin `image` genera desde `prompt`; con `image` edita. Campos: `prompt`, `model`, `operation` (elige el modelo Stability: `inpaint|erase-object|remove-background|search-replace|search-recolor|outpaint|style-transfer|style-guide|fast-upscale|conservative-upscale|creative-upscale`),
`n` (1 por defecto), `size` (`1024x1024`...), `format` (`png`\|`jpeg`), `save_to`, `inline`, archivos `image`, `mask`, `style_image` (10 MB c/u),
y pasan tal cual: `search_prompt`, `select_prompt`, `negative_prompt`, `aspect_ratio`, `style_preset`, `seed`, `left`, `right`, `up`, `down`, `grow_mask`, `control_strength`, `fidelity`.
Modelo por defecto: generar = `stability-image-control-sketch`; editar con `mask` = `stability-image-inpaint`; editar sin máscara = `stability-image-remove-background`.
El permiso `storage:presign` se comprueba después de leer el cuerpo.
```bash
echo '{"prompt":"una manzana roja sobre fondo blanco","size":"1024x1024","format":"png"}' > i.json
capsule api POST $B/images --input i.json
```
Respuesta esperada (del código, **sin verificar**):
```json
{"model":"stability-image-control-sketch","capability":"image-generate","images":[{"format":"png","seed":123,"b64":"<base64>","saved_to":""}],"cost_estimate_usd":0.07}
```
**Hallazgo en producción (06-nov): dos intentos de generar (512x512 y 1024x1024) devolvieron `502 UPSTREAM_ERROR: unexpected image response from stability-image-control-sketch`**
(Bedrock contestó sin `images`); no se hicieron más intentos por costo. La edición (`image` + `operation`) no se probó.

### POST .../ai/talk (multipart o JSON; 20 MB) [sin verificar: la llamada superó el timeout del cliente]

Un turno hablado. Campos: `audio` (WAV PCM16 mono, o PCM16 crudo a 16 kHz; `audio_base64` / `audio_source` en JSON; obl.), `model` (`nova-2-sonic`, luego `nova-2-5-sonic`), `voice`, `system`, `save_to`.
```bash
curl -H "Authorization: Bearer $T" -F audio=@pregunta.wav "$API/api/v1$B/talk"
```
```json
{"model":"nova-2-sonic","heard":"...","answer":"...","audio_base64":"<WAV 24 kHz>","audio_content_type":"audio/wav","audio_seconds":3.2,"saved_to":"",
 "usage":{"input_tokens":0,"output_tokens":0},"cost_estimate_usd":0.01}
```
Con 1 s de tono sintético, `capsule api` agotó su timeout esperando la respuesta (error del cliente, no un 4xx del servidor): trata la ruta como lenta y no verificada.

### POST .../ai/talk/ticket y GET /api/v1/ai/talk/ws [ticket vivo; WebSocket sin verificar]

Ticket (JSON o multipart, 64 KB): campos opcionales `model`, `voice`, `system`. [vivo]
```json
{"ticket":"52GY5u...","expires_in":60,"ws":"/api/v1/ai/talk/ws?ticket=52GY5u...","model":"nova-2-sonic","protocol":"send binary frames of PCM16 16 kHz mono; ..."}
```
`GET /api/v1/ai/talk/ws?ticket=<t>` es público (el ticket, de un solo uso y 60 s, es la credencial; sin él o repetido: 401). Cliente a servidor: frames binarios PCM16 16 kHz mono y el
texto `end` para terminar. Servidor a cliente: frames binarios PCM16 24 kHz mono y frames de texto `{"type":"text","role":"user|assistant","text":"..."}` o `{"type":"error","message":"..."}`.
Sesión máxima 5 minutos; límite de lectura 256 KB por frame; se cobra por minuto al cerrar. Sin caché de plataforma el ticket da 503.

## Modelos disponibles

Del catálogo en `backend/internal/aimm/catalog.go`, contrastado con `GET /ai/models` de producción (06-nov-2026: región us-east-1, `live:true`, 105 modelos,
todos `available:true`; el único aviso es `claude-sonnet-4.5`: "legacy model: AWS plans to retire it"). Precios estimados en USD. Los demás modelos de chat que
Bedrock lista (80 en total para chat; ids como `anthropic.claude-sonnet-5-5` o `amazon.nova-micro-v1:0`) se ofrecen solo como chat/visión, sin precio en la
tabla (el costo estimado sale 0 y solo se informan tokens) y con la nota "access not checked for this model".

| id | Capacidad | Para qué sirve | Precio estimado | Defecto de |
|---|---|---|---|---|
| `nova-2-lite` | chat, vision, video | texto y entender imágenes/video, barato | 0.0003 in / 0.0025 out por 1k tokens | **chat, visión, video** |
| `nova-pro` | chat, vision, video | igual, más capaz | 0.0008 / 0.0032 por 1k tokens | segundo |
| `nova-lite` | chat, vision, video | el más barato | 0.00006 / 0.00024 por 1k tokens | |
| `claude-haiku-4.5` | chat, vision | respuestas rápidas | 0.001 / 0.005 por 1k tokens | |
| `claude-sonnet-4.5` | chat, vision | razonamiento general (legacy) | 0.003 / 0.015 por 1k tokens | tercero |
| `claude-opus-4.5` | chat, vision | el más capaz | 0.005 / 0.025 por 1k tokens | |
| `voxtral-mini`, `voxtral-small` | chat | listados con audio, pero Bedrock lo rechaza: no usar para voz | 0.00004 / 0.00004 y 0.0001 / 0.0003 por 1k tokens | |
| `transcribe` | stt | voz a texto asíncrono, hablantes y tiempos | 0.024 por minuto | **stt** |
| `polly-neural` | tts | texto a voz natural | 16 por 1M caracteres | **tts** |
| `polly-generative` | tts | texto a voz más expresiva | 30 por 1M caracteres | |
| `polly-standard` | tts | texto a voz básica | 4 por 1M caracteres | |
| `nova-2-sonic` | speech-to-speech | conversación hablada | 0.06 por minuto | **speech-to-speech** |
| `nova-2-5-sonic` | speech-to-speech | idem, versión 2.5 | 0.06 por minuto | segundo |
| `stability-image-control-sketch` | image-generate, image-edit | generar desde texto (lienzo en blanco) o desde un boceto | 0.07 por imagen | **image-generate** |
| `stability-image-inpaint` | image-edit | rellenar zona enmascarada | 0.04 por imagen | **edición con máscara** |
| `stability-image-remove-background` | image-edit | quitar el fondo | 0.07 por imagen | **edición sin máscara** |
| `stability-image-erase-object` | image-edit | borrar un objeto | 0.04 por imagen | |
| `stability-image-search-replace` | image-edit | cambiar un objeto buscado por texto | 0.04 por imagen | |
| `stability-image-search-recolor` | image-edit | recolorear un objeto | 0.04 por imagen | |
| `stability-outpaint` | image-edit | ampliar el lienzo | 0.04 por imagen | |
| `stability-style-transfer` | image-edit | pasar el estilo de otra imagen | 0.08 por imagen | |
| `stability-image-style-guide` | image-edit | generar siguiendo un estilo | 0.07 por imagen | |
| `stability-fast-upscale` | image-edit | ampliar rápido | 0.01 por imagen | |
| `stability-conservative-upscale` | image-edit | ampliar fiel | 0.40 por imagen | |
| `stability-creative-upscale` | image-edit | ampliar con reinvención | 0.60 por imagen | |
| `stability-image-control-structure` | image-edit | rehacer conservando la estructura | 0.07 por imagen | |
| `titan-embed-v2` | embed | vectores de texto | 0.00002 por 1k tokens | **embed** |
| `nova-embed` | embed | texto e imagen | 0.00014 por 1k tokens | segundo |
| `cohere-embed-v4` | embed | texto multilingüe | 0.00012 por 1k tokens | |
| `marengo-embed-3` | embed | texto e imagen, 512 dimensiones | 0.00007 por 1k tokens | |
| `titan-embed-image` | embed | texto e imagen en un espacio | 0.0008 por 1k tokens | |
| `cohere-rerank-3-5` | rerank | reordenar documentos por relevancia | 2 por 1000 búsquedas (1 por cada 100 documentos) | **rerank** |

Con `verified:true` en el catálogo (formato de petición probado contra el servicio real): `titan-embed-v2`, `nova-embed`, `cohere-embed-v4`, `marengo-embed-3`,
`cohere-rerank-3-5`, `nova-2-lite`, `claude-haiku-4.5`, `transcribe`, `polly-neural` y, de Stability, `inpaint`, `remove-background`, `style-guide` y `control-sketch`.
Los demás (incluido Sonic) no están verificados. Ese `verified` no garantiza que la ruta HTTP funcione: ver los hallazgos de `stream` e `images` arriba.
