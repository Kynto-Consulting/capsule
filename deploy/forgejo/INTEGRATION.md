# Integracion Capsule <-> Forgejo (implementada)

Esto describe lo que el backend de Capsule hace hoy (paquete `backend/internal/forgejo`, handlers `git_core.go`, `platform.go`, cableado en
`backend/cmd/server/gitcore_wiring.go`). La API de Forgejo es la v1 (`$CAPSULE_GIT_URL/api/v1`, swagger en `/api/swagger`). Las llamadas marcadas con (?) NO se han
probado contra una instancia real: verifiquelas contra el swagger de la version instalada antes del primer despliegue.

## Configuracion (secretos de la plataforma, no variables de proyecto)

| Variable | Uso |
|---|---|
| `CAPSULE_GIT_URL` | URL base de Forgejo, p. ej. `https://git.tumi-ai.com`. Vacia = integracion apagada (todo lo demas funciona igual). |
| `CAPSULE_GIT_TOKEN` | Token de la cuenta de servicio administradora (`capsule-bot`). Secreto: solo backend, rotable, nunca en logs ni en el estado visible. Con URL vacia o token vacio la integracion queda apagada. |
| `CAPSULE_GIT_BOT_LOGIN` | Login de la cuenta de servicio para la sesion web (por defecto `capsule-bot`; es la misma que ya usa la sincronizacion de equipos). |
| `CAPSULE_GIT_BOT_PASSWORD` | Contrasena (secreto) de esa cuenta, solo para la **sesion web de Forgejo** (ver "Cuenta bot para la sesion web" abajo). Vacia = jobs, logs, cancelar, re-ejecutar y artefactos responden `501 NOT_SUPPORTED` con el motivo y el enlace a Forgejo; nada mas se rompe. |
| `CAPSULE_GIT_WEB_VERSIONS` | Versiones de Forgejo con las que se permite usar esas rutas web internas, separadas por comas (`15.0.11`, `15.0.*`, `*`). Por defecto solo la probada: `15.0.11`. Otra version degrada a `501` con el motivo. |
| `CAPSULE_GIT_SSH_HOST` | Host (o `host:puerto`) de `clone_url_ssh`. Si falta se usa el host de `CAPSULE_GIT_URL`. Con puerto se emite `ssh://git@host:puerto/org/repo.git`; sin puerto, `git@host:org/repo.git`. |
| `CAPSULE_PUBLIC_URL` | URL publica del backend, base del webhook `{CAPSULE_PUBLIC_URL}/hooks/git/{projectID}`. Si falta se usa `https://$CAPSULE_PUBLIC_HOST`. Sin ninguna de las dos el aprovisionamiento falla de forma visible (no hay webhook posible). |
| `CAPSULE_OIDC_ISSUER`, `CAPSULE_FRONTEND_URL`, `CAPSULE_OIDC_SIGNING_KEY` | Login OIDC (ya existente). Todas viajan en `docker-compose.prod.yml`. |
| `CAPSULE_GIT_ALLOWED_HOSTS` | (ya existente) allow-list de hosts del modulo `gitsource`. El clonado del repo provisionado usa `CAPSULE_GIT_URL` como `repo_url`, que debe ser un host publico https (la politica SSRF rechaza redes privadas). |

El token solo se necesita con alcance de administracion de organizaciones, repositorios y equipos (`write:organization`, `write:repository`, y `read:user` para consultar usuarios).

`GET /api/v1/platform/capabilities` expone `git: {enabled, url, ssh_host}` y `oidc: {enabled, issuer}`; `url` y `ssh_host` van vacios con la integracion apagada.

## a) Al crear un proyecto

El handler de creacion de proyectos avisa a `forgejo.Core.OnProjectCreated` (sin bloquear la respuesta). En segundo plano, de forma idempotente
(`Core.Provision`), con `Authorization: token $CAPSULE_GIT_TOKEN`:

1. Organizacion `<org-slug>`: `GET /orgs/{org}`; si 404, `POST /orgs` `{"username":"<org-slug>","visibility":"private"}` (un 422 por carrera se confirma con otro GET).
2. Repositorio `<project-slug>`: `GET /repos/{org}/{repo}`; si 404, `POST /orgs/{org}/repos` `{"name":"<project-slug>","private":true,"auto_init":true,"default_branch":"main"}`
   (un 409 se trata como ya existente).
   - Con importacion: `GET /repos/{org}/{repo}` y, si no existe, `POST /repos/migrate` `{"clone_addr":"<import_url>","repo_owner":"<org>","repo_name":"<repo>","private":true,"mirror":false,"service":"git"}`.
     La rama del vinculo es la rama por defecto del repo importado.
