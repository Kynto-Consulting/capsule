# Forgejo (git.tumi-ai.com) como servicio del nucleo de Capsule

Runbook para montar un Git propio. Forgejo NO es un proyecto de Capsule: es un servicio del nucleo, igual que
`backend`, `frontend` y `redis`, definido en `docker-compose.prod.yml` (servicios `git`, `git-proxy` y `git-backup`).

Nada de lo descrito aqui se ha aplicado ni ejecutado todavia. Cada paso con comandos esta para correrse a mano,
en este orden, y cada uno trae su verificacion.

## 0. Arquitectura (plan B, sin NLB ni costo extra)

```
Navegador / git https --> git.tumi-ai.com:443 --> Caddy (git-proxy, Let's Encrypt HTTP-01) --> git:3000 (red capsule-net)
git ssh               --> git.tumi-ai.com:22  --> contenedor git :22      (host 22:22)
Administracion del servidor: ssh -p 2200 (se mueve desde el 22)
Login: Capsule (OIDC)   CI: runners en una EC2 aparte, sin ingreso (seccion 8)
```

- `git`: imagen oficial `codeberg.org/forgejo/forgejo` con version FIJADA (`GIT_VERSION`, por defecto 15.0.11; verifica que el tag
  existe con `docker manifest inspect codeberg.org/forgejo/forgejo:15.0.11`), volumen `capsule-git-data` (SQLite + repos), 768 MB de
  memoria, `restart: always`. No publica el 3000 en el host.
- `git-proxy`: Caddy 2.11.7, puertos 80 y 443 del host, estado en el volumen `capsule-git-caddy`, `deploy/forgejo/Caddyfile`.
- `git-backup`: servicio auxiliar (profile `backup`, no arranca con `up -d`) que ejecuta `forgejo dump`.
- Memoria: el host es un t3.medium (4 GB) con ~10 contenedores. Forgejo (768 MB) + Caddy (128 MB) cuestan ~0.9 GB. Revisa `free -m`
  antes y despues (seccion 5). Si queda justo, sube la instancia antes de activar CI; el CI NO corre aqui.

### Variables del `.env` del servidor

