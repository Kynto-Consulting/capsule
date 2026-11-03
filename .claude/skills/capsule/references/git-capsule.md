# Git Capsule: clonar, ramas, PR, revisión, merge, protección

Git Capsule = Git, revisión, CI y seguridad de Capsule. Motor: Forgejo en `git.tumi-ai.com`. **Capsule decide
identidad (OIDC), permisos (viewer/deployer/admin -> equipos de Forgejo sincronizados), despliegues y
aprobaciones; Forgejo guarda y fusiona.** Los repos se ven también en el dashboard
(`app.tumi-ai.com/git/{org}/{repo}`); la web de Forgejo es respaldo. Issues, wiki, proyectos y packages están
ocultos a propósito.

Cada proyecto tiene su repo `ORG/PROJECT` (org = slug de la organización, repo = slug del proyecto), creado
al crear el proyecto. Estado: `capsule git repo view` (`status`: pending|ready|failed, URLs de clonado).
Proyecto antiguo sin repo: `capsule git repo create [--import-url https://...]` (exige permiso de operaciones del proyecto). Estado del motor:
`capsule git status`.

## Clonar y autenticarse: dos caminos

### 1. `capsule git clone` (recomendado)

```bash
capsule login ...                           # sesión (pídela al usuario si no hay)
capsule git clone ORG/REPO [DIR] [-- --depth 1]   # alias: capsule repo clone [ORG/REPO]; sin argumento clona el repo del proyecto enlazado
capsule git clone ORG/REPO --ssh            # por SSH en vez de HTTPS
capsule git clone ORG/REPO --local          # helper solo en ese repo, no global
capsule git login [--status]                # comprueba sesión, configura el helper (idempotente); --status lista repos con token vigente
```

Qué hace: exige sesión (exit 3 si falta), escribe en `git config` (global salvo `--local`)
`credential.https://git.tumi-ai.com.helper = !capsule git credential` y `useHttpPath=true`, y clona la URL HTTPS
**sin credenciales**. El helper pide a Capsule un token `cgt_` **de ~1 h, de un solo repo, `write` o `read` según tu
rol**, lo renueva solo, nunca lo escribe a disco ni a `.git/config`. Luego `git pull/push` funcionan con git normal
mientras viva la sesión. `capsule logout` revoca esos tokens. Con un token `cap_` en `CAPSULE_TOKEN` también
funciona (no con uno de alcance `deploy`: 403). Con `cgt_` en `CAPSULE_TOKEN` el CLI lo rechaza (exit 2).

### 2. HTTPS con `git` normal (sin CLI de Capsule)

```bash
git clone https://git.tumi-ai.com/ORG/REPO.git
```

La contraseña HTTPS es un token `cgt_` (usuario = tu login de Forgejo). Dos fuentes:
- **Token personal**: `capsule git tokens create --name ci-local --scope read --repo ORG/REPO --expires 30d`
  (scope `read|write`, 1-90 d; el valor se muestra una vez). `capsule git tokens list|revoke ID`.
- **Git Credential Manager** (navegador, OAuth de Forgejo con login por Capsule): `capsule git setup-gcm
  --client-id <ID>` escribe las claves OAuth. Alcance amplio (los derechos del usuario en Forgejo) y no
  lo gobierna Capsule: **no lo uses con cuentas admin**; para servidores sin navegador usa token o SSH.

No pegues el token en la URL, ni en `.git/config`, ni en el chat: deja que Git lo pida, o usa `GIT_ASKPASS` leyendo
una variable de entorno.

### 3. SSH

```bash
capsule git ssh-keys add --title portatil --key-file ~/.ssh/id_ed25519.pub   # (por defecto ~/.ssh/id_ed25519.pub)
capsule git ssh-keys list ; capsule git ssh-keys remove ID -y
git clone git@git.tumi-ai.com:ORG/REPO.git      # o: capsule git remote --ssh  /  capsule git clone ORG/REPO --ssh
```

