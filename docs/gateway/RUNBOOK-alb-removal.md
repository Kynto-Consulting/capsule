# RUNBOOK-alb-removal: Caddy sustituye al ALB (app, api, *.apps y dominios personalizados)

Hoy el DNS de `app.tumi-ai.com`, `api.tumi-ai.com` y `*.apps.tumi-ai.com` apunta al ALB (TLS con ACM; app -> frontend:3000, api y por defecto -> backend:8080). Con este cambio los sirve Caddy (`capsule-git-proxy`) en el servidor, detrás del gateway (que ya tiene el 443 y entrega por passthrough con PROXY v2 todo SNI que no es suyo). Sin ALB desaparece su costo y su punto de fallo.

```
cliente --443--> capsule-gateway --PROXY v2--> Caddy 127.0.0.1:8444 --> app.*: frontend:3000
                                                                    --> api.*, *.apps.*, dominio personalizado: backend:8080
cliente --80---> Caddy (ACME HTTP-01 + redirección 308 a https)
```

## 1. Archivos

| Archivo | Qué es |
|---|---|
| `deploy/forgejo/caddy/capsule-sites.caddy` | Los sitios (app, api, `*.apps`, `https://` a demanda, `http://`). Compartido. |
| `deploy/forgejo/Caddyfile`, `deploy/gateway/Caddyfile.take443` | Importan `/etc/caddy/sites.d/*.caddy`; el global añade `on_demand_tls { ask }` y `protocols h1 h2`. Sin el montaje del override el glob queda vacío y Caddy sirve solo git (como antes). |
| `deploy/gateway/docker-compose.alb-off.yml` | Override (4.º `-f`): monta los sitios y `/opt/capsule/gateway/certs` (solo lectura) en git-proxy. `docker-compose.prod.yml` NO se editó. |
| `deploy/gateway/check-caddyfile-drift.sh` | Además de la identidad de los sitios, exige el `import` y `on_demand_tls` en ambos Caddyfile. |
| `deploy/gateway/acme-issue.sh` | Tras renovar, envía SIGUSR1 a `capsule-git-proxy` (recarga el certificado comodín). |
| `deploy/terraform/alb_acme_bridge.tf` | Puente ACME (variable `alb_acme_bridge`, defecto false). |
| `deploy/gateway/verify.sh` | Sección "web sin ALB" (`--custom-domain`, `--web-apps-host`). |

## 2. Qué hace Caddy (equivalencias con el ALB)

* `Host` original; `X-Forwarded-Proto: https`; `X-Forwarded-For` = SOLO la IP real (la conexión llega con PROXY v2, Caddy la ve como remote y `reverse_proxy` descarta el XFF del cliente). Es el último y único elemento, y `netaccess.ClientIP` la devuelve. Sin `trusted_proxies` a propósito.
* `/internal/*` (sin distinguir mayúsculas, con `//`, con `%69`) responde 404 en app, api, `*.apps` y dominios personalizados. `git.tumi-ai.com` conserva su manejo.
* Sustituto de `X-Amzn-Trace-Id`: Caddy pone `X-Amzn-Trace-Id: capsule-edge` en las peticiones de los sitios públicos hacia el backend. Los chequeos existentes (`gateway/api/http_internal.go`, `git_auth_internal.go`: cabecera presente = 403) siguen cerrando las rutas internas como segunda barrera, sin tocar el backend. `forward_auth` de git y la llamada `ask` no pasan por ahí y no llevan la cabecera. Mejora recomendada (cambio de backend, no hecho): sustituir esa comprobación por un marcador propio (`X-Capsule-Edge`) o servir `/internal/*` solo a IP de `capsule-net`.
* WebSocket y HTTP/2 (HTTP/3 desactivado); sin límite de cuerpo; sin tiempo máximo de respuesta (SSE `flush_interval -1`); `stream_close_delay 5m` para que una recarga no corte los WS; compresión zstd/gzip.
* Puerto 80: redirección 308 a https para todos los nombres; el desafío HTTP-01 lo atiende Caddy antes de las rutas.

## 3. Orden exacto (cada paso con su reversa)

Requisitos previos: backend con `/internal/tls/ask` desplegado (otro paquete; hasta entonces `ask` falla y Caddy RECHAZA los dominios personalizados: es seguro, pero no tendrán TLS en Caddy); `docker compose >= 2.24.4`; gateway ya con `CAPSULE_GW_TAKE_443=1` (RUNBOOK-443). Todo en `/opt/capsule`.