| Variable | Obligatoria | Uso |
|---|---|---|
| `GIT_VERSION` | no (15.0.11) | tag de la imagen de Forgejo |
| `GIT_DOMAIN` | no (git.tumi-ai.com) | dominio de Forgejo y de Caddy |
| `GIT_ROOT_URL` | no (https://git.tumi-ai.com/) | URL publica |
| `GIT_SSH_PUBLIC_PORT` | no (22) | puerto SSH que Forgejo anuncia en las URL de clonado |
| `GIT_ENABLE_INTERNAL_SIGNIN` | no (false) | `true` SOLO durante una emergencia (seccion 7) |
| `GIT_WEBHOOK_ALLOWED_HOSTS` | no (external,private) | destinos permitidos de webhooks; `private` permite `api.tumi-ai.com` por la red interna |
| `GIT_AUTH_HEADER` | recomendada | nombre SECRETO de la cabecera de confianza que Caddy pone y Forgejo lee (`X-GC-` + 16 hex aleatorios; seccion 12.2). Por defecto `X-WEBAUTH-USER` |
| `CAPSULE_GIT_AUTH_SECRET` | si (con A7) | secreto compartido entre `git-proxy` (cabecera `X-Capsule-Git-Auth`) y el backend; aleatorio de >= 32 bytes; sin el `/internal/git-auth` responde 503 |
| `GIT_PROXY_TRUSTED_CIDRS` | no (172.16.0.0/12) | redes desde las que Forgejo acepta `X-Forwarded-For` (solo IP de cliente en los registros; NO controla quien puede enviar la cabecera de autenticacion) |
| `GIT_ACME_EMAIL` | si | correo de Let's Encrypt (avisos de caducidad) |
| `GIT_BACKUP_BUCKET` | si (para respaldos) | salida `forgejo_backups_bucket_name` de Terraform |
| `GIT_BACKUP_PASSPHRASE` | si (para respaldos) | frase de cifrado del dump (guardala tambien fuera del servidor) |
| `GIT_BACKUP_AWS_ACCESS_KEY_ID` / `GIT_BACKUP_AWS_SECRET_ACCESS_KEY` | si (para respaldos) | llave del usuario IAM `capsule-forgejo-backup` |

Compose interpola todas las variables de todos los servicios incluso con `run`, por eso las `GIT_BACKUP_*` deben estar definidas
antes de usar `docker compose run` con `git-backup` (tambien lo usan los comandos de administracion de la seccion 6).

Configuracion de Forgejo (`FORGEJO__seccion__CLAVE`, en el compose): SSH del contenedor activo, `INSTALL_LOCK=true`, registro
deshabilitado, login con contrasena deshabilitado (`ENABLE_INTERNAL_SIGNIN=false`), `REQUIRE_SIGNIN_VIEW=true`,
`oauth2_client.ENABLE_AUTO_REGISTRATION=true`, `ACCOUNT_LINKING=disabled` (NO `auto`: vincular por email solo es seguro si Capsule
garantiza email verificado y unico; hoy no se asume), repositorios privados por defecto, Actions habilitadas, correo deshabilitado.
`SECRET_KEY` e `INTERNAL_TOKEN` los genera Forgejo en el primer arranque y quedan en el volumen (por eso el volumen se respalda cifrado).

## 1. Infraestructura (Terraform, solo plan)

```bash
cd deploy/terraform
terraform fmt -check && terraform validate
terraform plan -var git_enabled=true -var 'admin_ssh_cidrs=["<tu-ip>/32"]'
```

`git.tf` (con `git_enabled=true`) anade REGLAS NUEVAS al SG `app` (el SG tiene `ignore_changes = [ingress]`, sus reglas inline no se tocan):
80/tcp y 443/tcp desde `0.0.0.0/0` (Caddy) y 2200/tcp desde `admin_ssh_cidrs` (administracion). El 22/tcp abierto al mundo YA existe
inline en `security_groups.tf`; a partir de ahora ese 22 es el SSH publico de Forgejo, no el de administracion.
Recomendacion: pon en `admin_ssh_cidrs` solo tus IP (el SSH es solo por llave, pero asi se reduce ruido y superficie).
`forgejo.tf` crea el bucket de respaldos y el usuario IAM. Cuando decidas aplicar (no lo hace este runbook):
`terraform apply -var git_enabled=true -var 'admin_ssh_cidrs=[...]'`.

Despues crea la llave del usuario de respaldos (no la crea Terraform para no dejarla en el state):
`aws iam create-access-key --user-name capsule-forgejo-backup` y ponla en el `.env` del servidor.

## 2. Mover el SSH de administracion del 22 al 2200 (sin quedarte fuera)

El 22 del host debe quedar libre para Forgejo. Script: `deploy/forgejo/move-admin-ssh.sh` (en el servidor, con la sesion actual abierta todo el rato).

1. Abre 2200 en el SG (seccion 1; si prefieres solo la regla: `terraform apply -var git_enabled=true -target=aws_security_group_rule.git_admin_ssh -target=aws_security_group_rule.git_http -target=aws_security_group_rule.git_https`).
2. `sudo ./move-admin-ssh.sh add` : guarda copia en `/etc/ssh/sshd_config.pre-2200`, declara `Port 22` y `Port 2200`, valida con `sshd -t` y recarga. Si SELinux esta en Enforcing registra el puerto (`semanage port -a -t ssh_port_t -p tcp 2200`; AL2023 normalmente no lo necesita).
3. Desde OTRA terminal: `ssh -p 2200 -i <llave> ec2-user@<IP-elastica>` debe entrar. No sigas si no entra.
4. `sudo ./move-admin-ssh.sh finish` (pide confirmacion): quita `Port 22`, `sshd -t` y recarga.
5. Actualiza tu `~/.ssh/config` (`Port 2200`) y cualquier script/CI que use el 22 (Capsule usa SSM o docker local; revisa si algun proceso hace SSH al host).

Reversa: `sudo ./move-admin-ssh.sh rollback` restaura la copia. Si perdieras el acceso: SSM Session Manager (rol `builder_ssm`) o
reabrir el 22 en el SG y restaurar `sshd_config` desde la consola. Mientras el sshd del host use el 22, el contenedor `git`
no puede publicar `22:22` (fallaria el arranque): por eso este paso va ANTES de levantar Forgejo.

## 3. DNS (lo pone el usuario en Namecheap)

Un solo registro: `A  git  ->  <IP elastica del servidor>` (TTL Automatic). La IP sale de `terraform output builder_elastic_ip`
(la del coordinador es 3.224.61.221). Ya no hay CNAME de validacion de ACM. Verifica: `dig +short git.tumi-ai.com`.
Caddy solo podra emitir el certificado cuando ese A resuelva y el 80 este abierto.

## 4. Cliente OIDC en Capsule

El proveedor OIDC lo construye otro agente. Contrato (a confirmar contra el backend):

```http
POST https://api.tumi-ai.com/api/v1/oauth/clients
Authorization: Bearer <token de admin de plataforma>
{ "name": "Forgejo", "redirect_uris": ["https://git.tumi-ai.com/user/oauth2/capsule/callback"], "first_party": true }
-> 201 { "client_id": "...", "client_secret": "..." }     (el secreto se muestra una sola vez)
```

`first_party: true` = sin pantalla de consentimiento. Discovery esperado: `https://api.tumi-ai.com/.well-known/openid-configuration`
con los scopes `openid profile email groups` y el claim `groups` (formato en la seccion 6). Guarda `client_id` y `client_secret` en un gestor de secretos.

## 5. Levantar el servicio

```bash
cd <carpeta del compose en el servidor>
free -m                                   # memoria antes
docker compose -f docker-compose.prod.yml config -q          # valida el compose con tu .env
docker compose -f docker-compose.prod.yml up -d git git-proxy
docker compose -f docker-compose.prod.yml logs -f git-proxy  # espera "certificate obtained successfully"
free -m                                   # memoria despues (el contenedor git esta limitado a 768m)
curl -sS https://git.tumi-ai.com/api/healthz
```

Verificacion: el healthz responde `pass`; `curl -sI http://git.tumi-ai.com` redirige a https; `ssh -T -p 22 git@git.tumi-ai.com` responde
(con clave no registrada, rechazo esperado, no timeout); `docker inspect capsule-git --format '{{.HostConfig.Memory}}'` = 805306368.
Si falla el certificado: DNS (seccion 3), puerto 80 en el SG, `docker compose logs git-proxy`. Caddy renueva solo; el estado vive en `capsule-git-caddy`
(no lo borres: Let's Encrypt limita emisiones por dominio).

## 6. Fuente de autenticacion, primer admin y grupos

Primero comprueba los flags reales de la version instalada (no los des por supuestos):

```bash
docker compose -f docker-compose.prod.yml exec -u git git forgejo admin auth add-oauth --help
```

Registro de la fuente (idempotente) con el script del repo, que lee el secreto del entorno y no de argv:

```bash
docker compose -f docker-compose.prod.yml stop git     # opcional: evita escribir la base de SQLite a la vez
docker compose -f docker-compose.prod.yml --profile backup run --rm --no-deps \
  -e OIDC_CLIENT_ID=<client_id> -e OIDC_CLIENT_SECRET=<client_secret> \
  -e ADMIN_GROUP='org:<tu-org>:owner' \
  --entrypoint /usr/local/bin/forgejo-bootstrap.sh git-backup auth
docker compose -f docker-compose.prod.yml up -d git
```

El script ejecuta: `forgejo admin auth add-oauth --provider openidConnect --name capsule --key ... --secret ... --auto-discover-url https://api.tumi-ai.com/.well-known/openid-configuration --scopes "openid profile email groups" --group-claim-name groups [--admin-group ...] [--group-team-map ... --group-team-map-removal]`.
El nombre `capsule` fija el callback `https://git.tumi-ai.com/user/oauth2/capsule/callback`.

**Primer admin**: quien entre por Capsule con el grupo indicado en `--admin-group` (por ejemplo `org:<tu-org>:owner`) queda como administrador
de Forgejo. No se crea un admin local de uso diario.

**Admin de emergencia** (uso solo en emergencia): usuario local con token API, sin contrasena utilizable:

```bash
docker compose -f docker-compose.prod.yml --profile backup run --rm --no-deps \
  -e EMERGENCY_ADMIN_EMAIL=<correo> --entrypoint /usr/local/bin/forgejo-bootstrap.sh git-backup emergency-admin
```

Imprime el token una sola vez: guardalo fuera de linea (gestor de secretos / sobre sellado). Para entrar por la interfaz en una emergencia real:
`GIT_ENABLE_INTERNAL_SIGNIN=true` en `.env`, `docker compose ... up -d git`, restablece la contrasena del usuario de emergencia con
`forgejo admin user change-password`, y al terminar vuelve a `false` y rota el token. Activa 2FA en esa cuenta.

### Mapeo de grupos de Capsule a Forgejo

El claim `groups` trae: `org:<slug>` (miembro), `org:<slug>:<rol>` y `project:<org>/<project>:<rol>`.
`--group-team-map` es un JSON `{"<grupo>": {"<organizacion Forgejo>": ["<equipo>"]}}`; las organizaciones y equipos deben existir
(los crea el backend de Capsule, ver `INTEGRATION.md`). Convencion:

```json
{
  "org:evvg:owner":  {"evvg": ["Owners"]},
  "org:evvg:admin":  {"evvg": ["Owners"]},
  "org:evvg:member": {"evvg": ["members"]},
  "project:evvg/web:admin":    {"evvg": ["web-admin"]},
  "project:evvg/web:deployer": {"evvg": ["web-deployer"]},
  "project:evvg/web:viewer":   {"evvg": ["web-viewer"]}
}
```

Equipos por proyecto: `<project>-admin|deployer|viewer` con permiso write/write/read sobre el repo `<org>/<project>`. Los nombres exactos de
rol de Capsule deben confirmarse con el backend; en la practica el sincronizado lo hara el backend por API (INTEGRATION.md) y el mapa
del login solo sirve como respaldo. Se pasa con `GROUP_TEAM_MAP='<json>'` al script de la seccion 6.

## 7. Operacion normal

- Todo el acceso humano es por Capsule. Registro y login local estan deshabilitados.
- Activa 2FA en toda cuenta local que exista (la de emergencia) y exige firma/2FA en la politica de la organizacion cuando proceda.
- Tokens de servicio (`CAPSULE_GIT_TOKEN`, token de Renovate, token de issues): minimos, por cuenta de servicio, con rotacion.
- Contrasena de `capsule-bot` (`CAPSULE_GIT_BOT_PASSWORD`): solo para la sesion web que lee jobs, logs, cancela, re-ejecuta y lista artefactos de un run (la API REST de Forgejo 15.0.11 no tiene esos endpoints). Sin 2FA, solo en el backend; ver `INTEGRATION.md`, "Cuenta bot para la sesion web". Si no se configura, esas funciones responden 501 con el enlace a Forgejo.
- Actualizaciones: sube `GIT_VERSION` a un tag verificado, `docker compose ... pull git && docker compose ... up -d git`, tras un respaldo.

## 8. Ejecutores de CI aislados (Terraform, desactivado por defecto)

ADVERTENCIA: el CI ejecuta el codigo de los repositorios (incluidos PR) en la maquina del runner. Quien pueda abrir un PR puede ejecutar
codigo arbitrario ahi. Por eso va en una EC2 SEPARADA del servidor de Capsule (que tiene docker.sock, secretos y redes internas), sin
ningun ingreso (ni SSH: acceso por SSM), con IMDSv2 obligatorio y hop limit 1 (los contenedores de jobs no alcanzan las credenciales de la
instancia), un rol que solo tiene SSM y lectura de UN parametro, disco cifrado, egreso solo 80/443/53/123, reglas iptables que impiden a los
contenedores de jobs llegar al servicio de metadatos y a la VPC (salvo el DNS de la VPC), `privileged=false`, sin docker.sock en los jobs,
y limites `--memory/--cpus/--pids-limit`.

Pasos:

1. En Forgejo (admin del sitio): Administracion del sitio > Actions > Runners > crear token de registro. (CLI alternativo, verifica con `--help`: `forgejo forgejo-cli actions --help`.)
2. `aws ssm put-parameter --type SecureString --name /capsule/forgejo/runner-registration-token --value '<token>'`
3. Descarga la version fijada de `forgejo-runner` y calcula su checksum tu mismo, comparandolo con el publicado en https://code.forgejo.org/forgejo/runner/releases :
   `curl -fsSLO https://code.forgejo.org/forgejo/runner/releases/download/v13.2.1/forgejo-runner-13.2.1-linux-amd64 && sha256sum forgejo-runner-13.2.1-linux-amd64`
   (version 13.2.1 verificada: existe, no es prerelease; sha256 publicado y recalculado sobre lo descargado: bb369fe1ecb50fdc983c0b1d993f19b0920df6e5864511892b3cdbf16d858b34, ver `.sha256` junto al binario en la release).
4. `terraform plan -var ci_runner_enabled=true -var ci_runner_sha256=<sha256>` y, cuando decidas, `apply`. El default de `ci_runner_sha256` corresponde a 13.2.1; si cambias `ci_runner_version`, cambia tambien el sha256 (el arranque aborta si no coincide).
5. Tras el registro borra el parametro: `aws ssm delete-parameter --name /capsule/forgejo/runner-registration-token` (el runner guarda su identidad en `.runner`; el token es de un solo uso a efectos practicos).
6. Verificacion: `aws ssm start-session --target <ci_runner_instance_id>`; `systemctl status forgejo-runner`; el runner aparece en Forgejo con etiquetas `ci` y `node22`.
   Prueba de aislamiento: un job con `curl -m 3 http://169.254.169.254/` debe fallar, y `curl -m 3 http://<IP privada del servidor>:8080` tambien.

### Construir imagenes sin docker.sock

Montar `/var/run/docker.sock` en un job equivale a dar root del host. Aqui `docker_host: "-"` lo impide. Para construir imagenes en CI se usa
kaniko (`gcr.io/kaniko-project/executor`, como en `workflows/trivy.yml`) o buildah/BuildKit rootless. El compromiso: kaniko corre como root DENTRO de
su contenedor (sin privilegios del host) y mas lento que Docker con cache; el proyecto original esta archivado, vigila su sustituto. BuildKit rootless
pide `seccomp=unconfined`/`apparmor=unconfined`, que debilita el aislamiento; solo en un runner todavia mas dedicado. Para DESPLEGAR no hace falta construir
en CI: `capsule deploy` sube el codigo y Capsule construye en su builder.

### Siguiente paso: runner efimero (un runner por job)

Hoy los jobs comparten host y cache de Docker entre repos (un job malicioso puede envenenar la cache o dejar procesos). Evolucion: una instancia por
job (ASG con spot o Lambda lanzadora) que se registra con un token efimero, ejecuta `forgejo-runner one-job` (verifica la opcion con `--help`) y se destruye.
Requiere un lanzador que reciba el webhook de job en cola; no esta implementado.

## 9. Respaldos y restauracion

Que se respalda: `forgejo dump` (repositorios, base SQLite, `app.ini`, adjuntos) comprimido, cifrado con AES-256 en el servidor (`openssl enc -aes-256-cbc -pbkdf2`,
clave = `GIT_BACKUP_PASSPHRASE`) y subido a S3 con SSE-S3 al prefijo `forgejo/`. El bucket tiene versionado, bloqueo publico, TLS obligatorio y retencion de 30 dias
(lifecycle). El usuario IAM solo puede `PutObject` y listar el prefijo: no puede leer ni borrar respaldos anteriores.

Cron del host (`crontab -e` como el usuario que ejecuta docker), diario a las 03:17 Lima:

```cron
17 3 * * * cd /opt/capsule && docker compose -f docker-compose.prod.yml --profile backup run --rm git-backup >> /var/log/forgejo-backup.log 2>&1
```

Primera ejecucion a mano y verificacion: el comando anterior sin cron; debe terminar con `backup ok: s3://...`;
`aws s3 ls s3://<bucket>/forgejo/` (con credenciales de administrador) muestra el `.enc` y su `.sha256`. Alerta si no hay objeto de las ultimas 26 horas.
Antes del primer uso construye la imagen: `docker compose -f docker-compose.prod.yml --profile backup build git-backup`.

### Restauracion (ensayala en una maquina limpia antes del go-live; NO se ha ejecutado)

1. Descarga y verifica: `aws s3 cp s3://<bucket>/forgejo/<archivo>.tar.gz.enc . && aws s3 cp s3://<bucket>/forgejo/<archivo>.tar.gz.enc.sha256 . && sha256sum -c <archivo>.tar.gz.enc.sha256`
2. Descifra: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in <archivo>.tar.gz.enc -out dump.tar.gz && mkdir dump && tar -xzf dump.tar.gz -C dump`
3. Contenido esperado del dump: `app.ini`, `repos/`, `data/`, `forgejo-db.sql`, `custom/`.
4. Servicio detenido y volumen limpio: `docker compose -f docker-compose.prod.yml stop git` (para un ensayo, usa un volumen nuevo `capsule-git-data-test`).
5. Con un contenedor temporal montando el volumen y la carpeta `dump` (imagen de Forgejo + `apk add sqlite`):
   `mkdir -p /data/gitea/conf /data/git/repositories && cp dump/app.ini /data/gitea/conf/app.ini && cp -a dump/repos/. /data/git/repositories/ && cp -a dump/data/. /data/gitea/ && rm -f /data/gitea/forgejo.db && sqlite3 /data/gitea/forgejo.db < dump/forgejo-db.sql && chown -R 1000:1000 /data`
   (rutas internas segun tu version; comparalas con `docker compose exec git ls /data /data/gitea`).
6. `docker compose -f docker-compose.prod.yml up -d git`, luego `docker compose exec -u git git forgejo admin regenerate hooks` y `forgejo doctor check --all`.
7. Verifica: login por Capsule, listado de repos, `git clone` de uno, ultimos commits presentes, runner conectado.
8. Anota fecha, duracion y resultado del ensayo en el CHECKLIST.

## 10. Verificacion final y rollback

Verificacion: healthz OK; certificado valido (`curl -vI https://git.tumi-ai.com 2>&1 | grep -i "expire"`); login OIDC con un usuario de prueba (primer inicio crea
la cuenta; si dice "registro deshabilitado", cambia `FORGEJO__service__DISABLE_REGISTRATION=false` y anade `FORGEJO__service__ALLOW_ONLY_EXTERNAL_REGISTRATION=true`
en el compose: no se ha podido verificar cual combinacion exige tu version); `git clone` por https con token y por ssh; un workflow de ejemplo corre en el runner.

Rollback (en este orden, cada paso es independiente): `docker compose ... stop git git-proxy` (los demas servicios no se tocan);
`terraform apply -var git_enabled=false` (retira las reglas 80/443/2200);
`sudo ./move-admin-ssh.sh rollback` si hace falta el 22 del host de vuelta (antes `docker compose ... rm -f git`);
borra el registro A de `git`; el volumen `capsule-git-data` se conserva hasta que lo borres a mano (`docker volume rm capsule-git-data`) tras un respaldo.

## 11. Piezas relacionadas

- `workflows/`: plantillas de compuertas (gitleaks, ci-node, deps, terraform, trivy, sast, dependency-updates, security-audit, capsule-deploy). CodeQL y Dependabot NO existen fuera de GitHub:
  los sustituyen `sast/` (Semgrep OSS + reglas propias + gosec/Bandit/eslint-security) y `renovate/` (Renovate autoalojado) + `security-audit.yml` (osv-scanner con issue unico).
- `renovate/README.md`, `sast/README.md`, `INTEGRATION.md` (contratos con el backend), `CHECKLIST.md` (seguridad previa al go-live).

## 12. Tema Git Capsule y borde de acceso (paquete A3)

Nada de esto se ha desplegado. Lo verificado y lo no verificado esta en 12.6.

### 12.1 Como se aplica la personalizacion en el servidor

La imagen oficial fija `GITEA_CUSTOM=/data/gitea`. `docker-compose.prod.yml` (servicio `git`) monta, de solo lectura, dos carpetas del repo dentro de ese directorio:

| Repo | Contenedor | Contenido |
|---|---|---|
| `deploy/forgejo/custom/templates/` | `/data/gitea/templates` | `custom/header.tmpl` (carga el CSS), `custom/extra_links.tmpl` (enlace "Volver a Capsule" en la barra), `custom/extra_links_footer.tmpl` (pie), `user/auth/signin.tmpl` (login con marca; el formulario `signin_inner` se hereda de Forgejo) |
| `deploy/forgejo/custom/public/` | `/data/gitea/public` | `assets/css/git-capsule.css` (tokens del dashboard sobre el tema oscuro), `assets/img/` (`logo.svg`, `favicon.svg`, `favicon.png`, `logo.png`, `apple-touch-icon.png`, `avatar_default.png`, `repo_default.png`, `git-capsule-wordmark.svg`) |

La configuracion (estable, no es personalizacion "unsupported") va en variables `FORGEJO__*` del compose: `APP_NAME=Git Capsule`, `APP_SLOGAN`, `APP_DISPLAY_NAME_FORMAT={APP_NAME}`, `[ui] THEMES/DEFAULT_THEME=forgejo-dark`, `[ui.meta]`, `[i18n] LANGS=es-ES`, pie sin "Powered by", unidades (`DISABLED_REPO_UNITS` sin issues/wiki/projects/packages; `DEFAULT_REPO_UNITS=repo.code,repo.pulls,repo.actions`), sin forks ni estrellas, `[service.explore]` sin paginas de usuarios/organizaciones/codigo, swagger apagado. El tema no es un `theme-<nombre>.css` propio: se usa `forgejo-dark` y `git-capsule.css` se carga despues desde `header.tmpl` (mas robusto al subir de version que copiar el tema entero).

Aplicar un cambio (en el servidor, desde la carpeta del compose):

```bash
git pull   # o copiar deploy/forgejo/custom/ y docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d --force-recreate git   # las plantillas se leen al arrancar; los assets se sirven del disco
```

Si cambias `git-capsule.css` sube el sufijo `gc1` de `header.tmpl` (Forgejo sirve `/assets` con cache larga y `AssetVersion` solo cambia con la version). Los cambios de variables `FORGEJO__*` tambien piden `--force-recreate` (la imagen las escribe en `app.ini` al arrancar con `environment-to-ini`).

(?) Pendiente de comprobar en el primer arranque real (no hay Docker aqui): el script de arranque de la imagen hace `chown -R git:git /data/gitea` solo cuando `/data/gitea` no es de `git`; con montajes de solo lectura dentro de ese directorio podria imprimir errores "Read-only file system". Si el contenedor no arranca por eso, quita `:ro` de los dos montajes.

### 12.2 Borde de acceso (Caddyfile)

Orden de reglas (bloque `route`, orden literal): 1) se borran `X-WEBAUTH-USER`, `X-WEBAUTH-EMAIL`, `X-WEBAUTH-FULLNAME` y la cabecera de confianza configurada (`GIT_AUTH_HEADER`) de toda peticion entrante; 2) limites de cuerpo (512 MB en rutas Git, 64 MB en el resto); 3) `/explore*` redirige a `/`; 4) `forward_auth` a `backend:8080/internal/git-auth` solo en rutas Git (`info/refs`, `git-upload-pack`, `git-receive-pack`, `HEAD`, `objects/*`, `info/lfs/*`) que traen `Authorization`; envia `X-Capsule-Git-Auth: $CAPSULE_GIT_AUTH_SECRET` (secreto compartido con el backend: sin el, el endpoint responde 503) y deja pasar tal cual `X-Forwarded-Method` y `X-Forwarded-Uri` (ruta y query originales sin normalizar; verificado con `%2F`, `%20` y POST); 4b) si forward_auth puso la cabecera de usuario de confianza se quita `Authorization` de la peticion a Forgejo (para que no intente autenticar el `cgt_` como Basic); las credenciales que no son `cgt_` (token de Forgejo, `Bearer` del token de servicio, Basic no `cgt_`) pasan intactas; 5) proxy a `git:3000` (maximo 128 conexiones, `dial_timeout` 5 s). Cabeceras de seguridad: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `COOP`; sin `Server`. Anti slowloris: `read_header 10s`. El contrato con el backend esta en `INTEGRATION.md` (seccion "Borde de acceso").

