---
name: capsule
description: Operar la plataforma Capsule con el CLI `capsule` y su API. Úsala cuando haya que desplegar una app, gestionar variables y secretos (vault por capa cuenta/proyecto/deploy), configurar CI/CD o workflows (Forgejo/GitHub Actions, runs, logs), abrir puertos TCP o reglas de firewall (IPv4/IPv6, --my-ip), dar acceso externo a bases de datos, hacer o restaurar backups y recuperación (recover), usar Git Capsule (clone, ramas, PR, revisión, merge, ramas protegidas, auto-merge), revisar seguridad (SARIF, Semgrep, Renovate, alertas), manejar entornos, promociones y aprobaciones, crear tokens (cap_, cgt_, alcances deploy y security:write), webhooks, auditoría, permisos por proyecto, o leer el informe de conexiones internas del deploy; conectarse a una base o servicio por el gateway (`capsule connect/tunnel/ssh`, URI `capsule://proyecto/servicio`, tokens `cgc_`/`cgs_`), puertos aleatorios del pool y puertos UDP. Para actualizar versiones del CI autoalojado usa capsule-ci-maintenance.
---

# Capsule: uso del CLI para agentes

Capsule es una plataforma tipo Vercel sobre AWS: organización -> proyectos -> despliegues en
`https://<slug>.apps.tumi-ai.com`, más Git propio (**Git Capsule**, motor Forgejo en `git.tumi-ai.com`), CI,
seguridad, entornos con aprobaciones y respaldos. Este archivo solo enruta y fija reglas; el detalle vive en
`references/`. Todos los comandos citados se verificaron contra `capsule --help` del CLI compilado con `go build` desde el código actual (incluye `connect`, `tunnel`, `ssh`).

## Cómo usar esta skill

1. Identifica el área en la tabla y lee **solo** esa referencia.
2. Ante cualquier duda de sintaxis ejecuta `capsule <grupo> <sub> --help` antes de adivinar. Si un comando no
   aparece en `--help`, no existe: no lo inventes (ver `references/estado-real.md`).
3. Sigue el flujo de trabajo de abajo y las reglas de seguridad. Si algo choca con una regla, gana la regla.

| Necesidad | Lee |
|---|---|
| Instalar, `capsule login`, tokens `cap_`/`cgt_`, variables de entorno, códigos de salida, IDs cortos, formatos de salida | `references/instalacion-login.md` |
| Desplegar, verificar, logs, rollback, workers, crons, dominios, escala, storage | `references/despliegue.md` |
| Variables y secretos por capa (cuenta, proyecto, deploy) | `references/variables-vault.md` |
| Workflows, `ci init`, runs y logs de CI, secretos de CI, runners, acción de deploy | `references/ci-workflows.md` |
| Conectarse a una base o servicio con `capsule connect/tunnel/ssh`, `capsule://`, tokens `cgc_`/`cgs_`, exit codes 2-6, puerto aleatorio, límites | `references/gateway.md` |
| UDP (por túnel y directo) e IPv6 en el gateway | `references/udp-ipv6.md` |
| Puertos TCP/UDP extra, lista de IPs de la app, `--my-ip` | `references/puertos-firewall.md` |
| Acceso externo a bases de datos | `references/bases-acceso-externo.md` |
| IPv4 e IPv6 (qué se acepta, qué falta activar) | `references/ipv6.md` |
| Backups, restauración, `recover`, manifiestos | `references/backups-recuperacion.md` |
| Git Capsule: clone, ramas, PR, revisión, merge, protección, auto-merge, tokens Git, SSH | `references/git-capsule.md` |
| Seguridad: alertas, SARIF, Semgrep, Renovate, políticas, supresiones | `references/seguridad.md` |
| Entornos, promociones, aprobaciones, ventanas | `references/entornos-aprobaciones.md` |
| Webhooks, auditoría, notificaciones | `references/webhooks-auditoria.md` |
| Roles viewer/deployer/admin, miembros, alcances de tokens, OAuth | `references/permisos-tokens.md` |
| Informe "Conexiones internas detectadas" del deploy | `references/conexiones-internas.md` |
| Algo falla | `references/errores-frecuentes.md` |
| Qué funciona hoy y qué NO existe | `references/estado-real.md` |

Mantenimiento del CI autoalojado (Renovate, Semgrep, versiones fijadas): skill hermana
`.claude/skills/capsule-ci-maintenance/SKILL.md`. No se duplica aquí.

