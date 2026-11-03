# Estado real de Capsule (2026-11-03) y lo que NO existe

Esta referencia separa lo que funciona hoy de lo planificado. Si algo no está en "Funciona hoy", no lo prometas.

## Funciona hoy en producción

- **Backend y frontend desplegados el 2026-11-03**, con migraciones hasta la **000059** (`cidr_ipv6`).
- **Forgejo en `git.tumi-ai.com`** con **login OIDC por Capsule** (cliente first-party, sin pantalla de
  consentimiento; los grupos viajan en el claim `groups`: `org:<slug>`, `org:<slug>:<rol>`,
  `project:<org>/<project>:<rol>`).
- **Clone, push y pull por HTTPS verificados** (token `cgt_` validado en el borde por `/internal/git-auth`; el
  repo se autentica como el usuario de Forgejo correspondiente).
- Roles viewer/deployer/admin proyectados a equipos de Forgejo; repo `ORG/PROJECT` aprovisionado al crear el
  proyecto (con reintento y estado visible en `capsule git repo view`).
- CLI 0.7.3 con todos los grupos de `capsule --help`: deploy, vars/env, ci, workflow, runs, git, pr, branch,
  security, environments, promote, approvals, webhooks, audit, notifications, recover, backups, ports, db access,
  network, connections, members, oauth, tokens, api, alias.
- Informe de conexiones internas (`capsule connections`, `deploy --strict-connections`), IPv6 **a nivel de código**
  (CIDR, reglas, `--my-ip`, allowlist), puertos TCP extra, firewall de la app, acceso externo a bases, backups por
  proyecto.

## Funciona con salvedades (no verificado de extremo a extremo por esta skill)

- **SSH a Git** en `git.tumi-ai.com:22`: diseñado y documentado (`capsule git ssh-keys`); el README de Forgejo lista SSH
  como no verificado en su momento. Si falla, usa HTTPS.
- **Jobs/logs/cancelar/re-ejecutar/artefactos de CI**: dependen de una sesión web interna de Forgejo con la cuenta
  `capsule-bot` y de versiones concretas de Forgejo (`CAPSULE_GIT_WEB_VERSIONS`); sin ellas responden 501.
- **`capsule recover`**: implementado (API + CLI + scripts), pero apagado por defecto en el servidor
  (`CAPSULE_RECOVERY_ENABLED`) y sin simulacro ejecutado: RPO/RTO son hipótesis. La parte de infraestructura la hace un
  operador con `deploy/recovery/recover.sh`.
- **Artefactos y caché de Actions**: no verificados en el runner de producción.
- **Auto-merge, estilos de merge, comentarios en línea, sugerencias**: mapeo a Forgejo marcado "(?)" en `SPEC.md`;
  si un comando devuelve 501/404 o un estilo no aplica, repórtalo.
- **Observación en ejecución** de conexiones (`CAPSULE_CONNAUDIT_RUNTIME`): opcional y apagada por defecto.
- Rutas de la API con `x-status: new|in-progress` en `API.openapi.yaml` son contrato de diseño: **no** indican que
  estén desplegadas. La verdad operativa es `capsule platform`, `capsule git status` y el código de respuesta.

## Lo que NO existe todavía

### Gateway universal: SOLO PLANIFICADO (`docs/gateway/PLAN.md`; "no hay código de producto")

Nada de lo siguiente existe; no lo ejecutes ni lo ofrezcas como disponible:

- Servicio `capsule-gateway` (gateway propio en Go; Caddy se quedaría para HTTP).
- Acceso a bases **por nombre y SNI en el puerto estándar** (`psql "host=mi-proyecto.db.tumi-ai.com"`), y
  nombres `*.db` por proyecto.
- URIs `capsule://<proyecto>/<servicio>`, comandos `capsule connect`, `capsule tunnel`, `capsule ssh`, y el túnel
  TLS con encabezado de enrutamiento `capsule/1` hacia `tcp.apps.tumi-ai.com:443` (SSH, RDP, Minecraft, TCP
  arbitrario).
- UDP por el túnel, QUIC/WebTransport, librerías cliente Go/JS.
- Pool de puertos aleatorios con arrendamiento (lease) como respaldo.
- Cambio de "método primario": hoy el acceso externo a bases es **directo** (puertos 40000-40199 con TLS y lista de
  IPs) y los puertos TCP extra son 41000-41999.
- Lo medido en `docs/gateway/spikes/` son experimentos de viabilidad, no producto.

El único trozo "del gateway" ya construido es el **informe de conexiones internas** del deploy (`capsule connections`),
que detecta conexiones que se saltarían un gateway futuro.

### Red y plataforma

- **IPv6 de cara a Internet**: sin activar (`ipv6_enabled` de Terraform no aplicado; falta Docker IPv6 y `AAAA`).
  Una regla IPv6 se guarda pero nadie llega por IPv6 todavía.
- Variables con scope **`build`** aplicadas a la construcción (solo `runtime` y `both` se inyectan).
- Rate limiting por /64 en IPv6 (hoy por /128).
- Estado de Terraform remoto (hoy local en `deploy/terraform`; backend S3 preparado y sin activar).
- Simulacro mensual de recuperación (`deploy/recovery/drill.sh`) sin ejecutar; RTO "no medido".

### Git Capsule

- **Fork y PR de forks** (los PR salen de ramas del propio repo).
- **Issues, wiki, proyectos, releases y packages** de Forgejo (ocultos a propósito); `capsule issue|project|gist|
  codespace|release` no existen.
- **CodeQL y Dependabot** (los sustituyen Semgrep y Renovate).
- Revisión línea a línea y editor de archivos en el dashboard: entregas posteriores (E2/E3); hoy la web de Forgejo
  hace de respaldo.
- Borrado/archivado del repo de Forgejo al borrar un proyecto: **no implementado** (el repo no se toca).
- Proveedor de CI distinto de GitHub Actions/Forgejo Actions.

### CLI

- `capsule projects archive` (el propio comando lo dice: "not yet supported").
- Subcomando para cambiar `connection_audit_mode` (usa `capsule api PUT`).
- `capsule pr checkout`: el comando real es **`capsule pr co N`** (`git fetch origin pull/N/head`); la referencia
  `pull/N/head` en Forgejo estaba marcada por verificar en la spec.
- `capsule git credential` con tokens de servicio `cgt_`: rechazado a propósito (exit 2).

## Cómo comprobar el estado vivo (no te fíes de este archivo para lo que cambia)

```bash
capsule version ; capsule whoami
capsule platform                 # backups, git, puertos, OIDC soportados por ESTE servidor
capsule git status               # versión del motor, runners, funciones
capsule git repo view            # estado de aprovisionamiento del repo del proyecto
capsule connections              # hallazgos de conexión del último deploy
```

Si la respuesta es 404/501, el servidor no lo soporta o no está configurado: informa y espera instrucciones.