**Hallazgo verificado con Forgejo 15.0.11:** Forgejo acepta la cabecera de autenticacion de CUALQUIER origen que llegue a `git:3000`; `REVERSE_PROXY_TRUSTED_PROXIES` solo gobierna `X-Forwarded-For` (con ese rango puesto a otra red, una peticion directa con `X-WEBAUTH-USER: <usuario>` siguio autenticando). Por eso hay dos barreras que DEBEN estar puestas antes de activar tokens `cgt_`:

1. **Red**: solo `git-proxy` debe alcanzar `git:3000`. Hoy `git`, `backend` y los demas contenedores de Capsule comparten `capsule-net`: cualquiera de ellos podria suplantar usuarios. Cambio de compose pendiente (fuera del alcance de A3): una red `git-edge` solo con `git` y `git-proxy`, y `git-proxy` ademas en `capsule-net` para llegar a `backend`. Ojo: el webhook de Forgejo hacia `backend` y `backend` hacia `git:3000` (INTEGRATION.md) usan hoy `capsule-net`; hay que decidir la topologia con A1/A7 (p. ej. que `backend` alcance a Forgejo por el propio `git-proxy` con el token de servicio) antes de aislar. No se aplico.
2. **Nombre secreto de la cabecera**: `GIT_AUTH_HEADER=X-GC-<16 hex aleatorios>` en el `.env` del servidor (`openssl rand -hex 8`). El servicio `git` ya lo lee (`FORGEJO__security__REVERSE_PROXY_AUTHENTICATION_USER`); falta pasarlo a `git-proxy` (`environment: - GIT_AUTH_HEADER=${GIT_AUTH_HEADER:?set GIT_AUTH_HEADER}`; cambio de compose fuera del alcance de A3). Las dos piezas deben llevar el mismo valor: si solo `git` lo recibe, Caddy seguira poniendo `X-WEBAUTH-USER` y los clones con token dejaran de autenticar. Verificado: con nombre secreto, una peticion directa con `X-WEBAUTH-USER` ya no autentica.