## Qué camino usar para conectarse a un servicio (gateway primero)

| Camino | Cuándo | Cómo | Estado |
|---|---|---|---|
| **Gateway** (primario) | siempre que sea posible: bases, SSH, TCP, UDP por túnel | `capsule connect proyecto/servicio` (`references/gateway.md`) | **en el código; NO desplegado** |
| **Puerto directo** (secundario) | hoy es lo único que funciona en producción; o clientes que no pueden usar túnel (juegos UDP, apps sin `capsule`) | bases `db.tumi-ai.com:40000-40199` (`bases-acceso-externo.md`); extras `41000-41999` tcp/udp (`puertos-firewall.md`) | TCP desplegado; UDP en el código |
| **Puerto aleatorio** (respaldo) | cliente que no habla `capsule/1` ni puede usar un puerto directo; pool 20000-29999 | `POST .../gateway/services/{svc}/port` con `capsule api`; sin token, decide solo la lista de IP del servicio | **en el código; NO desplegado** |

Orden: 1) gateway si está desplegado; 2) puerto directo con `--my-ip`; 3) puerto aleatorio solo si los dos anteriores
no sirven. El navegador no puede abrir TCP crudo: para HTTP usa `https://<slug>.apps.tumi-ai.com`.

## Flujo de trabajo estándar

```bash
capsule whoami                      # 1. ¿sesión válida? (exit 3 = no)
capsule platform                    # 2. qué soporta este servidor (backups, git, puertos, oidc)
cat .capsule.json                   # 3. contexto: org_id + project_id (si falta: capsule link, o --org/--project)
# ... trabajar ...
capsule <grupo> list|show           # 4. verificar el estado resultante después de CADA cambio
```

Bucle típico de un cambio de código con Git Capsule:

```bash
capsule git clone ORG/REPO && cd REPO
capsule branch create fix/plazos                      # o: git switch -c fix/plazos
git add -A && git commit -m "fix: valida plazo" && git push -u origin fix/plazos
capsule pr create --title "fix: valida plazo" --body-file desc.md
capsule pr checks N --watch --exit-status             # exit 6 si falla
capsule pr merge N --squash --auto                    # se fusiona sola cuando se cumplan las reglas
capsule promote --to production --sha "$(git rev-parse HEAD)" --wait   # exit 8 = falta aprobación humana
```

Después de actuar, verifica: tras un deploy, la URL responde 200 y `capsule logs runtime`; tras tocar firewall,
puertos o miembros, vuelve a ejecutar `list`/`show`; tras un restore, comprueba la app.

## Reglas de seguridad para el agente (no negociables)

1. **Nunca imprimas secretos**: ni valores de variables `--secret`, ni tokens (`cap_…`, `cgt_…`), ni
   `client_secret` OAuth, ni secretos de webhook, ni claves SSH privadas. No los pegues en el chat, en PR,
   en commits, en logs ni en el YAML de un workflow (usa `${{ secrets.X }}`). El valor de un token nuevo se
   muestra **una sola vez** por stdout: guárdalo directo como secreto de CI y no lo repitas.
2. **No uses un token de otro alcance** del que la tarea necesita ni "prestes" el de otro propósito. Para CI crea
   uno nuevo con el menor privilegio (`deploy` + `--project`, `security:write` + `--project`). Nunca pongas un
   token `*` (acceso total) en CI.
3. **Pide confirmación al usuario antes de lo destructivo o de producción**: borrar proyectos, bases, ramas,
   etiquetas o repos; `capsule backups restore`; `capsule recover apply`; `network clear`; `--allow-public`
   (db o puertos); `org access-mode restricted`; `git unlink`; revocar tokens; cambiar variables de **cuenta**
   (afectan a todos los proyectos); desplegar o promover a producción; quitar protección de rama; descartar
   alertas de seguridad críticas/altas. Usa `--yes` solo cuando el usuario lo haya aprobado en esta conversación.
4. **No esquives los bloqueos**: exit 5 (regla) y exit 8 (aprobación pendiente) son decisiones del servidor. No
   quites protecciones, no bajes la política de seguridad ni te apruebes solo para pasar. Informa y espera.
5. **Prefiere menor exposición**: `--my-ip` antes que un CIDR amplio; nunca `0.0.0.0/0` ni `::/0` sin petición
   explícita del usuario para ese puerto/base.
