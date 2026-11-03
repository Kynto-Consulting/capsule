# Instalación, login, tokens y convenciones del CLI

## Instalar

```bash
npm i -g @kyntocg/capsule-cli        # binario `capsule` (versión del repo: 0.7.3)
capsule version
```

Desde el código (para probar cambios del CLI): `cd cli && go build -o <dir-temporal>/capsule ./cmd/capsule`
(compila fuera del repo; no dejes binarios dentro).

## URL de la API (obligatoria)

El valor por defecto es `http://localhost:8080`, que NO es producción. Fíjala explícitamente:

```bash
export CAPSULE_API_URL=https://api.tumi-ai.com     # según docs/deploy: api.tumi-ai.com; confirma con el usuario
capsule --api-url https://api.tumi-ai.com whoami   # o por flag
```

En modo no interactivo (CI, o `CAPSULE_TOKEN` definido) sin URL y sin `~/.capsule/config.yaml` el CLI falla con
`API URL not set: pass --api-url or set CAPSULE_API_URL`. En modo interactivo sin config, la primera ejecución la
pregunta y la guarda.

## Dos formas de autenticarse

| Forma | Cómo | Dónde queda | Úsala para |
|---|---|---|---|
| Sesión humana | `capsule login --email E --password P` (ambos flags obligatorios) | `~/.capsule/config.yaml` (modo 0700): `api_url`, `token`, `refresh_token`, `org_id`, `cli_session_id` | trabajo interactivo, `capsule git clone`, credential helper |
| Token de máquina | `CAPSULE_TOKEN=cap_…` (+ `CAPSULE_API_URL`, `CAPSULE_ORG_ID`, `CAPSULE_PROJECT_ID`) | solo entorno; **nunca** se escribe a disco | CI y automatización |

- Una sesión humana no la crea un agente por su cuenta: la contraseña la aporta el usuario. No guardes la
  contraseña en archivos ni en comandos que queden en historial; si hay que ejecutar `login`, pide al usuario
  que lo haga o que te dé un token `cap_` de alcance mínimo.
- `capsule whoami` comprueba la sesión. `capsule logout` revoca los tokens Git de corta vida de esta sesión y
  olvida el login local.
- Con `CAPSULE_TOKEN` definido el CLI no pregunta nada ni toca el archivo de configuración. `CAPSULE_TOKEN` gana
  sobre el archivo.
- `capsule register` crea usuarios con autorización 2FA global: no es un flujo de agente.

## Tipos de token (prefijos)

| Prefijo | Qué es | Cómo se crea | Cómo se usa |
|---|---|---|---|
| (JWT) | sesión del CLI tras `login` | `capsule login` | automático |
| `cap_` | token de API de Capsule, con alcance (`*`, `deploy`, `security:write`) | `capsule tokens create` | `CAPSULE_TOKEN` |
| `cgt_` | token de **Git** (HTTPS): efímero (~1 h, lo emite el credential helper), personal (7-90 d) o de servicio para CI | `capsule git tokens create`, `capsule git service-tokens create` | contraseña HTTPS de Git; **no** sirve para la API de Capsule |

Reglas que impone el código: `capsule git clone` y `capsule git credential` rechazan un `CAPSULE_TOKEN` con prefijo
`cgt_` (exit 2). Un `cap_` con alcance `deploy` no puede pedir credenciales Git (403). Detalle de alcances:
`permisos-tokens.md`.

## Variables de entorno

| Variable | Efecto |
|---|---|
| `CAPSULE_TOKEN` | token `cap_` para CI; deshabilita prompts |
| `CAPSULE_API_URL` | URL de la API |
| `CAPSULE_ORG_ID`, `CAPSULE_PROJECT_ID` | contexto sin `.capsule.json` |
| `CAPSULE_GIT_URL` | URL base de Git para `capsule git clone` (si no, la que informa `capsule platform`) |
| `CAPSULE_CI=1`, `CI=true`, `GITHUB_ACTIONS=true` | modo CI: salida plana, sin prompts |
| `CAPSULE_CWD` | directorio de trabajo alternativo para deploy/ci |
| `NO_COLOR` | sin color |