Limite de tasa: Caddy estandar no lo trae. Opcional: `caddy/Dockerfile` (xcaddy + `mholt/caddy-ratelimit@v0.1.0`) y `caddy/ratelimit.caddy` (120 eventos/min por IP con `Authorization`, 1200/min el resto), montado en `/etc/caddy/conf.d/` y con `git-proxy` construido de ese Dockerfile (cambio de compose pendiente; instrucciones en el propio Dockerfile). Sin ello el unico freno a la fuerza bruta de tokens es el del backend en `/internal/git-auth` (A7 debe implementarlo: SPEC 6.5). Si la IP de cliente llega como la del puente de Docker (proxy de usuario en IPv6), el limite por IP no sirve: comprueba `remote_ip` en los registros de Caddy.

### 12.3 Pruebas (`deploy/forgejo/tests/`)

| Archivo | Que prueba | Requisitos |
|---|---|---|
| `smoke-caddy.sh` | `caddy validate`; borrado de `X-WEBAUTH-*` entrantes; sin credenciales / credencial no `cgt_` / `cgt_` valido / invalido / limitado (429) / con query; cabecera falsa junto a `cgt_` valido; LFS; solo las rutas Git pasan por `forward_auth`; `/explore`; cabeceras de seguridad; limites de cuerpo (`SMOKE_BIG=1` prueba 513 MB); el registro no contiene el token; backend de auth caido = falla cerrado; con `RATELIMIT_SNIPPET=1` y un Caddy con el modulo, el limite de tasa. Usa `stub-git-auth.py` y `echo-upstream.py` (no hace falta Forgejo ni Docker). Con `GIT_AUTH_HEADER=X-GC-...` prueba la cabecera secreta. | `caddy` (`CADDY_BIN`), `python`, `curl` |
| `run-forgejo-local.sh` | Forgejo efimero con el MISMO bloque `FORGEJO__*` del compose y `custom/` (sin Docker; Linux/WSL). Sirve para las comprobaciones siguientes y para clonar/empujar por Caddy con el stub. | binario de Forgejo y `environment-to-ini` (abajo) |
| `visual/check-theme.sh` | HTML y CSS servidos: titulo, tema, plantilla de login, sin "Powered by", variables `--color-*` sobrescritas todavia existentes en el tema base, imagenes, `/explore`, swagger. Es el control a ejecutar en cada subida de `GIT_VERSION`. | un Forgejo con el tema (`BASE=...`) |