3. Webhook: `GET /repos/{org}/{repo}/hooks`; si ya hay uno con la misma URL se actualiza con `PATCH /repos/{org}/{repo}/hooks/{id}` (mantiene el secreto sincronizado), si no
   `POST /repos/{org}/{repo}/hooks` `{"type":"forgejo","active":true,"events":["push","pull_request"],"config":{"url":"{CAPSULE_PUBLIC_URL}/hooks/git/{projectID}","content_type":"json","secret":"<32 bytes hex>"}}`.
   No se usa `branch_filter`: el backend filtra la rama (y los PR) al recibir la entrega. El secreto firma con HMAC-SHA256 (`X-Forgejo-Signature` / `X-Gitea-Signature`) y se guarda cifrado en `project_git`.
4. Vinculo en `project_git`: `provider=forgejo`, `repo_url=https://<git>/<org>/<repo>.git`, `branch=main` (o la del repo importado), `auto_deploy=true`, `preview_enabled=false`,
   `auth_kind=token` con el token de servicio como credencial (el backend lo usa para clonar el repo privado y para estados de commit / comentarios de PR). Si el vinculo ya existe y es forgejo se conservan sus ajustes y su secreto.
   **Rotacion del token de servicio:** los vinculos guardan una copia cifrada; tras rotar `CAPSULE_GIT_TOKEN` hay que volver a llamar a `POST .../git/repo` por proyecto (re-escribe la credencial) hasta que exista un barrido.
5. Equipos (seccion b).

Estado visible y reintento: tabla `git_core_state` (`pending | ready | failed`, `attempts`, `last_error` sin el token, `next_attempt_at`). Un fallo de Forgejo nunca bloquea ni deshace la creacion del proyecto;
`Core.RunRetry` (cada minuto) reintenta los `pending` con backoff 30 s x 2^n (maximo 1 h) y pasa a `failed` tras 10 intentos (solo se reanuda llamando a `POST .../git/repo`).
`GET /orgs/{o}/projects/{p}/git/repo` devuelve `{"status","attempts","last_error","web_url","clone_url_https","clone_url_ssh"}`.

### Proyectos existentes

`POST /orgs/{o}/projects/{p}/git/repo` (permiso `ProjectOps`), cuerpo opcional `{"import_url":"https://..."}`. El `import_url` pasa por las mismas validaciones SSRF que `gitsource`
(https o ssh, sin credenciales, host publico segun `CAPSULE_GIT_ALLOWED_HOSTS`) y se responde 422 si falla. Respuesta `200 {"web_url","clone_url_https","clone_url_ssh"}`;
si la importacion tarda mas de 25 s responde `202` con las mismas URLs y sigue en segundo plano (el estado se ve en `GET .../git/repo`).
`409` si el proyecto ya esta vinculado a otro proveedor, `501` si la integracion esta apagada, `502` si Forgejo falla (queda `pending` y se reintenta).

### Borrado de proyecto

No implementado todavia: el repositorio de Forgejo no se toca al borrar un proyecto. Cuando se haga: `PATCH /repos/{org}/{repo}` `{"archived":true}` por defecto, `DELETE` solo tras confirmacion y respaldo.

## b) Roles de proyecto -> equipos de Forgejo

Los roles son por proyecto, asi que los equipos son por proyecto (un equipo comun a toda la organizacion daria acceso a todos sus repos):

| Rol efectivo en Capsule | Equipo en la org | Permiso |
|---|---|---|
| admin (incluye owner/admin de la org) | `<project-slug>-admin` | `admin` (escritura + administrador del repo) |
| deployer | `<project-slug>-deployer` | `write` |
| viewer | `<project-slug>-viewer` | `read` |

El rol efectivo sale de `authz.Resolve(rol_org, modo_acceso, rol_explicito)`, el mismo que usan los permisos de Capsule (modo `restricted`: sin fila explicita no hay acceso).

Llamadas (`Core.SyncProject`, sin bloquear nunca la operacion original; se lanza en segundo plano):

1. `GET /orgs/{org}/teams/search?q=<nombre>&limit=50` (coincidencia exacta de nombre); si no existe, `POST /orgs/{org}/teams`
   `{"name":"<project>-admin","permission":"admin|write|read","includes_all_repositories":false,"can_create_org_repo":false,"units":["repo.code","repo.issues","repo.pulls","repo.releases"],"units_map":{"repo.code":"write",...},"description":"Managed by Capsule"}`
   (?: `units` / `units_map` / `permission` cambian entre versiones; el equipo admin envia `units_map` con `write` y `permission":"admin"`).
