# Webhooks, auditoría y notificaciones

## Webhooks salientes (eventos de producto)

```bash
capsule webhooks list [--org-wide]
capsule webhooks create --kind http --url https://hooks.ejemplo.com/capsule --events pr.merged,deployment.failed
capsule webhooks create --kind slack --url https://hooks.slack.com/services/... --events pr.merged,deployment.failed
capsule webhooks create --kind email --email-to ops@ejemplo.com --events backup.completed
capsule webhooks update ID --events ... [--active=false] [--branch-filter 'release/*'] [--url ...]
capsule webhooks test ID                       # envía un evento de prueba
capsule webhooks deliveries ID                 # entregas recientes
capsule webhooks redeliver WEBHOOK_ID DELIVERY_ID
capsule webhooks rotate-secret ID -y           # secreto nuevo, se muestra una sola vez
capsule webhooks delete ID -y
```

- `--kind`: `http`, `slack`, `discord`, `email`. `--org-wide` usa los webhooks de la organización en vez de los
  del proyecto. `--branch-filter` es un glob de rama.
- **El secreto de firma se muestra una sola vez** al crear o rotar: guárdalo como secreto; no lo imprimas.
- Las URL de destino pasan por la política anti-SSRF (solo destinos públicos). Una respuesta 410 desactiva el
  webhook.

Eventos (catálogo de `API.openapi.yaml`): `git.push`, `git.branch.created|deleted`, `pr.opened|updated|
ready_for_review|review_submitted|review_requested|merged|closed|auto_merge_enabled`, `check.completed`,
`workflow.run.completed`, `deployment.created|succeeded|failed`, `deployment.connection_warning`,
`approval.requested|decided`, `promotion.completed`, `preview.ready|deleted`, `security.alert.created|dismissed`,
`security.suppression.expiring`, `security.policy.blocked`, `protection.changed`, `member.changed`,
`backup.completed`, `recovery.completed`.

Verificación en el receptor (para quien implemente el endpoint): cabeceras `X-Capsule-Event`, `X-Capsule-Delivery`,
`X-Capsule-Timestamp` (segundos) y `X-Capsule-Signature: sha256=<hex(HMAC-SHA256(secreto, timestamp + "." +
cuerpo_crudo))>`; comparar en tiempo constante y rechazar si `|now - timestamp| > 300 s`. Tras rotar, durante 24 h se
envía además `X-Capsule-Signature-Previous`. Reintentos con backoff (10 s, 1 min, 5 min, 30 min, 2 h, 6 h); 2xx =
entregado; el orden no está garantizado (usa `created_at` e id).

## Auditoría unificada

```bash
capsule audit --since 7d                                  # últimos 7 días
capsule audit --action git.pr.merge --actor @me --project web --since 2026-11-01T00:00:00Z --until 1d
capsule audit --since 30d --csv > auditoria.csv           # hojas de cálculo y SIEM
capsule audit --all --json --jq '.items[].action'
```

Filtros: `--action`, `--actor` (id, email o `@me`), `--project` (id o slug), `--since`/`--until` (RFC 3339 o edad
relativa `7d`), `--limit`, `--cursor`, `--all`. Lectura para administradores de la organización; retención >= 400
días. Acciones típicas: `git.protection.change`, `env.approval.decide`, `security.alert.dismiss`, `webhook.*`,
`repo.settings.change`, `member.role.change`, `recovery.run`.
Úsala después de una operación sensible (cambio de protección, aprobación, restauración) para dejar constancia en tu
informe al usuario.

## Notificaciones del usuario

```bash
capsule notifications list [--unread] [--all]
capsule notifications read [ID...] | --all
capsule notifications settings show
capsule notifications settings set --channel email=on --channel slack_dm=off --digest daily --event pr.merged=in_app,email
```

Canales: `in_app`, `email`, `slack_dm`; resumen `off|daily|weekly`.