Probar sin Docker (lo que se hizo): descargar en carpetas aisladas y verificar el checksum de `forgejo-15.0.11-linux-amd64` (`.sha256` junto al binario en la release de codeberg.org/forgejo/forgejo) y de `caddy_2.11.7_windows_amd64.zip` (`caddy_2.11.7_checksums.txt`, SHA-512). La imagen oficial arranca con el binario `environment-to-ini` (el binario `forgejo` NO lee `FORGEJO__*` por si mismo): se compila del tarball fuente de la misma version con `GOOS=linux CGO_ENABLED=0 go build -mod=vendor ./contrib/environment-to-ini` (la fuente trae `vendor/`; Go 1.26 por `go.mod`). Despues: `GIT_AUTH_HEADER=X-GC-... FORGEJO_BIN=... E2I_BIN=... bash tests/run-forgejo-local.sh start`, Caddy con `GIT_UPSTREAM=localhost:<puerto> GIT_AUTH_UPSTREAM=127.0.0.1:<puerto del stub> GIT_DOMAIN=http://localhost:<puerto>` y `BASE=... bash tests/visual/check-theme.sh`. El script crea un admin local con contrasena aleatoria en `$WORKDIR/admin.pass`; es solo para esa instancia de prueba. Con Git para Windows usa `git -c credential.helper=` en las pruebas de clonado (si no, Git Credential Manager abre una ventana).