2. `PUT /teams/{id}/repos/{org}/{repo}` (asigna el repo al equipo).
3. `GET /teams/{id}/members?page=&limit=50` (estado actual de cada equipo).
4. Por cada miembro de la organizacion con rol efectivo: si ya esta en su equipo no se hace nada; si no, `GET /users/{login}` (404 = aun no ha entrado por OIDC) y `PUT /teams/{id}/members/{login}`.
5. Quien esta en un equipo sin corresponderle (cambio de rol, modo `restricted`, salio de la org) se quita con `DELETE /teams/{id}/members/{login}` (404 = ya no estaba).

El login de Forgejo es el `preferred_username` del claim OIDC (`oidc.SanitizeUsername(email)` con el sufijo de colision de `oidc.Service`).

Disparadores: alta/cambio/baja de rol de proyecto (`PUT/DELETE .../members/{userID}`), cambio de `project_access_mode` de la org, y alta/cambio de rol/baja de miembros de la org (se re-sincronizan todos los proyectos de la org), ademas de justo despues de aprovisionar.

Pendientes: usuarios con rol que aun no existen en Forgejo quedan en `git_team_sync (project_id, user_id, attempts, last_error, next_attempt_at)`; `Core.RunRetry` los reintenta cada 2 min (re-sincroniza el proyecto entero) y la fila desaparece cuando el usuario existe y esta en su equipo.
Capsule es la fuente de verdad: los miembros añadidos a mano en estos equipos se quitan en la siguiente sincronizacion.

Login OIDC first-party: el cliente se registra con `first_party=true` (sin pantalla de consentimiento) y redirect `https://git.tumi-ai.com/user/oauth2/capsule/callback`. Los grupos viajan en el claim `groups`:
`org:<slug>`, `org:<slug>:<rol>`, `project:<org>/<project>:<rol>`.

## c) Vistas de Git para el dashboard (permiso `ProjectRead`, cache en memoria de 20 s)

Funcionan con vinculos `forgejo`, `gitea` y `github`, con la credencial del vinculo (o el token de servicio para vinculos forgejo sin credencial y solo contra el host de `CAPSULE_GIT_URL`). Otro proveedor responde 422.

- `GET /orgs/{o}/projects/{p}/git/branches` -> `{"data":[{"name","sha","default","protected"}]}` (Forgejo/Gitea: `GET /repos/{o}/{r}/branches` y `GET /repos/{o}/{r}` para `default_branch`).
- `GET .../git/commits?branch=&page=` -> `{"data":[{"sha","short_sha","message","author","authored_at","url","deployment":{"id","status"}|null}],"page":n,"has_more":bool}`
  (`GET /repos/{o}/{r}/commits?sha=<rama>&page=&limit=30`; `has_more` sale de `X-HasMore` o de `Link rel="next"`; `message` es la primera linea; `deployment` une por `git_sha` con los ultimos 100 despliegues del proyecto).
- `GET .../git/pulls?state=open|closed|all` -> `{"data":[{"number","title","author","state","head_ref","base_ref","url","preview":{"url","status","expires_at"}|null}]}`
  (`GET /repos/{o}/{r}/pulls?state=`; hasta 50; `preview` une con los previews del proyecto).

## d) Previews por API (CI sin webhook)

- `POST /orgs/{o}/projects/{p}/previews` `{"pr":int,"ref":"...","sha":"..."}` (permiso `ProjectDeploy`; `ref` con la sanitizacion de ramas de `gitsource`, `sha` opcional hex) -> `{"pr","url","status","deployment_id"}`:
  `201` si crea, `200` si actualiza, `202` (status `building`, `deployment_id` null) si el build tarda mas de 25 s y sigue en segundo plano. Requiere vinculo git con `preview_enabled=true`; reutiliza `service.GitService.HandlePullRequest`.
- `DELETE /orgs/{o}/projects/{p}/previews/{pr}` -> `204` (`404` si no existe).
- Un token con scope `deploy` del proyecto PADRE puede hacer `GET`/`POST` de `.../previews` y `DELETE .../previews/{pr}` (allow-list en `middleware/scope.go`). Nada mas del vinculo git (`/git`, `/git/repo`, vistas) esta permitido a ese token.

## e) CLI

`capsule git remote` imprime la URL de clonado: `clone_url_https` / `clone_url_ssh` de `GET .../git` (tambien incluye `web_url`) cuando el proveedor es forgejo.
Para HTTPS el usuario usa un token personal de Forgejo; el SSH usa las llaves que el usuario suba en Forgejo.

