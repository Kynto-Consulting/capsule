# Runbook: certificados comodín `*.apps` y `*.db` (Let's Encrypt DNS-01, Route53 delegado)

Objetivo: el gateway (modo `terminate` y túnel `capsule/1`) sirve `*.apps.tumi-ai.com` y `*.db.tumi-ai.com`, emitidos con DNS-01 **sin entregar la zona `tumi-ai.com`**: el dueño delega por CNAME solo `_acme-challenge.apps` y `_acme-challenge.db` hacia una zona de Route53 (`acme.tumi-ai.com`) que solo puede escribir un rol IAM mínimo. `tcp.apps` y `udp.apps` quedan cubiertos por `*.apps` (una etiqueta). `git` sigue con HTTP-01 de Caddy.

## Cómo funciona (qué eligió G9 y por qué)

| Pieza | Decisión | Motivo |
|---|---|---|
| Cliente ACME | **lego v4.25.2** en contenedor, fijado por digest `sha256:01d6d764…a40b` (`goacme/lego`) | Binario estático, `--dns route53`, sigue el CNAME de `_acme-challenge` de serie, `renew --days N` idempotente. certbot necesita plugin + pip + red a PyPI; Caddy-DNS obliga a recompilar Caddy y G10 lo está tocando |
| Privilegios del contenedor | `--read-only --cap-drop ALL --no-new-privileges`, usuario 65532, red bridge (no `host`), solo `/data` (estado) escribible | Mínimo |
| Credenciales AWS | **Sin clave de larga vida.** El host ya corre con el perfil de instancia `capsule-builder`; ese rol recibe un único permiso extra (`sts:AssumeRole` sobre `capsule-acme`) y el script asume el rol 15 min por ejecución. Las credenciales temporales van a un archivo 0600 en `/dev/shm` que se borra al salir | Nada en `.env`, nada en disco. El rol `capsule-acme` solo escribe TXT `apps.acme.<zona>` y `db.acme.<zona>` en una zona (condiciones `ChangeResourceRecordSetsNormalizedRecordNames`, `…RecordTypes=TXT`, `…Actions=UPSERT/DELETE`) |
| Selección por SNI | El gateway carga **varios pares** y usa el primero que admite el SNI (`FileCerts.GetCertificate`, `SupportsCertificate`) | Ya soportado: no se tocó `certs.go` |

El TXT no vive en `_acme-challenge.apps.tumi-ai.com` sino en el destino del CNAME (`apps.acme.tumi-ai.com`); por eso la condición IAM nombra `apps.acme…` y `db.acme…`.

Variable exacta del gateway (en `deploy/gateway/gateway.env`; coma entre pares, mismo orden en las dos):

```
CAPSULE_GW_TLS_CERT=/certs/wildcard-apps.crt,/certs/wildcard-db.crt
CAPSULE_GW_TLS_KEY=/certs/wildcard-apps.key,/certs/wildcard-db.key
```

Se recargan con `SIGHUP` (lo envía `acme-issue.sh`) o cuando cambia la fecha del archivo; si un par nuevo no carga, el gateway conserva los anteriores. `/certs` es el volumen `/opt/capsule/gateway/certs` del compose (solo lectura, uid 65532). Nota: `gateway.env.example` tenía `CAPSULE_GW_CERT_DIR`, que el binario no lee; se sustituyó por las dos variables anteriores. El túnel `capsule/1` solo se atiende para los hosts de túnel (`tcp.<zona>`, `udp.<zona>`, `CAPSULE_GW_TUNNEL_HOSTS`) y exige ALPN `capsule/1` en el ClientHello.

## Pasos, en orden

**A. Lo que aplicas tú (AWS, desde tu máquina):**

1. En `deploy/terraform/prod.auto.tfvars` añadir `acme_enabled = true`.
2. `eval "$(aws configure export-credentials --profile tumi-admin --format env)"; cd deploy/terraform; terraform plan -target=aws_route53_zone.acme -target=aws_iam_role.acme -target=aws_iam_role_policy.acme -target=aws_iam_role_policy.builder_assume_acme` — deben ser **4 recursos a crear, 0 a cambiar o destruir**. (El plan completo hoy además muestra deriva ajena a este paquete: 8 a crear de `forgejo_backups` y 4 cambios en SG y política de la API; por eso se usa `-target`.)
3. `terraform apply` con los mismos `-target`.
4. `terraform output acme_ns_records acme_cname_records acme_zone_id acme_role_arn`.

**B. Lo que pone el dueño en Namecheap** (Advanced DNS → Host Records; TTL: CNAME 5 min, NS 30 min):

| Host | Tipo | Valor |
|---|---|---|
| `_acme-challenge.apps` | CNAME | `apps.acme.tumi-ai.com.` |
| `_acme-challenge.db` | CNAME | `db.acme.tumi-ai.com.` |
| `acme` | NS ×4 | los 4 valores de `acme_ns_records` (`ns-….awsdns-….…`) |

Si el panel de Namecheap no admite NS de subdominio (no verificado), usar la alternativa de RUNBOOK-dns.md §3.

**C. Verificar la delegación (antes de emitir):**

```
dig +short CNAME _acme-challenge.apps.tumi-ai.com   # apps.acme.tumi-ai.com.
dig +short CNAME _acme-challenge.db.tumi-ai.com     # db.acme.tumi-ai.com.
dig +short NS acme.tumi-ai.com                      # los 4 de AWS
```