### 12.4 Actualizar Forgejo (subir `GIT_VERSION`)

La personalizacion de plantillas y assets figura como "unsupported" en la documentacion de Forgejo: una version nueva puede romperla sin avisar. Procedimiento:

1. Mira las notas de la version y compara las plantillas que sobrescribimos con las de la nueva (`templates/user/auth/signin.tmpl`; los ganchos `templates/custom/*.tmpl`; y los usos de `logo.svg` y `navbar-logo` en `templates/base/head_navbar.tmpl`, `footer_content.tmpl`) en `codeberg.org/forgejo/forgejo` (tag nuevo). Si `signin.tmpl` cambio, reaplica solo el bloque `gc-login-brand` sobre la copia nueva.
2. Con el binario nuevo (checksum verificado) levanta la instancia efimera (12.3) y ejecuta `tests/visual/check-theme.sh`: detecta variables `--color-*` renombradas, plantillas que dejaron de aplicar y claves de configuracion ignoradas.
3. Revisa a ojo login, repo y pull request contra la paleta de `docs/git-capsule/UX.md` seccion 6; sube el sufijo `gc1` a `gc2` en `header.tmpl` si tocaste el CSS.
4. Respaldo, `GIT_VERSION` nueva, `docker compose ... pull git && docker compose ... up -d --force-recreate git`, y repite `check-theme.sh` contra `git.tumi-ai.com`.