SSH en `git.tumi-ai.com:22`. Solo clave **pública** va a Capsule; nunca subas ni imprimas la privada. Si Capsule
cae, SSH sigue funcionando (HTTPS depende de Capsule para autenticar).

### CI y runners: nunca la sesión de un humano

- Checkout en Actions: el token por ejecución que crea Forgejo.
- Push/lecturas de otros repos desde CI: **token de servicio** (no ligado a una persona, un repo, 1-90 d):
  `capsule git service-tokens create --name ci --scope read|write --expires 90d` -> guárdalo como secreto de CI
  (`printf %s "$T" | capsule ci secrets set GIT_SERVICE_TOKEN`). `service-tokens list|revoke ID`.
- Un runner no tiene `capsule login` ni monta `~/.capsule`.

## Vincular un repo externo (GitHub, Forgejo, Gitea, genérico)

```bash
printf %s "$GIT_TOKEN" | capsule git link --provider forgejo --repo-url https://git.ejemplo.com/acme/app \
    --branch main --auto-deploy --previews --preview-max 5 --preview-ttl-hours 72 --token-stdin
capsule git show | test | remote [--ssh] | unlink -y
```
Autenticación: `--token-stdin` o `--ssh-key-file` (jamás por argv); las credenciales son de solo escritura (`show` no las
devuelve); `--rotate-webhook-secret` genera otro secreto de webhook (se muestra una vez). Con auto-deploy y
previews activos, cada PR obtiene preview sin workflow. `capsule git import github --repos O/N --token-stdin`
importa repos de GitHub; `capsule git mirror set|show|sync|remove` espeja a otro servidor (credencial por stdin;
**sale código privado a un tercero: confirma con el usuario**).

## Leer el repo sin clonar

```bash
capsule git branches ; capsule git commits [--branch b --page n] ; capsule git commits show SHA ; capsule git commits checks SHA
capsule git tree [PATH] [--ref R] ; capsule git cat PATH [--ref R] ; capsule git compare BASE HEAD
capsule git tags list|create NAME --target SHA -m "msg"|delete NAME -y
capsule git codeowners [--ref R] ; capsule git activity ; capsule git insights --since 30d
```
Alias: `capsule repo ls|cat|view|create|clone`.

## Ramas

```bash
capsule branch list                         # con protección y ahead/behind
capsule branch create fix/plazos --from main
capsule branch delete fix/plazos -y         # una protegida o la por defecto se rechaza con exit 5
```
Nombres con `/` válidos. Borrar una rama con PR abierto cierra el PR: avisa antes. Cambiar la rama por defecto:
`capsule git repo settings --default-branch X` (admin).

## Pull requests

```bash
capsule pr create --title "fix: valida plazo" --body-file desc.md [--base main] [--head rama] [--draft] [--reviewer ana,luis]
capsule pr list [--state open|closed|merged|all] [--author @me] [--base main] ; capsule pr status
capsule pr view 12 [--comments]            # checks, revisiones y BLOQUEOS en un solo lugar
capsule pr diff 12 | files 12 | commits 12 | co 12
capsule pr edit 12 --title ... --body-file ... --base ... ; capsule pr ready 12 ; capsule pr close 12 ; capsule pr reopen 12
capsule pr checks 12 [--required] --watch --wait 15m --exit-status     # exit 6 si falla
capsule pr update-branch 12 --wait
```

### Revisión

```bash
capsule pr request-review 12 --user ana,luis [--team legal]
capsule pr review 12 --approve -b "OK"
capsule pr review 12 --request-changes -b "Falta test"
capsule pr review 12 --comment --file src/db.ts:41:"usa parámetros preparados" [--commit SHA]
capsule pr comment 12 -b "texto"            # o --body-file f
capsule pr dismiss-review 12 REVIEW_ID --reason "obsoleta"    # admin
```
Quien abrió el PR **no cuenta** para el mínimo de aprobaciones (`SELF_APPROVAL_FORBIDDEN`). No te apruebes a ti
mismo ni pidas a otro agente que lo haga para saltar la regla. Comentar/revisar: deployer y admin; viewer solo lee.

