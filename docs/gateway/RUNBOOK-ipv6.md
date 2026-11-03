# Runbook: IPv6 y puertos del gateway (AWS + host)

Complementa `docs/ipv6.md` (diseño y activación del IPv6 en AWS) y `docs/gateway/PLAN.md` secciones 3.4, 4.3 y 7. Aquí solo lo que añade el gateway. **Nada de esto se ha aplicado**; lo ejecuta el dueño, paso a paso, con la reversa a mano. Convención: **(leído)** = consulta de solo lectura hecha el 3-nov-2026; **(?)** = no verificado.

## 0. Estado leído hoy (solo lectura)

| Elemento | Valor (leído) |
|---|---|
| Instancia | t3.medium, EIP `3.224.61.221` |
| IPv6 de la instancia | `2600:1f18:3417:6802:4ff1:e0e0:9363:cff0` (ya asignada a la ENI) |
| Security group `capsule-app` (`sg-06962b6c361003dc6`) | Entrada: 22 v4, 22 `::/0`, 80 v4, 443 v4, 2200 v4, 3000/8080 desde el ALB, 32768/32769, reglas `capsule:db:` y el rango 40000-40199 (solo la EIP). **No hay reglas IPv6 para 80/443** |
| ALB | ya en `dualstack` (un plan sin `-var ipv6_enabled=true` propone volverlo a `ipv4`) |
| Cuota de reglas | 60 por grupo y por familia (Service Quotas `L-0EA8095F` = 60) |

### Hallazgos que condicionan el orden

1. **Los registros AAAA de `git` fallarían en 443/80 hoy:** las reglas `aws_security_group_rule.ipv6_http` y `ipv6_https` (`ipv6.tf`) siguen **pendientes** en el plan (se ven como `will be created` con `-var ipv6_enabled=true -var git_enabled=true`). Aplicarlas antes de publicar cualquier AAAA que termine en Caddy.
2. **Un `terraform plan` sin variables propone DESTRUIR el IPv6** (13 recursos: subredes por defecto adoptadas, la ruta `::/0`, `terraform_data.builder_ipv6`, reglas de `git_enabled`). Producción se aplicó con `-var ipv6_enabled=true -var git_enabled=true` y **esos valores no están en `terraform.tfvars` ni en `db.auto.tfvars`**. Pasar siempre los dos `-var` (o persistirlos en un `*.auto.tfvars`; decisión del dueño). Con los dos `-var` el plan base propone 10 altas y 4 cambios, **0 destrucciones** (altas ajenas al gateway: copia de seguridad de Forgejo, reglas IPv6 80/443).
3. El plan contiene cambios pendientes que **no son del gateway** (`forgejo_backups_*`, IAM, SG de otros servicios). Por eso el apply del gateway va con `-target`.

## 1. Reglas del security group del gateway (`deploy/terraform/gateway.tf`)

Todo detrás de `gateway_enabled` (por defecto `false`, `count = 0`).

| Regla | Puerto(s) | Origen | Descripción (EC2) | Por qué |
|---|---|---|---|---|
| Pool de respaldo | TCP 20000-29999 (**una** regla de rango, IPv4 + IPv6) | `0.0.0.0/0`, `::/0` | `capsule:gwpool` | PLAN 3.4: una regla, el gateway aplica la lista de IP del proyecto en espacio de usuario |
| Estándar | TCP 5432, 3306, 6379, 27017 (una regla por puerto) | `0.0.0.0/0`, `::/0` | `capsule:gwstd:<puerto>` | SNI por nombre; la autorización es por IP/rol dentro del gateway |
| Pruebas F1 | TCP 8443 | **solo** `gateway_test_cidrs` / `gateway_test_ipv6_cidrs` (vacío = sin regla) | `capsule:gwtest` | 443 no se toca en F1; abrir solo a tu IP |
| QUIC (F3) | UDP 443 | como estándar | `capsule:gwudp` | `gateway_udp_enabled`, apagado |
| 443 TCP | — | ya existe (`git_enabled`) | — | el gateway lo toma en F2 sin regla nueva |
| 22, 2200 | — | sin cambio | — | el 22 es de Forgejo, el 2200 administración |

Presupuesto de la cuota (por familia): 5 reglas por defecto (pool + 4) de las 60.

