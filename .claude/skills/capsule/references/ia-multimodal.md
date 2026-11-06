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