### Merge

```bash
capsule pr merge 12 --squash [--delete-branch] [--title T --message M] [--head-sha SHA]
capsule pr merge 12 --merge | --rebase | --ff        # estilos: merge (por defecto), squash, rebase, fast-forward
capsule pr merge 12 --squash --auto                  # auto-merge: se fusiona sola cuando pasen checks y reglas
capsule pr merge 12 --disable-auto                   # cancela el auto-merge
```
- `--head-sha` evita fusionar un cabezal que cambió (409 -> exit 9).
- Estilos permitidos por repo: `capsule git repo settings --merge-styles squash,rebase [--delete-branch-on-merge]`.
  Un estilo no permitido se rechaza.
- Por qué no se puede fusionar: `capsule pr view N` lista los bloqueos: `CHECKS_REQUIRED`, `REVIEWS_REQUIRED`,
  `CODEOWNER_REQUIRED`, `CONFLICTS`, `BRANCH_OUT_OF_DATE`, `POLICY_BLOCKED` (seguridad), `DRAFT`,
  `SIGNATURE_REQUIRED`, `APPROVAL_REQUIRED`. Exit 5 = bloqueado por regla: **resuelve la causa**, no la regla.
- Fusionar exige rol deployer/admin y lo que permita la regla de la rama (`--merge-roles`).

## Ramas protegidas

```bash
capsule git protect list
capsule git protect evaluate --branch release/1.2        # qué regla aplica y por qué
capsule git protect set main --require-pr --approvals 1 --checks "ci / test" --codeowners \
      --no-force-push --no-delete --block-on-security --dismiss-stale --block-rejected
capsule branch protect main [mismos flags] ; capsule branch unprotect main -y ; capsule git protect remove PATTERN -y
```
Flags de `protect set` (verificados): `--require-pr`, `--approvals N` (0-10), `--checks ctx1,ctx2` (globs),
`--codeowners`, `--dismiss-stale`, `--block-rejected`, `--up-to-date`, `--linear`, `--signed`,
`--block-on-security`, `--no-force-push|--allow-force-push`, `--no-delete|--allow-delete`,
`--delete-branch-on-merge`, `--enforce-admins`, `--push-roles admin,deployer`, `--merge-roles admin,deployer`.
Reglas: el patrón sin glob gana sobre el que tiene glob; `enforce_admins` aplica la regla también a admins; no hay
bypass silencioso. **Quitar o relajar una protección requiere confirmación del usuario y queda en auditoría.**
Los contextos de check disponibles: los de tus workflows más `capsule/preview`, `capsule/security`, `capsule/policy`,
`capsule/env:<nombre>`.

Configuración recomendada para `main` de un proyecto productivo: `--require-pr --approvals 1 --codeowners
--checks "ci / test" --no-force-push --no-delete --block-on-security --dismiss-stale`.

## Previews, webhooks Git y auto-deploy

`capsule git previews list|create --pr N --ref R --sha S|delete N` (igual que `capsule previews ...`). El webhook
`/hooks/git/{projectID}` lo registra Capsule al aprovisionar y valida firma HMAC; no lo toques.

## Errores típicos de Git

| Síntoma | Causa | Qué hacer |
|---|---|---|
| exit 3 al clonar | sin sesión | `capsule login` (usuario) o token `cap_` |
| exit 4 | sin rol en el proyecto, o repo inexistente | `capsule members list`; pedir rol al admin |
| exit 7 `GIT_NOT_READY` | repo aún aprovisionándose, Forgejo caído o repo huérfano | `capsule git repo view`, `capsule git status`; esperar o avisar |
| `git push` rechazado a `main` | rama protegida | rama + PR; no quites la protección |
| `could not read Password` | helper no configurado | `capsule git login` |
| 403 al pedir credenciales con token `cap_` | token con alcance `deploy` | usar sesión humana o token con otro alcance autorizado por el usuario |
