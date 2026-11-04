# Ingreso sin balanceador (ALB): backend y dashboard

Sección de la aplicación. La infraestructura (Caddy, DNS, retiro del ALB) está en `docs/gateway/RUNBOOK-alb-removal.md`.

## Selección de modo

| Variable | Efecto |
|---|---|
| `CAPSULE_INGRESS=caddy` o `alb` | Fuerza el modo. |
| (vacía) | `ALB_LISTENER_ARN` vacío = `caddy`; con ARN = `alb` (comportamiento anterior, sin cambios). |
| `CAPSULE_INGRESS_HOST` | Nombre que el dueño crea (p. ej. `ingress.apps.tumi-ai.com`); los clientes hacen CNAME a él. |
| `CAPSULE_INGRESS_IPV4` / `CAPSULE_INGRESS_IPV6` | Direcciones del servidor para registros A/AAAA (si no hay host) y para comparar al verificar. |

`GET /api/v1/platform/capabilities` devuelve `ingress: {mode, host, ipv4, ipv6}`.

## Dominios personalizados en modo caddy

- No se llama a ACM, ELBv2 ni al ALB. Alta: valida y pasa a minúsculas el nombre, rechaza nombres de la plataforma y todo bajo `CAPSULE_APPS_DOMAIN`; estado inicial `pending_dns`; la respuesta trae `instructions` (español) y `dns_records`.
- `POST .../verify` consulta el DNS (CNAME al host de ingreso o A/AAAA hacia el servidor; todas las direcciones resueltas deben ser del servidor). Estados: `active` (también `ssl_enabled=true`), `pending_dns` (aún no resuelve), `failed` (apunta a otro destino). La respuesta incluye `message`.
- El certificado lo emite Caddy en la primera visita, tras consultar `/internal/tls/ask`.
- Route 53 automático: crea CNAME al host de ingreso, o A/AAAA si solo hay IPs.

## Contrato de `GET /internal/tls/ask?domain=<host>`

- 200 sin cuerpo solo si el host es un dominio verificado (`verified`/`active`) de un proyecto, o un nombre propio (hosts de `CAPSULE_FRONTEND_URL` y `CAPSULE_OIDC_ISSUER`, `CAPSULE_APPS_DOMAIN` exacto, `CAPSULE_INGRESS_HOST`).
- 404 sin cuerpo en cualquier otro caso (desconocido, mal formado, sin parámetro, error de BD, límite de tasa). Subdominios de `*.apps` no se autorizan aquí: los cubre el certificado comodín.
- Sin secreto. La respuesta depende solo del parámetro y de la BD, nunca de cabeceras. Consulta por el índice único `uq_domains_name`; caché en memoria 30 s (positivos) y 10 s (negativos), los errores no se cachean; límite 20 req/s (ráfaga 40) por dirección de socket (no por cabecera).
- **Requisito de red:** Caddy DEBE bloquear `/internal/*` en todos sus sitios públicos y llamar a este endpoint solo por la red interna de Docker.

## Defensa que queda en `/internal/*`

Antes: cabecera `X-Amzn-Trace-Id` (solo existe con ALB). Ahora, además:
1. Bloqueo `/internal/*` en Caddy (defensa principal) y secretos compartidos (`CAPSULE_GW_SECRET`, `CAPSULE_GIT_AUTH_SECRET`).
2. Defensa en profundidad dentro del backend (`middleware.InternalEdgeGuard` y la guarda de `/internal/gateway/*`): se rechaza con 403 cualquier petición `/internal/*` cuya `X-Forwarded-For` contenga una dirección pública. Exentos: `/internal/tls/ask` (solo lectura, responde por el parámetro) y `/internal/git-auth` (forward_auth copia a propósito la IP pública del cliente Git; allí protege el secreto). La comprobación con `X-Amzn-Trace-Id` se conserva.

IP de cliente: `netaccess.ClientIP` toma de la derecha de `X-Forwarded-For` la primera dirección pública, lo que funciona con la cadena Caddy→backend (probado, incluidos elementos falsos a la izquierda). Limitación: chi `RealIP` sigue reescribiendo `RemoteAddr` con cabeceras del cliente; el limitador global y el log lo usan.

## Previews / ECS Fargate sin ALB

Con `build_strategy=fargate` explícito y modo caddy sin ECS configurado: `POST .../deployments` responde 501 `ECS_UNAVAILABLE`, y el worker marca el despliegue fallido con el mismo mensaje. Las funciones de ECS que tocan el ALB devuelven `ErrECSNeedsALB` en vez de fallar contra AWS. El modo Docker no cambia.

## Pruebas

`internal/ingress`, `handlers/tls_ask_test.go`, `handlers/domain_caddy_test.go`, `middleware/internal_guard_test.go`, `netaccess/clientip_test.go`, `gateway/api/http_test.go`, y `repository/domain_ask_db_test.go` (`-tags dbtest`).
