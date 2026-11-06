# IA multimodal de Capsule

`capsule ai` ya no es solo texto. Cada capacidad de los modelos de AWS (voz a texto, texto a voz, voz a voz, imágenes, embeddings,
reranking, visión y video) tiene una ruta de la API, un comando del CLI y una herramienta en el panel (**IA > Studio**).
Todo vive en el backend (`backend/internal/aimm` y `backend/internal/server/handlers/aimm.go`); el CLI y el panel solo llaman a la API.

Los formatos de petición y respuesta de cada familia de modelos **se probaron con llamadas reales** a Bedrock, Transcribe y Polly
el 05-nov-2026 (cuenta 598806201852, `us-east-1`); `internal/aimm/real_test.go` las repite (ver "Pruebas").

## Catálogo por capacidad

`GET /api/v1/ai/models?capability=<c>[&available=true]` (público) devuelve el catálogo construido **en vivo** con
`ListFoundationModels`, `GetFoundationModelAvailability` y `ListInferenceProfiles`, con caché de 15 minutos. Si la API de Bedrock no
responde, devuelve la lista fija de `catalog.go` marcada `source: "fallback"` (todo disponible, sin comprobar). Sin `?capability=`
ni `?catalog=1` la ruta contesta la lista de texto de siempre.

Capacidades: `chat`, `vision`, `stt`, `tts`, `speech-to-speech`, `image-generate`, `image-edit`, `embed`, `rerank`, `video`.
La respuesta trae además `capabilities[]` con `available`, el número de modelos y, cuando no hay ninguno, el **motivo**
(por ejemplo "access not granted: enable the model in the AWS console"). Un modelo no disponible aparece igual, con `available:false`
y `reason`. Los modelos sin on-demand se llaman por su perfil de inferencia regional (`us.<id>`), que se resuelve con la API.

Lo que la cuenta tiene hoy y cómo se llama (todo `AUTHORIZED` el 05-nov):

| Capacidad | Modelo (id del catálogo) | Servicio | Verificado |
| --- | --- | --- | --- |
| stt | `transcribe` | Amazon Transcribe (lotes, hablantes, marcas de tiempo) | sí |
| tts | `polly-neural`, `polly-generative`, `polly-standard` | Amazon Polly | neural sí |
| speech-to-speech | `nova-2-sonic`, `nova-2-5-sonic` | Bedrock, stream bidireccional | sí, los dos |
| image-generate | `stability-image-control-sketch` | Bedrock | sí |
| image-edit | 13 servicios Stability (`stability-image-inpaint`, `…-remove-background`, `…-erase-object`, `…-search-replace`, `…-search-recolor`, `stability-outpaint`, `stability-style-transfer`, `…-style-guide`, `stability-fast-upscale`, `…-conservative-upscale`, `…-creative-upscale`, `…-control-structure`, `…-control-sketch`) | Bedrock | inpaint, remove-background, style-guide, control-sketch |
| embed | `titan-embed-v2`, `titan-embed-image`, `nova-embed`, `cohere-embed-v4`, `marengo-embed-3` | Bedrock | todos menos titan-embed-image |
| rerank | `cohere-rerank-3-5` | Bedrock | sí |
| vision / video / chat | `nova-2-lite`, `nova-pro`, `nova-lite`, los Claude y todo modelo de texto que Bedrock liste | Bedrock (Converse) | nova-2-lite con imagen |

Hallazgos que cambian el diseño:

- **Voxtral Mini/Small figuran con entrada de voz pero Bedrock rechaza el audio** (`Model does not support audio modality`, por
  Converse e InvokeModel, con `input_audio` y wav/mp3). Se ofrecen solo como chat y el catálogo lo dice en su nota. La voz a texto va
  por Amazon Transcribe. Un audio adjunto al chat se transcribe primero y la transcripción se une a la pregunta.
- **No hay un modelo de texto a imagen dedicado** en el catálogo de la cuenta (no existen Nova Canvas, Titan Image, SD3.5 ni Stable
  Image Core/Ultra). `stability-image-control-sketch` con un lienzo en blanco como boceto y `control_strength` 0.1 genera la imagen a
  partir del texto (comprobado: una manzana fotográfica de 1024x1024). Capsule envía el lienzo solo; el catálogo lo anota.
