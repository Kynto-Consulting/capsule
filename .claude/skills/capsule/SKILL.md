---
name: capsule
description: Operar la plataforma Capsule con el CLI `capsule` y su API. Úsala cuando haya que desplegar una app, gestionar variables y secretos (vault por capa cuenta/proyecto/deploy), configurar CI/CD o workflows (Forgejo/GitHub Actions, runs, logs), abrir puertos TCP o reglas de firewall (IPv4/IPv6, --my-ip), dar acceso externo a bases de datos, hacer o restaurar backups y recuperación (recover), usar Git Capsule (clone, ramas, PR, revisión, merge, ramas protegidas, auto-merge), revisar seguridad (SARIF, Semgrep, Renovate, alertas), manejar entornos, promociones y aprobaciones, crear tokens (cap_, cgt_, alcances deploy y security:write), webhooks, auditoría, permisos por proyecto, o leer el informe de conexiones internas del deploy. Para actualizar versiones del CI autoalojado usa capsule-ci-maintenance.
---

# Capsule: uso del CLI para agentes

Capsule es una plataforma tipo Vercel sobre AWS: organización -> proyectos -> despliegues en
`https://<slug>.apps.tumi-ai.com`, más Git propio (**Git Capsule**, motor Forgejo en `git.tumi-ai.com`), CI,
seguridad, entornos con aprobaciones y respaldos. Este archivo solo enruta y fija reglas; el detalle vive en
`references/`. Todos los comandos citados se verificaron contra `capsule --help` del código actual (CLI 0.7.3).

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
| Puertos TCP extra, lista de IPs de la app, `--my-ip` | `references/puertos-firewall.md` |
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

## Estado real (2026-11-03)

- **Producción**: backend y frontend desplegados el 2026-11-03 con migraciones hasta la **000059**
  (`cidr_ipv6`).
- **Git Capsule**: Forgejo corre en `git.tumi-ai.com` con login **OIDC por Capsule**; clone, push y pull por
  **HTTPS verificados** en producción. SSH se anuncia en `git.tumi-ai.com:22` (el SSH de administración del
  host se movió al 2200; no es asunto de un agente).
- Informe de conexiones internas, `capsule connections`, IPv6 en el código (reglas, `--my-ip`), puertos, firewall,
  acceso a bases y backups por proyecto existen en el CLI.
- **El gateway universal está SOLO planificado** (`docs/gateway/PLAN.md`): no hay `capsule connect`,
  `capsule tunnel`, URIs `capsule://` ni enrutado por SNI en puerto estándar. Hoy el acceso externo a bases es
  `db.tumi-ai.com:<puerto 40000-40199>` con TLS y lista de IPs.
- Qué piezas del lado de infraestructura no están activas (IPv6 de red real, `recover` contra AWS real, simulacro)
  y límites conocidos: `references/estado-real.md`.

## Lo que NO existe todavía (no lo prometas ni lo intentes)

- Gateway universal: `capsule connect`, `capsule tunnel`, `capsule ssh`, URIs `capsule://proyecto/servicio`,
  nombres `<nombre>.db.tumi-ai.com` por SNI en el 5432, UDP, librerías cliente Go/JS. Solo plan.
- Conectividad IPv6 real de cara a Internet: el código acepta y guarda reglas IPv6, pero la red (VPC, ALB, DNS
  AAAA, Docker) requiere activar `ipv6_enabled` en Terraform; no se ha aplicado.
- Variables con scope `build` aplicadas a la construcción (solo `runtime` y `both` se inyectan hoy).
- Issues, wiki, proyectos, releases y packages de Forgejo (ocultos a propósito); PR desde forks; CodeQL y
  Dependabot (los sustituyen Semgrep y Renovate).
- Comando para cambiar `connection_audit_mode` (solo vía `capsule api`, ver `references/conexiones-internas.md`).
- Borrado/archivado automático del repo de Forgejo al borrar un proyecto; `capsule projects archive`.
- `recover` automático de infraestructura (F1 Terraform) y simulacro mensual: diseño en `DR-BACKUP.md`, no medido.
