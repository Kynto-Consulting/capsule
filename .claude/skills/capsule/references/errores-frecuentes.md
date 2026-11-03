# Errores frecuentes y su solución

Primero mira el **código de salida** (tabla en `instalacion-login.md`), luego el mensaje.

| Síntoma | Causa probable | Solución |
|---|---|---|
| `API URL not set: pass --api-url or set CAPSULE_API_URL` | modo CI/token sin URL | exportar `CAPSULE_API_URL` o `--api-url` |
| Pregunta por "Capsule API URL [http://localhost:8080]" | primera ejecución interactiva | dar la URL de producción; no aceptar localhost |
| exit 3 | sin sesión, token inválido, caducado o revocado | `capsule whoami`; pedir `capsule login` o token nuevo |
| exit 4 | sin permiso o el recurso no existe (el servidor oculta existencia) | `capsule members list`; comprobar org/proyecto en `.capsule.json`; pedir rol |
| 403 con token `cap_` | alcance insuficiente (`deploy`, `security:write`) | usar el token con el alcance correcto; ver `permisos-tokens.md` |
| exit 2 "falta --yes" | acción destructiva en modo no interactivo | pedir aprobación al usuario y añadir `-y` |
| exit 2 con `CAPSULE_TOKEN=cgt_...` | token de Git donde va uno de API | usar `cap_` para la API; `cgt_` solo como contraseña HTTPS de Git |
| exit 5 `PROTECTED_BRANCH` | push/borrado a rama protegida | rama + PR |
| exit 5 `CHECKS_REQUIRED` | checks pendientes o fallidos | `capsule pr checks N --watch`; `capsule runs logs ID --job J` |
| exit 5 `REVIEWS_REQUIRED` / `CODEOWNER_REQUIRED` | faltan aprobaciones o del dueño del código | `capsule pr request-review`; `capsule git codeowners` |
| exit 5 `SELF_APPROVAL_FORBIDDEN` | el autor intentó aprobar su PR | otra persona revisa |
| exit 5 `POLICY_BLOCKED` | alerta de seguridad nueva que bloquea | `capsule security alerts show ID`; corregir el código |
| exit 5 en `deploy --strict-connections` | hallazgos critical/warning sin suprimir | `capsule connections`; ver `conexiones-internas.md` |
| exit 6 | `--wait` agotado, o fallo con `--exit-status` | `capsule runs view/logs`; subir `--wait`/`--timeout` si es lento |
| exit 7 `GIT_NOT_READY` / `UPSTREAM_GIT_ERROR` | repo aprovisionándose, Forgejo caído, 5xx o 501 | `capsule git repo view`, `capsule git status`; reintentar luego |
| exit 8 | promoción espera aprobación | avisar al aprobador (`capsule approvals list`); no insistir |
| exit 9 | cabezal del PR cambió o clave de idempotencia reutilizada | `capsule pr view N` y reintentar sin `--head-sha` viejo, o nueva `--idempotency-key` |
| 404/501 en un comando de plataforma | el servidor aún no lo soporta o está apagado/sin configurar | `capsule platform`; decirlo al usuario, no rodearlo |
| 501 `NOT_CONFIGURED` en `network`/`db access` | falta el firewall del servidor (`APP_SECURITY_GROUP_ID`) | informar al administrador |
| 501 `NOT_SUPPORTED` en `runs logs/rerun/cancel/artifacts` | sin sesión web de Forgejo (`CAPSULE_GIT_BOT_PASSWORD`) o versión no probada | informar; los logs se ven en la web de Forgejo |
| `UNSUPPORTED` en `db access` | base de nivel `prod` (RDS) o S3 | no se gestiona con este comando |
| La app dejó de abrir tras `network allow` | lista no vacía bloquea a todos los demás | `capsule network allow --my-ip`, o `capsule network clear` con aprobación |
| No conecto a la base/puerto | IP no permitida, IP rotó (VPN/WARP), regla aún sincronizando, `sslmode` distinto de `require` | `capsule db access list` / `ports list`; repetir `--my-ip`; esperar ~15 s |
| `--my-ip` devolvió IPv4 pero uso IPv6 (o al revés) | solo se ve una familia | añadir la otra con `--cidr` |
| Variable `build` no llega al build | el scope `build` aún no se aplica | usar el Dockerfile/args o `runtime`; avisar al usuario |
| Los secretos quedaron en `***` tras `env pull` + `env push --overwrite` | `pull` escribe `***` y `push` lo sube tal cual | restaurar los valores con `env set K="$K" --secret` desde su origen |
| Un deploy "OK" pero la URL no responde | health check/puerto/arranque | `capsule logs runtime`, `capsule logs build`; `capsule ai explain-failure --deployment ID` |
| `git push` pide contraseña | helper no configurado o sesión caducada | `capsule git login` o `capsule login` |
| Un valor secreto apareció en un log/PR/chat | fuga | avisar al usuario **de inmediato**; rotar el secreto; no basta con borrar el mensaje |
| Alerta `secret` de gitleaks | credencial en el repo | rotarla primero; después `dismiss` solo si es falso positivo |
| `recover` responde 404/501 | apagado en el servidor (`CAPSULE_RECOVERY_ENABLED`) o no cableado | informar al usuario |
| Pasos `skipped` en `recover apply` | cambios de infraestructura (Terraform/DNS/RDS) | los hace un operador con `deploy/recovery/recover.sh`; no los intentes |

Regla general: si un comando falla y no entiendes por qué, ejecuta `capsule <comando> --help`, `capsule platform` y
`capsule whoami`, y reporta al usuario el mensaje exacto (sin secretos). No pruebes variaciones al azar sobre
recursos de producción.