- **Claude** (Haiku 4.5 y siguientes) devolvió el 05-nov `Model use case details have not been submitted for this account`: AWS pide
  rellenar el formulario de uso de Anthropic en la consola aunque el acceso figure `AUTHORIZED`. Se mapea a `MODEL_ACCESS` (403) con esa
  instrucción. Mientras tanto la visión se verificó con Nova 2 Lite (respuesta correcta sobre una imagen).
- Marengo y Pegasus de TwelveLabs: **Marengo con texto e imagen está integrado** (síncrono, 512 dimensiones). El audio y el video de
  Marengo y Nova Embeddings, y Pegasus, solo existen por la API asíncrona (`StartAsyncInvoke`), que escribe en un bucket de S3 de AWS
  y devuelve un trabajo; entender un video corto se hace hoy con Nova en el chat (`--video`). La API asíncrona queda fuera a propósito:
  exigiría un segundo bucket de AWS por resultado y no cubre ningún caso que el chat con video no cubra.

## API

Todas las rutas de proyecto cuelgan de `/api/v1/orgs/{orgID}/projects/{projectID}/ai/...`. Aceptan `multipart/form-data` o JSON;
los archivos pueden ir como parte `file`, como `<campo>_base64` o como `<campo>_source=bucket/key` (se leen del almacén de objetos
propio del proyecto). Con `save_to=bucket/key` (o `bucket/prefijo/`) el resultado se guarda en un bucket del proyecto.

| Método y ruta | Qué hace | Permiso |
| --- | --- | --- |
| `POST /chat` | pregunta con adjuntos `image`, `video`, `document`, `audio`; `stream=true` da SSE (`data: {"delta":…}` … `{"done":true,…}`) | `project:read` |
| `POST /embeddings` | `input` (texto o lista) e imágenes; `dimensions`, `purpose` | `project:read` |
| `POST /embeddings/search` | `query`, `bucket`, `prefix`, `top_k`: vectoriza los textos del bucket (caché por contenido) y ordena por similitud | `project:read` |
| `POST /rerank` | `query`, `documents[]`, `top_n` | `project:read` |
| `POST /transcribe` | audio hasta 100 MB; `lang`, `diarize`, `speakers`; responde **202** con el trabajo | `storage:presign` |
| `GET /jobs/{id}[?format=txt\|srt\|vtt\|json]` | estado del trabajo; con `format` y terminado, el archivo | `project:read` |
| `POST /speech` | `text` (hasta 20 000 caracteres), `voice`, `lang`, `format`, `rate`; audio en el cuerpo, o JSON con base64 si `Accept: application/json` o `save_to` | `storage:presign` |
| `GET /voices?lang=` | voces de Polly | `storage:presign` |
| `POST /images` | sin `image` genera; con `image` (y `mask`) edita; `operation=` elige el servicio (`inpaint`, `remove-background`, …) o `model=`; `n` hasta 4, `size`, `format` | `storage:presign` |
| `POST /talk` | voz a voz de un turno: `audio` WAV PCM16 mono (o PCM 16 kHz); devuelve lo escuchado, la respuesta y el audio (WAV 24 kHz) | `storage:presign` |
| `POST /talk/ticket` + `GET /api/v1/ai/talk/ws?ticket=` | conversación en vivo por WebSocket: binarios PCM16 16 kHz hacia el modelo; el modelo envía binarios PCM16 24 kHz y texto JSON `{type,role,text}`; el texto `end` termina | `storage:presign` |
| `GET /usage` | gasto estimado de hoy y tope | `project:read` |

Errores con código de máquina: `VALIDATION_ERROR` 422, `MODEL_NOT_FOUND` 404, `MODEL_UNAVAILABLE` 409 (con el motivo), `NO_MODEL` 409,
`MODEL_ACCESS` 403, `QUOTA_EXCEEDED` 429 (con `used_usd`, `limit_usd`, `needed_usd`), `TOO_LARGE` 413, `BUCKET_NOT_FOUND` 404,
`TIMEOUT` 504, `UPSTREAM_ERROR` 502, `SERVICE_UNAVAILABLE` 503 (sin credenciales de AWS o sin bucket de preparación).

**Streaming:** chat (SSE) y voz a voz (WebSocket). Los demás modelos no tienen modo en flujo.