## Cuenta bot para la sesion web (jobs, logs, cancelar, re-ejecutar, artefactos)

La API REST de Forgejo 15.0.11 **no tiene** endpoints para los trabajos de un run, los logs de un job, cancelar, volver a ejecutar ni listar artefactos (`/api/v1/repos/{o}/{r}/actions/runs/{id}/{jobs,artifacts,rerun,cancel}` devuelven 404). Su interfaz web si lo hace, con rutas internas que exigen **sesion** (cookie): rechazan token y Basic auth. Por eso el backend inicia sesion web como `capsule-bot` con su contrasena y llama a esas mismas rutas (todo en `backend/internal/gitcore/websession.go`).

Crear la cuenta (una vez, en el servidor de Forgejo; si `capsule-bot` ya existe solo hay que fijarle contrasena):

```
forgejo admin user create --admin --username capsule-bot --email capsule-bot@<dominio> --random-password --must-change-password=false
forgejo admin user change-password --username capsule-bot --password '<contrasena larga y aleatoria>' --must-change-password=false
```

Requisitos de la cuenta: **sin 2FA** (la sesion web no puede completarlo), sin `must-change-password`, y administrador del sitio (o miembro de los equipos con escritura en Actions de cada repositorio: sin ello cancelar y re-ejecutar dan 403). Guarda la contrasena como secreto de plataforma (`CAPSULE_GIT_BOT_PASSWORD`); rotarla es cambiarla en Forgejo y en el entorno del backend (la sesion se renueva sola).

Que cubre, probado contra Forgejo 15.0.11 + forgejo-runner 13.2.1 (`backend/internal/gitcore/itest/web_test.go`, workflow en `deploy/forgejo/workflows/web-smoke/multi.yml`):

| Funcion | Ruta web interna usada | Notas |
|---|---|---|
| Listar jobs y pasos de un run | `POST /{o}/{r}/actions/runs/{n}/jobs/{i}` (+ `/attempt/{k}` para pasos y logs) | `{n}` es el numero del run en el repo, no su id. No expone `runs-on` ni `needs`: quedan vacios, no inventados. |
| Logs de un job | misma ruta con `logCursors` por paso | El backend guarda el log por paso en memoria (max. 64 jobs, 8 MiB cada uno) y en cada consulta solo pide a Forgejo las lineas nuevas (cursor real). Un re-run (nuevo intento) reinicia el log. |
| Cancelar | `POST .../runs/{n}/cancel` | |
| Re-ejecutar | `POST .../runs/{n}/rerun`; solo fallidos: `POST .../runs/{n}/jobs/{i}/rerun` por cada job fallido o cancelado | Forgejo reutiliza **el mismo run** (nuevo intento): la respuesta lleva el mismo `id`. Sin sesion web, el re-run completo cae a `workflow_dispatch` (run nuevo, solo workflows que lo declaren) y "solo fallidos" da 501. |
| Artefactos | `GET .../runs/{n}/artifacts`; descarga `GET .../runs/{id}/artifacts/{nombre}` (esta ultima usa el **id**) | `download_url` es la URL web de Forgejo (requiere sesion de Forgejo); el backend ya sabe descargar el zip (`gitcore.DownloadArtifact`) pero no hay ruta publica que lo sirva. Sin fecha de expiracion (la web no la da). |

**Fragilidad**: son rutas internas sin documentar; pueden cambiar en cualquier version de Forgejo. Por eso solo se usan con las versiones de `CAPSULE_GIT_WEB_VERSIONS`, cada respuesta se valida y una forma inesperada es un error `502` que lo dice. **Antes de subir `GIT_VERSION`** corre el test de humo y, si pasa, anade la version nueva a `CAPSULE_GIT_WEB_VERSIONS`:

```
GITCORE_WEB_URL=https://git... GITCORE_WEB_TOKEN=... GITCORE_WEB_BOT_PASSWORD=... GITCORE_WEB_REPO=owner/repo \
  go test -tags=forgejo -run TestForgejoWebSession -v ./internal/gitcore/itest
```

**Limite conocido del enmascarado**: el runner 13.2.1 quita la linea `::add-mask::` del log, asi que el re-enmascarado de Capsule no llega a conocer el valor y no atrapa una forma *transformada* del secreto (p. ej. base64) impresa por el job; los valores literales si se enmascaran (los oculta el runner y, de nuevo, Capsule).

## Seguridad de la integracion

