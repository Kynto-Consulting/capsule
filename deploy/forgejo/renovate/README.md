# Renovate autoalojado (sustituto de Dependabot)

Dependabot no existe fuera de GitHub. Las actualizaciones las hace Renovate (OSS, soporta Forgejo); las alertas de vulnerabilidades las cubren `vulnerabilityAlerts`/`osvVulnerabilityAlerts`
(PR de seguridad inmediato) y `workflows/security-audit.yml` (osv-scanner programado que publica sus resultados como alertas en Git Capsule, ya no un issue por repo).

Archivos: `config.js` (bot), `default.json` (preset compartido), `Dockerfile` (imagen con version fijada: `ghcr.io/renovatebot/renovate:39.100.0`; confirma que el tag existe), y la alternativa `workflows/dependency-updates.yml` (corre en el runner).

## Politica del preset (`default.json`)

Agrupa por ecosistema (npm incluye pnpm/yarn/bun, go modules, Python, Docker/compose, Terraform, acciones de CI), semanal los lunes antes de las 6 (America/Lima), `minimumReleaseAge` 3 dias
(los PR de seguridad lo omiten), majors en PR aparte con etiqueta `major`, `prConcurrentLimit` 5, etiquetas `dependencies`/`security`, `lockFileMaintenance` mensual, pin por digest/SHA de acciones y de imagenes,
y SIN automerge salvo parches de `devDependencies` (con el CI verde exigido por la proteccion de rama). Node, Postgres, Redis y la version de Go suben como PR con etiqueta `runtime-review` y SIN automerge: la revision es el propio PR. El Dependency Dashboard esta apagado (`dependencyDashboard: false`: los Issues de Forgejo estan ocultos, SPEC 5.5), por eso el preset ya no usa `dependencyDashboardApproval`.

## Despliegue como proyecto de Capsule con cron

1. Crea el repo de configuracion `platform/renovate-config` con `default.json` en la raiz, y el repo `platform/renovate-bot` con `Dockerfile` y `config.js` de esta carpeta.
2. Cuenta de servicio `renovate-bot` en Forgejo (usuario normal, NO admin) invitada con permiso de escritura a los repos que gestione; token personal con alcance minimo: `write:repository` y `write:issue`
   (lectura de usuario/organizacion si el autodescubrimiento lo pide: `read:user`, `read:organization`). Nunca admin.
3. Proyecto de Capsule: `capsule projects create ...` (verifica flags con `capsule projects create --help`) y `capsule deploy` desde `renovate-bot`.
4. Variables secretas del proyecto (sin escribirlas en archivos): `RENOVATE_TOKEN` (el token del paso 2), `RENOVATE_GITHUB_COM_TOKEN` (opcional, lectura publica para changelogs) y `RENOVATE_DRY_RUN=full`. Usa el comando de variables de la CLI (`capsule env --help`).
5. Cron semanal: `capsule crons create --org <org-id> --project <project-id> --name renovate --schedule "17 4 * * 1" --command "renovate" --timezone "America/Lima"`; ejecuta ya con `capsule crons trigger --org <org-id> --project <project-id> <cron-id>`.
6. Etiqueta con el topic `renovate` los repos a gestionar (o ajusta `autodiscoverFilter`). Cada repo recibe un PR de onboarding que crea `renovate.json` con `{"extends":["local>platform/renovate-config"]}`.
7. Primera ejecucion en seco (`RENOVATE_DRY_RUN=full`): revisa los logs; cuando sean correctos, cambia la variable a `null` y vuelve a lanzar.

Alternativa sin proyecto: `workflows/dependency-updates.yml` en un repo de la plataforma, con los secretos `RENOVATE_TOKEN`/`RENOVATE_GITHUB_COM_TOKEN`; el runner ejecuta Renovate semanalmente (por defecto en seco).

No verificado: ninguna de las piezas se ha ejecutado; las claves del preset se escribieron de memoria de la documentacion de Renovate (valida con `npx --package renovate renovate-config-validator default.json` antes de publicar).

## Integracion con Git Capsule (pestana Seguridad > Renovate)

- **Activar/desactivar por repo** (`PUT /security/renovate`, solo admin): Capsule guarda el estado y marca el repo con el topic `renovate`, que es lo que el bot autodescubre (`autodiscoverTopics`). Si el nucleo Git no puede escribir topics, la respuesta trae `topic_synced=false` y `sync_error` con la instruccion de poner o quitar el topic a mano en Forgejo.
- **Estado** (`GET /security/renovate`): onboarding (`none` sin PR ni `renovate.json`, `pr_open` con el PR `renovate/configure` abierto, `merged` cuando existe `renovate.json` en la rama por defecto) y numero de PR de actualizacion abiertos (los de la cuenta `renovate-bot` o con rama `renovate/*`). Se refresca como maximo cada 2 minutos.
- **Ejecutar ahora** (`POST /security/renovate/run`): el backend hace `docker exec` en el contenedor del proyecto de Capsule que aloja el bot (el mismo mecanismo que `capsule crons trigger`), limitado al repo con `RENOVATE_AUTODISCOVER=false` y `RENOVATE_REPOSITORIES=org/repo` (`config.js` las respeta). Se activa con `SECURITY_RENOVATE_PROJECT_ID=<id del proyecto renovate-bot>` en el entorno del backend (`SECURITY_RENOVATE_COMMAND`, `SECURITY_RENOVATE_BOT_LOGIN` y `SECURITY_RENOVATE_PRESET` son opcionales). Sin esa variable la ruta responde 503.
- **Cron**: la corrida semanal sigue siendo el cron del paso 5; "Ejecutar ahora" solo anade corridas puntuales.
- Los PR de Renovate pasan por las mismas protecciones de rama y por el check `capsule/security` como cualquier otro PR.