6. **No toques el servidor a mano** (ni SSH al host, ni la base de datos, ni AWS): todo por CLI/API.
7. **Di lo que no pudiste verificar.** No inventes comandos, flags ni resultados.
8. Los tokens de Git y claves van por stdin o archivo, jamás en argv (`--token-stdin`, `--ssh-key-file`,
   `ci secrets set` lee stdin o `--from-env`).
9. **Gateway**: el token `cgc_` es de **un solo uso** y vive <= 5 min; lo pide el propio CLI en cada intento: no lo
   guardes ni lo reutilices. Ningún token del gateway (`cap_`, `cgt_`, `cgc_`, `cgs_`) va en la línea de comandos, en
   el URI `capsule://` ni en un `ProxyCommand` escrito a mano: solo por entorno (`CAPSULE_GATEWAY_TOKEN`) o la
   sesión de `capsule login`. Un `cgs_` se crea con el menor alcance (un servicio) y expiración corta, se muestra una
   sola vez y se guarda directo como secreto de CI.
10. **Puertos aleatorios (pool 20000-29999)**: entran sin token, así que la **lista de IP del servicio es la única
    barrera**; una lista vacía o inexistente **deniega** (aunque el proyecto sea público). Nunca los abras con
    `0.0.0.0/0` ni `::/0`. Libéralos (`DELETE .../port`) al terminar (24 h de cuarentena).
11. `capsule connect --listen` fuera de loopback expone tus credenciales a la red: no lo uses sin petición explícita.

## Estado real (2026-11-03)

Leyenda: **desplegado** = corre en producción; **en el código** = commiteado y probado, sin desplegar;
**planificado** = solo diseño.

- **Desplegado**: backend y frontend con migraciones hasta la **000059** (`cidr_ipv6`). Forgejo en
  `git.tumi-ai.com` con login **OIDC por Capsule**; clone/push/pull por **HTTPS verificados**. SSH de Git se anuncia
  en `:22`; el SSH de administración del host está en el **2200** (no es asunto de un agente). IPv6 aplicado en AWS
  (VPC, ALB `dualstack`, IPv6 de la instancia); DNS A de `git` y `db` existentes.
- **Desplegado (CLI)**: conexiones internas, puertos TCP, firewall, acceso a bases, backups, IPv6 en reglas.
- **En el código, NO desplegado**: el **gateway universal** (`capsule connect|tunnel|ssh`, URI `capsule://`,
  host `tcp.<zona>`/`udp.<zona>`, protocolo `capsule/1`, librerías `cli/pkg/gatewayclient` y
  `packages/gateway-js`), su API (servicios, `connection-info`, `connection-token`, tokens `cgs_`, puerto aleatorio
  20000-29999, política de org `warn|error`, acción `project.connect`) y los **puertos UDP directos**. Dependen de
  las migraciones **000060-000064, NO aplicadas en producción**: contra el servidor actual esas rutas no existen.
  Detalle: `references/gateway.md`.
- Piezas de infraestructura sin activar y límites: `references/estado-real.md`.

## Lo que NO existe todavía (no lo prometas ni lo intentes)

- **Despliegue del gateway** (servicio `capsule-gateway`, migraciones 000060-000064, DNS `tcp.`/`udp.`): hoy
  `capsule connect` no tiene a qué conectarse en producción.
- **Planificado (ni siquiera en el código)**: certificado comodín DNS-01 y toma del 443; MySQL/Redis/Mongo por SNI en
  el puerto estándar; QUIC (`transport=3` responde `0x0109`); `capsule-agent`; dominios personalizados.
- El **navegador no puede abrir TCP crudo**: no hay "conectar a la base desde el dashboard"; solo CLI y librerías.
- Variables con scope `build` aplicadas a la construcción (solo `runtime` y `both` se inyectan hoy).
- Issues, wiki, proyectos, releases y packages de Forgejo (ocultos a propósito); PR desde forks; CodeQL y
  Dependabot (los sustituyen Semgrep y Renovate).
- Comandos CLI para gestionar servicios del gateway, tokens `cgs_`, puerto aleatorio y política de org: solo con
  `capsule api` (`references/gateway.md`). Tampoco hay comando para `connection_audit_mode`.
- Borrado/archivado automático del repo de Forgejo al borrar un proyecto; `capsule projects archive`.
- `recover` automático de infraestructura (F1 Terraform) y simulacro mensual: diseño en `DR-BACKUP.md`, no medido.