**D. En el host (SSH; lo haces tú):**

1. `cd /opt/capsule && git pull` (o copiar `deploy/gateway/acme-issue.sh`, `acme.env.example`, `capsule-acme.service|timer`).
2. `cp deploy/gateway/acme.env.example deploy/gateway/acme.env; chmod 600 deploy/gateway/acme.env` y rellenar `ACME_ZONE_ID` y `ACME_ROLE_ARN` (los outputs). Requiere `aws` CLI, `docker` y `openssl` en el host.
3. Prueba con el CA de pruebas (no instala nada en el gateway): `sudo deploy/gateway/acme-issue.sh --staging` → deja `wildcard-apps.{crt,key}` y `wildcard-db.{crt,key}` en `/opt/capsule/gateway/acme/staging-out`. Comprobar: `openssl x509 -in …/wildcard-apps.crt -noout -issuer -ext subjectAltName`.
4. Emisión real: `sudo deploy/gateway/acme-issue.sh` (1-2 min por comodín). Escribe `/opt/capsule/gateway/certs/wildcard-{apps,db}.{crt,key}` (dueño 65532; `.key` 0600, `.crt` 0644) y envía SIGHUP a `capsule-gateway`.
5. En `gateway.env` poner las dos variables `CAPSULE_GW_TLS_CERT/KEY` de arriba. Si el gateway ya estaba en marcha con el certificado de `tcp.apps` (Caddy + `sync-certs.sh`), recrear el contenedor **después**, con el procedimiento sin corte de PLAN.md §9 (no `docker restart`).
6. Activar el temporizador diario: `sudo cp deploy/gateway/capsule-acme.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now capsule-acme.timer`. Cuando el comodín funcione: `sudo systemctl disable --now capsule-gateway-certs.timer` (sustituye a `sync-certs.sh`).

**E. Verificar extremo a extremo:** `echo | openssl s_client -connect tcp.apps.tumi-ai.com:8443 -servername tcp.apps.tumi-ai.com -alpn capsule/1 2>/dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName` (puerto 8443 mientras el gateway no tome el 443) → emisor Let's Encrypt, SAN `*.apps.tumi-ai.com`. `sudo deploy/gateway/acme-issue.sh --check` lista los días restantes.

## Renovación y alarma

- `capsule-acme.timer`: diario 03:17 (+ hasta 30 min al azar). El script no hace nada si a ambos certificados les quedan más de 30 días (Let's Encrypt dura 90): renueva a partir de los 60 y tiene unos 30 días de reintentos diarios.
- `capsule-acme.service` ejecuta además `acme-issue.sh --check` (falla si a algún certificado le quedan menos de 21 días): la unidad queda `failed`. Alarma: `systemctl is-failed capsule-acme.service` o `acme-issue.sh --check` desde el monitoreo existente (sale 1 si falta o está por vencer). No se creó alarma de CloudWatch.
- **Si falla la renovación:** el certificado vigente sigue sirviéndose (el script no toca nada hasta tener un par nuevo y coherente). Ver `journalctl -u capsule-acme`. Causas habituales: CNAME o NS borrados o mal escritos en Namecheap (repetir C), rol sin permiso (`AccessDenied` de Route53), límite de tasa de Let's Encrypt (esperar). Reintento manual: `sudo systemctl start capsule-acme.service`; forzar: `sudo deploy/gateway/acme-issue.sh --force`. Plazo duro: a los 90 días el gateway presenta un certificado vencido.
- La clave de cuenta ACME y las claves de los comodines quedan en `/opt/capsule/gateway/acme` (0700, uid 65532): incluir en la copia de seguridad del host y rotar al restaurar.

## Reversa

1. `sudo systemctl disable --now capsule-acme.timer`. El gateway sigue con los certificados ya instalados hasta que venzan; para volver al de Caddy: reactivar `capsule-gateway-certs.timer`, `CAPSULE_GW_TLS_CERT=/certs/tcp.apps.tumi-ai.com.crt` (+ `KEY`) y SIGHUP.
2. Borrar de Namecheap los 2 CNAME y los 4 NS (nada existente se modificó).
3. `acme_enabled = false` y `terraform apply` (destruye solo los 4 recursos de `acme_zone.tf`; la zona debe estar sin registros: borrar antes los TXT residuales si los hay).

## Qué se probó y qué no

Probado en local (WSL/Docker, sin AWS): `pebble` + `pebble-challtestsrv` con CNAME `_acme-challenge.<x>.test.local → <x>.acme.test.local` y TXT escrito en el destino; `acme-issue.sh` emitió ambos comodines por DNS-01, es idempotente (segunda ejecución: "nada que hacer"), `--force` renovó, `--check` devuelve 0 o 1 según los días, y el binario real `capsule-gateway` (Linux) sirvió por SNI `*.apps` y `*.db` (SAN correcto en cada nombre), cambió de serie tras renovar más SIGHUP, y una conexión TLS abierta antes del SIGHUP siguió abierta.

**No verificado:** emisión contra Let's Encrypt (staging o producción); el proveedor `route53` de lego con el rol real (en la prueba se usó `exec`); `aws sts assume-role` desde el perfil de la instancia y que el host tenga `aws` CLI; el apply de Terraform (solo `validate` y `plan`); que Namecheap acepte los NS de subdominio; `dig` real desde Internet.