1. **Puente ACME (el dueño).** `terraform apply -var alb_acme_bridge=true -target=aws_lb_target_group.acme_bridge -target=aws_lb_target_group_attachment.acme_bridge -target=aws_security_group_rule.acme_bridge_from_alb -target=aws_lb_listener_rule.acme_bridge` (plan medido: 4 a añadir, 0 cambios, 0 destrucciones). *Reversa:* mismo comando con `-var alb_acme_bridge=false` (destruye solo esos 4). Comprobar: `curl -sI http://app.tumi-ai.com/.well-known/acme-challenge/x` ya no da 301 de ALB sino la respuesta de Caddy (308).
2. **Desplegar Caddy con los sitios.** `git pull`; `deploy/gateway/check-caddyfile-drift.sh`; define `F="-f docker-compose.prod.yml -f deploy/gateway/docker-compose.gateway.yml -f deploy/gateway/docker-compose.take443.yml -f deploy/gateway/docker-compose.alb-off.yml --profile gateway"`; `docker compose $F config -q`; valida el Caddyfile con la misma imagen y los tres montajes (Caddyfile.take443, capsule-sites.caddy en `/etc/caddy/sites.d/`, certs en `/certs`) con `caddy validate`; luego `docker compose $F up -d --no-deps git-proxy` (SOLO git-proxy; nunca recrear el gateway con compose up). Un `git push` HTTPS en curso se corta. Caddy obtiene los certificados de app y api por HTTP-01 vía el puente: `docker logs capsule-git-proxy 2>&1 | grep -i "certificate obtained"`. *Reversa:* quitar el 4.º `-f` y repetir `up -d --no-deps git-proxy` (vuelve a servir solo git). El ALB no se tocó.
3. **Verificar ANTES de tocar DNS**, con la IP elástica `<EIP>`: `curl -s --resolve app.tumi-ai.com:443:<EIP> https://app.tumi-ai.com/ -o /dev/null -w '%{http_code} %{ssl_verify_result}\n'` (200/30x y `0`); igual para `api.tumi-ai.com` y para un `<servicio>-<proyecto>.apps.tumi-ai.com` real; `curl --resolve api.tumi-ai.com:443:<EIP> https://api.tumi-ai.com/internal/git-auth` debe dar 404. Todo junto: `deploy/gateway/verify.sh --ipv4 <EIP> --web-apps-host <x-y.apps.tumi-ai.com> [--custom-domain <dominio verificado>]`. Si el comodín falla: `ls -l /opt/capsule/gateway/certs` y `docker exec capsule-git-proxy ls -l /certs`. Probar el login completo de `app` contra `api` con `--resolve` en el navegador. Nada que revertir (DNS intacto).
4. **El dueño cambia los registros** (TTL bajo antes, 300 s): `app`, `api` y `*.apps` de CNAME-al-ALB a A (y AAAA si hay) de la IP elástica. Los CNAME de dominios de clientes que apunten al nombre del ALB deben pasar a `app`/`api`/la IP. *Reversa:* restaurar los CNAME al ALB (sigue vivo con sus certificados ACM).
5. **Verificar** sin `--resolve`: mismas comprobaciones por nombre; `docker logs capsule-git-proxy` sin errores TLS; métrica `RequestCount` del ALB cayendo a 0; `verify.sh` completo.
6. **Apagar el ALB** (días después, con tráfico del ALB en 0): primero `alb_acme_bridge=false`; luego quitar `alb.tf` y reglas del SG con Terraform y `terraform apply` (plan revisado por el dueño). *Reversa:* revertir el cambio de `alb.tf`, apply, y el paso 4 a la inversa (si el certificado ACM se destruyó hay que validarlo de nuevo por DNS).

## 4. Renovación del comodín

`acme-issue.sh` instala el par con `mv` atómico en `/opt/capsule/gateway/certs`, envía SIGHUP al gateway y ahora SIGUSR1 a Caddy. Medido con `admin off`: el certificado servido cambia y un WebSocket abierto sobrevive. El volumen es el directorio, no los archivos (un bind de archivo seguiría en el inodo viejo). Caddy corre como root en el contenedor y lee la clave 0600 de uid 65532 sin cambiar permisos.

## 5. Riesgos en producción

1. Gateway y Caddy pasan a ser el único camino de la web y de la API. Un reinicio del gateway (~5 s) o de Caddy corta app/api/apps; el backend sigue siendo una sola instancia.
2. `up -d git-proxy` corta `git push` HTTPS en curso y los WS de logs (una recarga por SIGUSR1 no corta los WS).
3. La IP de cliente depende de PROXY v2 (`GW_PROXY_TRUSTED` bien medido). Por el puerto 80 no hay PROXY (solo redirige y ACME).
4. Los límites por IP del gateway (`CAPSULE_GW_NEW_CONNS_PER_IP` 20/s, `MAX_CONNS`) ahora cuentan también la web: subirlos antes del paso 4 si hay oficinas con CGNAT.
5. Dominios personalizados existentes: comprobar a qué apuntan sus DNS (si apuntan al nombre del ALB dejan de resolver).
6. TLS a demanda depende del `ask` del backend (200/404, sin cuerpo, rápido). Si el backend cae, los dominios nuevos fallan; los ya emitidos siguen (volumen `capsule-git-caddy`, que debe respaldarse). Let's Encrypt limita emisiones por semana: el `ask` solo debe avalar dominios verificados.
7. El ALB enviaba `X-Forwarded-Port`; Caddy no. Comprobar que backend y frontend no lo usan.
8. HTTP/3 desactivado (UDP 443 no publicado).