### 12.5 Claves de configuracion verificadas

Leidas de la hoja oficial (forgejo.org/docs/latest/admin/config-cheat-sheet/) y aplicadas contra el binario 15.0.11 (efecto comprobado en `app.ini` y en las paginas): `APP_NAME`, `APP_SLOGAN`, `APP_DISPLAY_NAME_FORMAT` (seccion DEFAULT: variable `FORGEJO____CLAVE`, cuatro guiones bajos; `FORGEJO__DEFAULT__...` escribiria una seccion `[default]` inerte), `[ui] THEMES/DEFAULT_THEME`, `[ui.meta]`, `[other] SHOW_FOOTER_POWERED_BY/SHOW_FOOTER_TEMPLATE_LOAD_TIME` (los lee la plantilla `footer_content.tmpl`), `[repository] DISABLED_REPO_UNITS/DEFAULT_REPO_UNITS/DISABLE_FORKS/DISABLE_STARS`, `[service.explore] DISABLE_USERS_PAGE/DISABLE_ORGANIZATIONS_PAGE/DISABLE_CODE_PAGE`, `[api] ENABLE_SWAGGER`, `[service] ENABLE_REVERSE_PROXY_AUTHENTICATION(_API)/AUTO_REGISTRATION`, `[security] REVERSE_PROXY_AUTHENTICATION_USER/REVERSE_PROXY_TRUSTED_PROXIES`. Secciones con punto en variables: `FORGEJO__service_0X2E_explore__CLAVE`, `FORGEJO__ui_0X2E_meta__CLAVE`. Con `DISABLED_REPO_UNITS` sin issues, crear y ver un pull request funciona.