Contexto por carpeta: `.capsule.json` (`org_id`, `project_id`; `capsule link` lo crea; `capsule init` lo añade a
`.gitignore`). Precedencia: flags `--org/--project` > entorno > `.capsule.json`. Sin proyecto enlazado: exit 2.

## Convenciones globales

- **IDs cortos**: `list` imprime 8 caracteres; los subrecursos (crons, workers, reglas de `ports`/`db access`,
  snapshots, alertas, PR por número `12` o `#12`) los aceptan. Un prefijo ambiguo da error.
- **Salida**: tabla por defecto; `--json` (u `--output json|yaml`), `--jq '.items[].id'` (subconjunto: `.a.b`,
  `.[0]`, `.[]`, `.a[].b`, con `|`), `--no-header`, `-q` (solo IDs). Listas: `--limit`, `--cursor`, `--all`.
- **Esperas**: `--wait[=10m]` en operaciones asíncronas (sin valor = 10 min).
- **Confirmaciones**: `-y/--yes` las omite. Sin `--yes` y sin terminal, sale con 2 (nunca cuelga). Úsalo solo con
  aprobación del usuario.
- **Idempotencia**: operaciones de escritura envían `Idempotency-Key` automática (hash de comando+argumentos+
  fecha); fíjala con `--idempotency-key` al reintentar con seguridad.
- **Alias**: `capsule alias set mine 'pr list --author @me'` (guarda en `~/.capsule/config.yaml`); `@me` = `whoami`.
- **`capsule api METHOD PATH`**: llamada autenticada a `/api/v1` para lo que aún no tiene comando:
  `capsule api GET /orgs/$ORG/projects/$PROJ/git/branches`, `-f k=v` (cadena), `-F k=true|123|@archivo` (tipado),
  `--input body.json`, `--include` (status por stderr). No admite cabecera `Authorization`.
- **404/501 de una función** = el servidor aún no la soporta o está apagada (`capsule platform` lo muestra). Dilo
  al usuario; no improvises un rodeo.

## Códigos de salida (`capsule help exit-codes`)

| Código | Significado | Qué hacer |
|---|---|---|
| 0 | OK | - |
| 1 | Error no clasificado | leer el mensaje; `--help` |
| 2 | Uso incorrecto (flags, argumentos, sin proyecto, falta `--yes`, `cgt_` donde no va) | corregir la invocación |
| 3 | No autenticado / token inválido | pedir `capsule login` o token nuevo |
| 4 | Sin permiso o no encontrado (el servidor oculta existencia) | revisar rol y que el recurso exista; no insistir |
| 5 | Bloqueado por regla: `PROTECTED_BRANCH`, `CHECKS_REQUIRED`, `REVIEWS_REQUIRED`, `POLICY_BLOCKED`, `CODEOWNER_REQUIRED`, `SELF_APPROVAL_FORBIDDEN`, `SIGNATURE_REQUIRED`; también `deploy --strict-connections` | arreglar la causa, no la regla |
| 6 | `--wait` agotado, o fallo con `--exit-status` | revisar `runs logs` / `pr checks` |
| 7 | Git no listo o error del motor (`GIT_NOT_READY`, `UPSTREAM_GIT_ERROR`, 501/5xx) | reintentar luego; `capsule git status` |
| 8 | Pendiente de aprobación (`APPROVAL_REQUIRED`) | avisar al humano; no insistir |
| 9 | Conflicto de concurrencia (409: el cabezal cambió, clave de idempotencia reutilizada) | releer estado y reintentar |

Ejemplo de uso en script: `capsule pr merge 12 --squash; rc=$?; [ $rc -eq 5 ] && capsule pr view 12`.