**Límites, cada uno con su razón:** audio 100 MB (el cuerpo va en memoria, tope de la API); imágenes de entrada 10 MB; video 40 MB (Converse
admite 25 MB en bytes con algunos modelos: el modelo lo rechaza con su mensaje); documentos 8 MB; 4 imágenes por llamada (cada una es una
llamada de pago); 96 entradas por llamada de embeddings (el lote de Cohere); 1000 documentos por rerank; 100 archivos de texto de 32 KB en
la búsqueda (acota el costo de vectorizar); conversación en vivo 5 minutos; tiempos por llamada de 60 s a 5 min según la operación.

## Permisos

El catálogo de átomos del motor de permisos (`docs/permissions/`) es de solo-agregar, versionado por la SPEC y con pruebas que fijan su
tamaño; añadir átomos `ai:*` es un cambio de versión del catálogo (SPEC, `catalog.json`, plantillas de sistema, OpenAPI). Esta entrega
**no toca el catálogo** y gobierna cada capacidad con los átomos que ya existen, a nivel de proyecto:

- usos de lectura (`chat`, `embeddings`, `rerank`, `jobs`, `usage`): `project:read`;
- usos que producen archivos (`transcribe`, `speech`, `voices`, `images`, `talk`): `storage:presign`, el átomo de quien puede escribir en los
  buckets del proyecto.

La tabla está en `handlers.capabilityAtom`, en `routePermissions` y en `routes_authz.golden`; un token con alcance necesita el átomo. Quien
quiera separar por capacidad (por ejemplo dar `ai:image` sin dar `ai:talk`) necesita la versión 2 del catálogo con estos átomos, que esta
entrega deja propuestos: `ai:use` (chat, embeddings, rerank), `ai:speech` (transcribe, speech, talk), `ai:image` (images). Los tres se mapearían a
`project.read`, `project.ops` y `project.ops` como acciones antiguas.

## Cuotas, costo y auditoría

- Cada respuesta trae `cost_estimate_usd` calculado con la tabla de precios del catálogo (estimación, no factura).
- Tope diario de gasto estimado **por proyecto y día UTC**, `CAPSULE_AI_DAILY_BUDGET_USD` (por defecto **5**; `0` sin tope). Antes de llamar
  se comprueba que la estimación quepa; superado el tope responde `QUOTA_EXCEEDED` sin llegar al modelo. El gasto se guarda en la caché de la
  plataforma (Redis) y, sin ella, en memoria. Con varias réplicas del backend el tope puede pasarse en una llamada por réplica.
- Auditoría de cada llamada en `audit_logs` (`action` `ai.<capacidad>`, recurso `ai_call`): modelo, capacidad, bytes de entrada y salida, costo
  estimado, estado y duración. **Nunca el contenido** (ni prompts, ni texto, ni audio, ni imágenes); una prueba lo verifica.

## CLI

```bash
capsule ai models [--capability stt|tts|image|embed|rerank|chat|vision|speech-to-speech|video] [--available] [--json]
capsule ai chat "¿qué hay en la foto?" --image foto.jpg [--stream] | --video v.mp4 | --document informe.pdf | --audio nota.mp3 --lang es-US
capsule ai transcribe reunion.mp3 --diarize --lang es-US -o reunion.srt        # .txt .srt .vtt .json; --source bucket/key; --save-to; --no-wait
capsule ai jobs <id> [--wait] -o salida.vtt
capsule ai speak "Hola" --voice Lupe -o hola.mp3 ; capsule ai voices --lang es-US
capsule ai image "una manzana roja" --n 2 --size 1024x1024 -o ./out/
capsule ai image --image foto.png --operation remove-background -o ./recorte/   # edición; inpaint pide --mask (blanco cambia, negro se conserva)
capsule ai embed "texto" --json ; capsule ai embed search "factura de luz" --bucket docs --top 3 ; capsule ai rerank "consulta" --doc a --doc b
capsule ai talk pregunta.wav -o respuesta.wav                                    # un turno por archivo
ffmpeg -f dshow -i audio="Micrófono" -f s16le -ar 16000 -ac 1 - | capsule ai talk --live | ffplay -f s16le -ar 24000 -nodelay -i -
capsule ai usage
```

`capsule ai` sin subcomando, `explain-failure`, `dockerfile`, `optimize-costs` y `keys` siguen igual. Todos los comandos nuevos aceptan `--json`,
`--org` y `--project` (por defecto el directorio enlazado). Salida: el resultado por stdout, el costo estimado por stderr. Códigos de salida:
2 uso incorrecto, 3 sin sesión, 4 sin permiso o no encontrado, **5 presupuesto agotado o modelo no utilizable** (`QUOTA_EXCEEDED`,
`MODEL_UNAVAILABLE`, `NO_MODEL`, `MODEL_ACCESS`), 6 espera agotada. El modo vivo (`--live`) usa tuberías en lugar de abrir el micrófono desde
Go: no hay audio nativo portable en un binario sin CGO, y así funciona con cualquier grabador y reproductor; el panel ofrece la misma conversación con el micrófono del navegador.

