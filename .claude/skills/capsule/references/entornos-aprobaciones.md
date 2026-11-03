# Entornos, promociones y aprobaciones

Todo es de Capsule (Forgejo no tiene aprobaciones de despliegue). Un **entorno** es una política con nombre sobre un
proyecto; una **promoción** es la solicitud de desplegar un SHA a un entorno. Promover staging -> producción
**no recompila**: reutiliza el mismo artefacto, así lo probado es lo desplegado.

Nota de nomenclatura: `capsule env` = variables de entorno del proyecto; los entornos de despliegue son
`capsule environments` (alias `envs`).

## Definir entornos (admin)

```bash
capsule environments list
capsule environments show production
capsule environments create production --kind production --target web-prod \
    --branches main,release/** --reviewers user:ana@example.com,role:admin --approvals 1 \
    --wait-minutes 0 --window "mon-fri 09:00-18:00 America/Lima" --require-checks --from-env staging
capsule environments set production --approvals 2          # solo cambian los flags que pasas
capsule environments history production
capsule environments delete staging -y
```

Flags (verificados): `--kind staging|production|other`, `--target <proyecto id o slug>` (recibe los
despliegues; puede ser un proyecto hermano), `--branches`, `--tags` (patrones permitidos), `--reviewers
user:EMAIL|ID,role:admin|deployer`, `--approvals 0-5`, `--allow-self-approval`, `--wait-minutes`, `--window "DIAS
HH:MM-HH:MM ZONA"` (repetible), `--from-env` (solo acepta SHAs desplegados antes en ese entorno), `--require-checks`,
`--auto-deploy`.

Reglas: `allow_self_approval` es falso por defecto; los aprobadores salen de la lista del entorno, **no del rol**: un
admin no aprueba si no está listado. Crear, relajar (menos aprobaciones, `--allow-self-approval`, quitar `--window`)
o borrar un entorno de producción requiere confirmación del usuario.

## Promover

```bash
capsule promote --to production --sha a1b2c3d --from staging --comment "Probado en staging" --wait
capsule promote show <id>
capsule promote cancel <id> -y        # solo si aún no se desplegó
```

Evaluación en el servidor, en orden: rama permitida, checks verdes del SHA, política de seguridad, entorno origen,
aprobaciones (N distintas, ninguna del solicitante), espera, ventana. Estados: `pending_approval -> waiting ->
approved -> deploying -> success|failed`; salidas `rejected|cancelled|expired` (caduca a las 72 h sin decisión).

**Exit 8 = pendiente de aprobación humana.** Informa quién debe aprobar y para. No insistas, no reintentes en
bucle, no cambies la política para evitarlo.

Desde CI: la acción `actions/deploy` con `environment: production` ejecuta `promote --wait`; un token `deploy` puede
**pedir y consultar** promociones, no aprobarlas ni cancelarlas.

## Aprobar o rechazar (humanos)

```bash
capsule approvals list [-q] [--all]
capsule approvals approve <id> -m "Probado en staging"
capsule approvals reject  <id> -m "Falla el smoke test"
```

Un agente **no aprueba** promociones a producción por su cuenta: solo si el usuario, siendo aprobador listado, se
lo pide de forma explícita en la conversación y el agente actúa con la sesión de ese usuario. Quien solicitó la
promoción no puede aprobarla (salvo `--allow-self-approval`), y `SELF_APPROVAL_FORBIDDEN` -> exit 5.

## Secretos por entorno

Capsule los inyecta **solo en el paso de despliegue** (promoción), nunca en CI; así un PR no puede leerlos.

## Rollback

`capsule deployments rollback` reutiliza el rollback existente y puede saltarse espera y ventana pero **no** la
aprobación si el entorno lo exige. En producción, pide confirmación al usuario.
