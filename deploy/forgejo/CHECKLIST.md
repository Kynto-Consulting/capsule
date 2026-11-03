# Checklist de seguridad previa al go-live de Forgejo

Marca cada punto con fecha y quien lo verifico. Nada se da por hecho: ninguno de estos puntos se ha comprobado aun.

## Red y TLS
- [ ] DNS: un unico registro `A git` -> IP elastica (TTL automatico). `dig +short git.tumi-ai.com` coincide con `terraform output builder_elastic_ip`.
- [ ] Caddy emitio el certificado Let's Encrypt (`docker compose logs git-proxy`), HTTP redirige a HTTPS, HSTS presente (`curl -sI https://git.tumi-ai.com`).
- [ ] Renovacion: el volumen `capsule-git-caddy` persiste y esta incluido en la politica de copias; hay alerta de caducidad (correo `GIT_ACME_EMAIL`) y comprobacion mensual de `notAfter`.
- [ ] Puertos del host: 80 y 443 (Caddy), 22 (SSH de Forgejo), 2200 (administracion). El 3000 de Forgejo NO esta publicado (`docker port capsule-git`).
- [ ] SSH de administracion en 2200 solo por llave (`PasswordAuthentication no`, `PermitRootLogin no`); `admin_ssh_cidrs` restringido a IP conocidas; `Port 22` retirado de sshd tras la prueba.
- [ ] fail2ban (o equivalente) para el 22 y el 2200 en el host; para el 22 de Forgejo considerar tambien limites de conexion (`MaxStartups`) en el contenedor.
- [ ] SG `app`: sin reglas de mas (revisar `aws ec2 describe-security-groups`); las reglas de git vienen de `git.tf`.

## Cuentas y acceso
- [ ] Registro deshabilitado, login local deshabilitado (`ENABLE_INTERNAL_SIGNIN=false`), `REQUIRE_SIGNIN_VIEW=true`.
- [ ] Login OIDC probado con un usuario sin privilegios y con uno admin; `ACCOUNT_LINKING=disabled` confirmado.
- [ ] Admin de emergencia creado, token guardado fuera de linea, 2FA activo, procedimiento de uso y rotacion probado (README seccion 6).
- [ ] 2FA exigido a administradores y a quien tenga cuenta local.
- [ ] Tokens: `CAPSULE_GIT_TOKEN`, token de Renovate, `AUDIT_ISSUE_TOKEN`, `SAST_READ_TOKEN` con alcance minimo, por cuenta de servicio, con fecha de rotacion; ninguno en el repositorio.
- [ ] Repos privados por defecto; webhooks con secreto por proyecto.

## Datos y copias
- [ ] Volumen `capsule-git-data` (SQLite + repos) identificado; incluido en la politica de snapshots del host si existe.
- [ ] Respaldo diario `forgejo dump` cifrado en S3 funcionando (cron en el host), objeto de las ultimas 26 h visible, retencion 30 dias, bucket con versionado y bloqueo publico.
- [ ] `GIT_BACKUP_PASSPHRASE` guardada tambien fuera del servidor; sin ella el respaldo no se puede abrir.
- [ ] Restauracion ensayada de punta a punta en una maquina limpia (fecha: ____, duracion: ____, resultado: ____).
- [ ] Usuario IAM de respaldos solo con PutObject/ListBucket; llave rotada; no hay llaves de administrador en el servidor.

## Memoria y capacidad del host
- [ ] `free -m` antes/despues de levantar Forgejo y Caddy: queda margen (>= 500 MB libres bajo carga). `mem_limit` activo (768m / 128m / 512m del respaldo).
- [ ] El respaldo no coincide con builds pesados de Capsule (hora del cron); el dump usa el volumen como temporal: hay espacio en disco (`df -h`).
- [ ] Si el margen es justo: subir tipo de instancia antes de activar CI. El CI nunca corre en este host.

## Actualizaciones
- [ ] `GIT_VERSION` fijada y revisada contra los avisos de seguridad de Forgejo; procedimiento: respaldo, `pull`, `up -d`, verificacion.
- [ ] Imagenes fijadas por version (Forgejo, Caddy, Renovate, herramientas de las plantillas); considerar fijar por digest.
- [ ] Renovate actualiza los repos (preset `renovate/default.json`) y el propio compose/Terraform del servidor entra en su alcance.

## Runner de CI (si `ci_runner_enabled`)
- [ ] Instancia separada del servidor de Capsule, SG sin ingreso, acceso solo por SSM; IMDSv2 obligatorio y hop limit 1 (`aws ec2 describe-instances ... MetadataOptions`).
- [ ] Rol del runner solo con SSM + lectura de un parametro; el parametro del token de registro borrado tras registrar.
- [ ] `forgejo-runner` con checksum verificado; `privileged=false`; sin docker.sock en jobs; limites memoria/CPU/pids activos.
- [ ] Prueba de aislamiento: un job no alcanza `169.254.169.254` ni la IP privada del servidor de Capsule.
- [ ] Secretos de Actions por repo/organizacion con alcance minimo; los PR de forks no reciben secretos; politica de aprobacion de ejecuciones de colaboradores externos.
- [ ] Plan para runner efimero por job documentado y fechado.