**Por qué el reconciliador de la API no las toca (verificado en el código):**
- `netaccess/reconcile.go` (`DescPrefix = "capsule:db:"`) y `netaccess/ports.go` (`PortDescPrefix = "capsule:port:"`): `Diff`/`DiffPorts` solo revocan reglas cuya descripción **empieza** por esos prefijos (`if !ok { continue // not ours: never touch }`).
- `netaccess/ec2adapter.go` solo lista reglas TCP de **un solo puerto** (`FromPort != ToPort` se omite): el rango 20000-29999 ni siquiera llega al reconciliador. (Ya hay un rango, 40000-40199, que convive igual.)
- `capsule:gwpool`, `capsule:gwstd:`, `capsule:gwtest` y `capsule:gwudp` no empiezan por ninguno de los dos prefijos. **No renombrar descripciones a `capsule:db:`/`capsule:port:`.**
- El SG `app` tiene `ignore_changes = [ingress]`: las reglas independientes tampoco las revierte Terraform.

### Comprobación con plan (solo lectura, 3-nov-2026)

```
terraform plan -lock=false -var ipv6_enabled=true -var git_enabled=true                                        -> Plan: 10 to add, 4 to change, 0 to destroy
terraform plan -lock=false -var ipv6_enabled=true -var git_enabled=true -var gateway_enabled=true \
   -var 'gateway_test_cidrs=["203.0.113.7/32"]' -var gateway_udp_enabled=true                                  -> Plan: 17 to add, 4 to change, 0 to destroy
```
La diferencia son **7 altas** (pool, 4 estándar, pruebas, UDP) y **0 reemplazos o destrucciones** (`must be replaced`: 0). Con solo `-var gateway_enabled=true` son 5 altas. Salidas nuevas: `gateway_dns_ipv4`, `gateway_dns_ipv6`, `gateway_open_ports`.

## 2. Orden recomendado

1. **Apply de las reglas IPv6 pendientes de 80/443** (para `git`): `terraform apply -var ipv6_enabled=true -var git_enabled=true -target=aws_security_group_rule.ipv6_http -target=aws_security_group_rule.ipv6_https`. Revisar el plan antes de confirmar.
2. **Reglas del gateway, solo lo necesario para F1** (PostgreSQL por nombre + puerto de pruebas desde tu IP):
   ```
   terraform plan  -var ipv6_enabled=true -var git_enabled=true -var gateway_enabled=true \
     -var 'gateway_standard_ports=[5432]' -var 'gateway_test_cidrs=["<TU_IPV4>/32"]' -var 'gateway_test_ipv6_cidrs=["<TU_IPV6>/128"]' \
     -target=aws_security_group_rule.gw_pool -target=aws_security_group_rule.gw_standard -target=aws_security_group_rule.gw_test
   ```
   Comprobar: solo `aws_security_group_rule.gw_*` con `will be created`; luego `apply` con los mismos argumentos. (Mínimo privilegio: MySQL/Redis/Mongo se abren en F2 añadiéndolos a `gateway_standard_ports`.) Abrir el pool 20000-29999 solo cuando exista G16 (puerto aleatorio, F3); hasta entonces `-target` sin `gw_pool`.
3. **Docker en el host** (ventana; ver la sección 3 de este documento).
4. **Desplegar el gateway** (`deploy/gateway/docker-compose.gateway.yml`, sección 4) y verificar con `deploy/gateway/verify.sh --host`.
5. **Verificar desde fuera, primero IPv4**: `verify.sh --ipv4 3.224.61.221 --test-port 8443`.
6. **Publicar los A** de `RUNBOOK-dns.md`; verificar de nuevo.
7. **Verificar IPv6 con un cliente IPv6 real** (móvil con IPv6 o un VPS): `verify.sh --ipv6 2600:1f18:3417:6802:4ff1:e0e0:9363:cff0 --test-port 8443`. No es posible desde WSL (solo loopback).
8. **Solo si el paso 7 pasa: publicar los AAAA.** Un AAAA sin ruta deja a los clientes IPv6 sin acceso o con retraso (PLAN 16).

## 3. Docker del host (`deploy/gateway/daemon.json.example`; documentado, no aplicado)

