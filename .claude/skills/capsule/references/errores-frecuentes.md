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
| `capsule connect` falla con TLS/`connection refused`/404 en `.../gateway/...` | el gateway no está desplegado (producción en migración 000059) | usar el puerto directo (`bases-acceso-externo.md`); decirlo al usuario |
| `capsule connect` exit 2 | URI inválido (mayúsculas, `_`, puerto, secreto en el URI), `--exec` sin `-- comando`, `--stdio` con `--listen`, `ssh`/`--stdio` con `?transport=udp` | corregir; `capsule connect --help` |
| `capsule connect` exit 3 | sin credenciales, token sin prefijo `cap_/cgt_/cgc_/cgs_`, `cgc_` expirado | `capsule login` o `CAPSULE_GATEWAY_TOKEN`; no pegues el token en la línea de comandos |
| `capsule connect` exit 4 | token inválido, sin `project.connect` (viewer), servicio inexistente o no expuesto, o IP no permitida (el gateway no distingue) | `capsule members list`; `ports access add`/`db access add --my-ip`; que un admin exponga el servicio |
| `capsule connect` exit 5 | cuota de conexiones/tasa/sesiones UDP del proyecto | esperar y reintentar; cerrar túneles sobrantes |
| `capsule connect` exit 1 "no disponible" / "cerró sin cierre ordenado" | destino caído, gateway drenando o plano de control caído (falla cerrada) | reintentar; `capsule logs runtime`; no tratar los datos como completos |
| `0x0203` / token repetido | reutilización de un `cgc_` (es de un solo uso) o nonce repetido | dejar que el CLI pida uno nuevo; no guardar `cgc_` |
| Con solo sesión de usuario, `connect` da 404 al pedir el token | el CLI llama `/api/v1/projects/...` y el backend monta `/orgs/{org}/projects/...` (aviso de código, sin verificar) | usar un `cgs_` en `CAPSULE_GATEWAY_TOKEN`; informar |
| `409 port_pool_exhausted` / `port_quota_exceeded` al pedir puerto aleatorio | pool agotado o cuota de proyecto/org | usar `capsule://` (no necesita puerto) o liberar uno (`DELETE .../port`); no reintentar en bucle |
| El puerto aleatorio no deja pasar a nadie | su lista de IP está vacía: **deniega** | añadir la IP concreta; nunca `0.0.0.0/0` |
| `ports remove/access` toca el puerto equivocado | mismo número en tcp y udp; sin `--udp` actúa sobre tcp | repetir con `--udp`; verificar con `ports list` (columna PROTO) |
| `INVALID_PROTOCOL` / `DUPLICATE_PORT` en `ports add` | protocolo distinto de tcp/udp, o (puerto, protocolo) ya publicado | `capsule ports list` |
| `capsule connect` en npm (WASM) dice que necesita binario nativo | el paquete WASM no abre sockets | instalar el binario nativo o `CAPSULE_NATIVE_BIN` |
| No llego por IPv6 | AAAA no confirmado, Docker IPv6 del host o regla solo IPv4 | `ipv6.md`; añadir la regla v6 explícita; comprobar con el usuario |

Regla general: si un comando falla y no entiendes por qué, ejecuta `capsule <comando> --help`, `capsule platform` y
`capsule whoami`, y reporta al usuario el mensaje exacto (sin secretos). No pruebes variaciones al azar sobre
recursos de producción.