### 12.6 Verificado y no verificado

Verificado (ejecutado): Caddy 2.11.7 (`validate` y 48 comprobaciones de `smoke-caddy.sh` (50 con el modulo de tasa); control negativo: sin la linea `header_up` fallan las pruebas de `cgt_` (503 del stub), sin `request_header @validated -Authorization` falla la prueba de Authorization retirada; con Forgejo real, clone/push con `cgt_`, clone con un token de Forgejo, secreto verificado por el stub, tambien con nombre de cabecera secreto y con el modulo de tasa); Forgejo 15.0.11 real en WSL (sin Docker) con la config del compose: login, repo y pull request renderizados con el tema; `git clone` y `git push` por Caddy con `forward_auth` (stub) y cabecera de confianza; `cgt_` invalido rechazado con 401; cabecera falsa descartada en Caddy; `ENABLE_REVERSE_PROXY_AUTHENTICATION=true` cubre git por HTTP y con `_API=false` la API no acepta la cabecera; `REVERSE_PROXY_TRUSTED_PROXIES` NO protege (12.2).

No verificado: Docker (`docker compose config -q`, la imagen de `caddy/Dockerfile`, los montajes de solo lectura y el `chown` del arranque; el YAML del compose si se parseo); TLS/Let's Encrypt; SSH; OIDC (el login de las pruebas es el local de la instancia efimera, no el de Capsule; no se vio la redireccion automatica al proveedor unico); el endpoint real `/internal/git-auth` (A7); el efecto de las unidades en los equipos sincronizados por A2; `X-Forwarded-For` a traves del proxy de Docker; la cadena "Solicitudes de incorporacion de cambios" de la barra (no se pudo cambiar a "pull request": un `locale_es-ES.ini` parcial en `custom/options/locale` reemplaza el idioma entero en 15.0.11); la barra lateral del pull request aun muestra Hitos y Proyectos (inertes con las unidades apagadas).
