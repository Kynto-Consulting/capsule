# Estado real de Capsule (2026-11-03) y lo que NO existe

Esta referencia separa lo que funciona hoy de lo planificado. Si algo no está en "Funciona hoy", no lo prometas.

## Funciona hoy en producción

- **Backend y frontend desplegados el 2026-11-03**, con migraciones hasta la **000059** (`cidr_ipv6`); las 000060-000064 (gateway, UDP) NO están aplicadas.
- **Forgejo en `git.tumi-ai.com`** con **login OIDC por Capsule** (cliente first-party, sin pantalla de
  consentimiento; los grupos viajan en el claim `groups`: `org:<slug>`, `org:<slug>:<rol>`,
  `project:<org>/<project>:<rol>`).
- **Clone, push y pull por HTTPS verificados** (token `cgt_` validado en el borde por `/internal/git-auth`; el
  repo se autentica como el usuario de Forgejo correspondiente).
- **SSH de administración del host en el puerto 2200** (no es asunto de un agente); SSH de Git se anuncia en `:22`. DNS A de `git` y `db` existentes.
- Roles viewer/deployer/admin proyectados a equipos de Forgejo; repo `ORG/PROJECT` aprovisionado al crear el
  proyecto (con reintento y estado visible en `capsule git repo view`).
- CLI con los grupos (los comandos `connect`, `tunnel` y `ssh` existen en el binario pero no tienen gateway en producción, ver abajo) de `capsule --help`: deploy, vars/env, ci, workflow, runs, git, pr, branch,
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

### Gateway universal: en el código, NO desplegado (`docs/gateway/PLAN.md`, `PROTOCOL.md`)

| Pieza | Estado |
|---|---|
| `capsule connect/tunnel/ssh`, `--listen`, `--stdio`, `--exec`, ProxyCommand SSH | **en el código** |
| URI `capsule://<proyecto>/<servicio>`, host `tcp.<zona>`/`udp.<zona>`, protocolo `capsule/1` | **en el código** (norma + vectores de prueba) |
| Librerías `cli/pkg/gatewayclient` (Go) y `packages/gateway-js` (`@kyntocg/capsule-gateway`) | **en el código** |
| API: servicios, `connection-info`, `connection-token` (`cgc_`), tokens `cgs_`, puerto aleatorio 20000-29999 (`409 port_pool_exhausted`/`port_quota_exceeded`), política de org `warn\|error`, acción `project.connect` | **en el código** (migraciones 000060-000062) |
| Puertos UDP directos (`ports add --udp`, columna PROTO) y UDP por túnel | **en el código** (migración 000064) |
| Informe de conexiones internas | **desplegado** |
| **Despliegue** del servicio `capsule-gateway` y migraciones 000060-000064 | **NO desplegado**: producción está en la 000059 |
| Certificado comodín DNS-01 y toma del 443 | planificado |
| MySQL/Redis/Mongo por SNI en el puerto estándar | planificado |
| QUIC/WebTransport (`transport=3` -> `0x0109`) | planificado |
| `capsule-agent` (salida) y dominios personalizados | planificado |

El navegador no puede abrir TCP crudo. Hasta el despliegue, el acceso externo a bases es **directo**
(`db.tumi-ai.com:40000-40199`, TLS, lista de IPs) y los puertos extra son 41000-41999. Lo medido en
`docs/gateway/spikes/` son experimentos de viabilidad. Ver `gateway.md`.

### Red y plataforma

- **IPv6 de cara a Internet**: la red de AWS (VPC, ALB dualstack, IPv6 de la instancia) ya está aplicada; falta confirmar `AAAA` en DNS y Docker IPv6 en el host (ver `ipv6.md`).
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