- `CAPSULE_GIT_TOKEN` solo en el backend; los errores visibles (`last_error`, logs) lo enmascaran. Webhook y token de servicio no comparten secreto.
- `GIT_WEBHOOK_ALLOWED_HOSTS=external,private` (en Forgejo) permite que llame al backend por la red interna; si el backend esta solo en `api.tumi-ai.com` publico, basta `external`.
- `/hooks/git/{projectID}` valida la firma antes de interpretar el cuerpo, limita el tamaño y responde 2xx rapido (ya existente).
- Forgejo no ve nunca variables de entorno de proyectos; el codigo se descarga con el token de servicio y los PR de forks no se construyen.

## Borde de acceso: `GET /internal/git-auth` (lo implementa A7; Caddy lo consume)

Caddy (`deploy/forgejo/Caddyfile`) llama a este endpoint con `forward_auth` solo para rutas del protocolo Git por HTTP (`info/refs`, `git-upload-pack`, `git-receive-pack`, `HEAD`, `objects/*`, `info/lfs/*`) que traen `Authorization`. El backend NO debe publicarse en el dominio publico de Git ni en `api.tumi-ai.com/internal/*`: solo es alcanzable por la red interna (`backend:8080`).

Peticion (siempre `GET`, sin cuerpo): cabeceras originales del cliente incluida `Authorization: Basic base64(usuario:credencial)`, mas `X-Forwarded-Method`, `X-Forwarded-Uri` (ruta y query originales, p. ej. `/evvg/web.git/info/refs?service=git-upload-pack`), `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`. La URI de la propia llamada es `/internal/git-auth` mas la query original (el endpoint debe ignorarla; el stub de pruebas la ignora). El repo de destino se deduce de `X-Forwarded-Uri` (`/{org}/{repo}[.git]/...`) y el permiso exigido de la accion (`git-receive-pack`/`service=git-receive-pack` = escritura; lo demas = lectura).

Caddy envia ademas `X-Capsule-Git-Auth: <CAPSULE_GIT_AUTH_SECRET>`; el backend responde `503` si falta o no coincide. Tras un `200` con `X-WEBAUTH-USER`, Caddy quita `Authorization` de la peticion hacia Forgejo; con un `200` sin esa cabecera la peticion (y su `Authorization`) pasa intacta. Un cliente que envie `X-Amzn-Trace-Id` recibe el rechazo del backend (Caddy no lo borra ni lo anade).

| Caso | Respuesta del backend | Efecto en Caddy / Forgejo |
|---|---|---|
| Sin Basic, o la contrasena no empieza por `cgt_` | `200` sin `X-WEBAUTH-USER` | Forgejo autentica por su cuenta (tokens OAuth2/otros) o responde 401 |
| `cgt_` valido, con permiso sobre el repo y la accion | `200` + `X-WEBAUTH-USER: <login de Forgejo>` | Caddy lo renombra a `GIT_AUTH_HEADER` (por defecto el mismo nombre) y Forgejo trata la peticion como ese usuario |
| `cgt_` desconocido, caducado, revocado o sin permiso | `401` (o `403`) con `WWW-Authenticate: Basic realm="Git Capsule"` y cuerpo corto sin datos internos | Caddy devuelve la respuesta tal cual; Forgejo no se entera |
| Demasiados intentos desde la IP | `429` con `Retry-After` | Se propaga al cliente |
| El backend no responde | (sin respuesta) | Caddy devuelve 502/503: falla cerrado, nunca se sigue sin validar |

Reglas: el login que devuelve debe ser un usuario YA existente en Forgejo (el autoregistro por proxy esta apagado: `ENABLE_REVERSE_PROXY_AUTO_REGISTRATION=false`; si no existe, Forgejo responde 401/404); nunca debe devolver `X-WEBAUTH-EMAIL` ni `X-WEBAUTH-FULLNAME` (Caddy los borra y Forgejo no los usa sin autoregistro); no se registran ni la cabecera `Authorization` ni el token en logs; el limite de tasa por IP y por token vive aqui (Caddy estandar no limita; ver README 12.2). `ENABLE_REVERSE_PROXY_AUTHENTICATION_API=false`: la API de Forgejo no acepta la cabecera, el backend sigue usando el token de servicio con `Sudo`.

Verificado contra Forgejo 15.0.11 real: con `ENABLE_REVERSE_PROXY_AUTHENTICATION=true`, `git clone` y `git push` por HTTP autentican con la cabecera; Forgejo la acepta de cualquier origen que llegue a `git:3000` (README 12.2: aislamiento de red y nombre secreto).