El gateway usa `network_mode: host`: **no necesita IPv6 de Docker** para escuchar en `[::]` (doble pila del kernel, `bindv6only=0`, medido en loopback). El `daemon.json` hace falta para que **Caddy y los puertos publicados con `ports:`** (80/443, 22 de Forgejo, puertos de bases) respondan por IPv6 con la IP de origen correcta.

Contenido de `daemon.json.example`: `live-restore` (los contenedores siguen vivos si dockerd se reinicia), `ipv6`, `fixed-cidr-v6` (ULA `fd00:cafe:1::/64`), `ip6tables` y `experimental` (**solo Docker < 27**: desde la 27 `ip6tables` no lo necesita (**?**, conocimiento propio, comprobar con `docker version`)), y límites de logs.

Procedimiento (ventana de mantenimiento, **dockerd reiniciado**):
1. `docker version` y `docker info | grep -i "live restore"`; anotar la versión. Quitar `experimental` si es ≥ 27.
2. Primero solo `live-restore`: poner `{"live-restore": true}` en `/etc/docker/daemon.json` y `systemctl reload docker` (recargable sin reiniciar). Así el paso siguiente no reinicia los contenedores (**?**: con `live-restore` los contenedores sobreviven, pero hay que verificarlo en este host).
3. Añadir `ipv6`, `fixed-cidr-v6`, `ip6tables` → `systemctl restart docker`. Comprobar `docker ps` y los puertos directos.
4. **Router Advertisements:** al activar IPv6 de Docker el kernel pone `net.ipv6.conf.all.forwarding=1`, y con eso deja de aceptar RA, que en EC2 son las que dan la ruta IPv6 por defecto. Síntoma: el host pierde IPv6 a los minutos. Antes del paso 3: `sysctl -w net.ipv6.conf.<interfaz>.accept_ra=2` (la interfaz: `ip -6 route`, típicamente `ens5` en Nitro) y persistir en `/etc/sysctl.d/99-capsule-ipv6.conf`. (**?**: comportamiento conocido de Docker, no medido en este host.)
5. Reversa: restaurar el `daemon.json` anterior y `systemctl restart docker`; quitar el sysctl.

Si Docker no se quiere reiniciar ahora: el gateway funciona igual (modo host) y `git`/Caddy siguen solo por IPv4; el AAAA de `git` espera.

## 4. Despliegue del gateway (plantilla, sin editar el compose de producción)

```
cd /opt/capsule
cp deploy/gateway/gateway.env.example deploy/gateway/gateway.env && chmod 600 deploy/gateway/gateway.env   # completar CAPSULE_GW_CONTROL_SECRET
export CAPSULE_GATEWAY_IMAGE=<ECR>/capsule/gateway:<etiqueta-fija>
docker compose -f docker-compose.prod.yml -f deploy/gateway/docker-compose.gateway.yml --profile gateway config -q
docker compose -f docker-compose.prod.yml -f deploy/gateway/docker-compose.gateway.yml --profile gateway up -d capsule-gateway
deploy/gateway/verify.sh --host
```
Antes: comprobar que ningún proceso del host usa 5432/3306/6379/27017/8443 (`ss -ltnp`). `docker compose config` no pudo ejecutarse en la máquina de trabajo (no hay daemon ni plugin compose): el YAML solo se validó sintácticamente.

## 5. Reversa por capa (`deploy/gateway/rollback.sh` imprime el plan)

| Capa | Reversa |
|---|---|
| Gateway (host) | `deploy/gateway/rollback.sh --yes` (solo para y borra `capsule-gateway`) |
| DNS | borrar los registros nuevos de `RUNBOOK-dns.md` (TTL 5 min) |
| Security group | `terraform apply ... -var gateway_enabled=false` con los mismos `-target`; el plan debe mostrar **solo** `aws_security_group_rule.gw_*` a destruir |
| Docker | restaurar `daemon.json` y reiniciar |
| IPv6 en AWS | `docs/ipv6.md` sección 4, reversa general |

## 6. No verificado

Aplicación real de las reglas (solo `plan`); DNS; cualquier conexión IPv6 de red real (el gateway aún no existe como binario: solo el prototipo en loopback); comportamiento de Docker/`ip6tables`/`live-restore` en el host; `docker compose config` del archivo nuevo; que ningún proceso del host ocupe los puertos estándar; cuota efectiva de reglas tras los cambios.