## Panel

**IA > Studio**: se elige organización y proyecto (se recuerda), se ve el gasto estimado del día frente al tope, y hay seis herramientas:
Transcribe (subir o grabar, texto con marcas de tiempo y hablantes, descarga txt/srt/vtt/json), Speak (voz, idioma, velocidad, reproductor y
descarga), Images (generar y editar, galería con descarga), Embeddings (búsqueda por similitud sobre un bucket, rerank y vectores),
Chat + files (adjuntos de imagen, video, documento y audio, respuesta en flujo) y Voice (conversación en vivo con el micrófono). Cada una
muestra el selector de modelo con su precio, los modelos no disponibles con su motivo, estados de carga, errores legibles y el costo estimado.
El panel usa las variables de color del sistema de diseño; hoy el panel es solo oscuro. Con 375 px de ancho ninguna herramienta desborda.

## Despliegue

Nada de esto se desplegó. Para llevarlo a producción, **sin compilar en el host** (regla `capsule-host-build-freeze`):

1. IAM (Terraform ya editado en `deploy/terraform/iam.tf` y `s3.tf`, sin aplicar): el usuario `capsule-api` necesita
   `bedrock:InvokeModelWithBidirectionalStream`, `bedrock:ListFoundationModels`, `bedrock:GetFoundationModelAvailability`,
   `bedrock:ListInferenceProfiles`, `transcribe:StartTranscriptionJob`, `transcribe:GetTranscriptionJob`, `polly:SynthesizeSpeech`,
   `polly:DescribeVoices` (el S3 de `capsule-artifacts-*` ya está cubierto con `s3:*`) y una regla de ciclo de vida que expire `ai-stage/` a 1 día:
   ```bash
   cd deploy/terraform && terraform plan -target=aws_iam_user_policy.capsule_api -target=aws_s3_bucket_lifecycle_configuration.artifacts_ai_stage
   terraform apply -target=aws_iam_user_policy.capsule_api -target=aws_s3_bucket_lifecycle_configuration.artifacts_ai_stage
   ```
2. Anthropic: abrir la consola de Bedrock > Model access y rellenar el formulario de uso de Anthropic (pide un administrador de la cuenta); luego
   `aws bedrock-runtime converse --profile tumi-admin --region us-east-1 --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0 --messages '[{"role":"user","content":[{"text":"hola"}]}]'`
   debe responder.
3. Backend: compilar el binario Linux en el PC, subirlo comprimido a `s3://capsule-artifacts-598806201852/deploy/` y armar la imagen mínima en el host.
   Variables opcionales: `CAPSULE_AI_STAGE_BUCKET` (por defecto `capsule-artifacts-<cuenta>`; `off` desactiva la transcripción) y `CAPSULE_AI_DAILY_BUDGET_USD`.
   El WebSocket (`/api/v1/ai/talk/ws`) debe poder atravesar el proxy: Caddy lo hace sin configuración; un balanceador ALB lo admite con `idle_timeout` mayor de 60 s.
4. Panel y CLI: publicar el paquete npm (WebAssembly) y el panel como siempre. El DNS no cambia.

## Pruebas

- `go test ./internal/aimm` (cliente Bedrock, Polly y Transcribe falsos: formato de petición y respuesta de cada familia, catálogo vivo y de respaldo,
  trabajos, SRT/VTT, cuotas, costos) y `go test ./internal/server/handlers -run AIMM` (permisos por capacidad, cuotas, auditoría sin contenido,
  buckets, errores). CLI: `go test ./cmd/capsule -run TestAI`.
- Reales, fuera de CI (etiqueta `awsreal`, cuestan unos 20 centavos de dólar por corrida completa):
  `AWS_PROFILE=tumi-admin AWS_REGION=us-east-1 go test -tags awsreal -run Real -v -timeout 10m ./internal/aimm`.
- Servidor de desarrollo sin Postgres para probar el panel y el CLI con AWS real: `go run ./cmd/aimm-dev -addr 127.0.0.1:8080` (solo loopback, sin autenticación).