## Integracion y CI
- [ ] CodeQL y Dependabot NO estan en uso (no existen fuera de GitHub); lo sustituyen `sast.yml` y `dependency-updates.yml`/`security-audit.yml`. Variables `SAST_REPO`/`SAST_REF` (commit fijo) definidas.
- [ ] `semgrep --test` de las reglas propias ejecutado y verde (sast/scripts/run-tests.sh) antes de publicar el paquete.
- [ ] Renovate en dry run revisado antes de activar (`RENOVATE_DRY_RUN=null`).
- [ ] Webhook `hooks/git/{projectID}` valida firma HMAC y es idempotente.
- [ ] Compuertas obligatorias en la proteccion de la rama `main` (gitleaks, ci-node, deps, sast, trivy, terraform).

## Tema, borde de acceso y tokens `cgt_` (paquete A3; ver README seccion 12)
- [ ] `docker compose -f docker-compose.prod.yml config -q` con el `.env` real (no se ejecuto: no habia Docker al escribirlo) y arranque de `git` con los montajes de `deploy/forgejo/custom/` (`docker compose logs git` sin errores de "Read-only file system"; si los hay, quitar `:ro`).
- [ ] `GIT_AUTH_HEADER` definido en el `.env` con `X-GC-` + 16 hex aleatorios y pasado a los DOS servicios (`git` y `git-proxy`); `docker compose exec git grep REVERSE_PROXY_AUTHENTICATION_USER /data/gitea/conf/app.ini` muestra ese nombre.
- [ ] **Aislamiento de Forgejo**: desde otro contenedor de `capsule-net` (p. ej. `docker compose exec backend wget -qO- --header 'X-WEBAUTH-USER: <admin>' http://git:3000/user/settings`) NO se alcanza `git:3000` (red `git-edge` solo con `git` y `git-proxy`). Forgejo acepta la cabecera de autenticacion de cualquier origen que lo alcance; `REVERSE_PROXY_TRUSTED_PROXIES` no lo impide (verificado en 15.0.11).
- [ ] Desde fuera: `curl -s -o /dev/null -w '%{http_code}' -H 'X-WEBAUTH-USER: <admin>' https://git.tumi-ai.com/user/settings` NO devuelve 200 y lo mismo con `-H 'X-GC-...: <admin>'` (nombre secreto); `bash deploy/forgejo/tests/smoke-caddy.sh` verde con el Caddy de la version fijada.
- [ ] `git clone` con `cgt_` valido funciona; con `cgt_` invalido da 401; sin credenciales pide usuario; `git push` con token de solo lectura es rechazado (depende de A7).
- [ ] `/internal/git-auth` NO es alcanzable desde Internet (`curl -sI https://git.tumi-ai.com/internal/git-auth` no llega al backend y `https://api.tumi-ai.com/internal/git-auth` tampoco).
- [ ] Limite de tasa: o imagen de Caddy con `caddy/Dockerfile` + `ratelimit.caddy`, o limite por IP/token en `/internal/git-auth` (A7) probado con 200 intentos seguidos. Si la IP de cliente en los registros de Caddy es la del puente de Docker, el limite por IP no sirve.
- [ ] Tema: `BASE=https://git.tumi-ai.com bash deploy/forgejo/tests/visual/check-theme.sh` verde; capturas de login, repo y pull request revisadas contra la paleta (UX.md seccion 6); en cada subida de `GIT_VERSION` se repite con el binario nuevo antes de desplegar (README 12.4).
- [ ] Login con OIDC real: la pagina `/user/login` muestra el boton del proveedor "capsule" y el enlace "Volver a Capsule" lleva a `app.tumi-ai.com/git`.
- [ ] Sin forks, sin estrellas, sin `/explore`, sin swagger (`/api/swagger` no responde), pie sin "Powered by" ni version.
- [ ] `CAPSULE_GIT_AUTH_SECRET` identico en `backend` y `git-proxy` (>= 32 bytes aleatorios, fuera del repo); sin el, `curl` a `/internal/git-auth` desde la red interna da 503 (`docker compose exec git-proxy wget -S -qO- http://backend:8080/internal/git-auth`).
- [ ] Con un `cgt_` valido el log de Forgejo no muestra intentos de login Basic fallidos (Caddy retira `Authorization`); un token de Forgejo y el token de servicio del backend siguen funcionando contra `git.tumi-ai.com`.
