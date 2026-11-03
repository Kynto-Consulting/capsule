# Soporte IPv6 en Capsule

Requisito: "debemos soportar el ipv6". Este documento describe el diseño, lo que ya cubre el código, lo que exige cambios de AWS/DNS/Docker y cómo activarlo (y revertirlo) sin tocar producción por sorpresa.

## 1. Qué cubre el código (ya listo, sin cambios de red)

| Área | Comportamiento |
|---|---|
| `netaccess.NormalizeCIDR` | Acepta IPv4 e IPv6. IPv6 canónico (comprimido, minúsculas, RFC 5952), bits de host a cero, dirección suelta -> `/128`. `::ffff:a.b.c.d` se trata como IPv4 (`/96`+ ; un mapeado más corto que `/96` se rechaza). Zonas (`%eth0`) rechazadas. Prefijo mínimo IPv4 `/8`, IPv6 `/32`. `0.0.0.0/0` y `::/0` solo con `allow_public` y owner/admin (misma lógica, por familia). |
| Reglas de bases (`capsule:db:`) y puertos (`capsule:port:`) | Descripción `prefijo:<uuid>[:<puerto>]:<cidr>`; los `:` del IPv6 están permitidos por EC2 (charset `a-zA-Z0-9 ._-:/()#,@[]+=&;{}!$*`, máx. 255; la más larga mide ~100). Se parsea desde la izquierda, así que el CIDR puede contener `:`. |
| Reconciliador + adaptador EC2 | IPv6 se envía como `IpPermission.Ipv6Ranges`, IPv4 como `IpRanges`; al describir se leen `CidrIpv4` y `CidrIpv6`. Solo se revocan reglas con nuestro prefijo; las ajenas (también `::/0`) nunca se tocan. Los CIDR se comparan por valor. |
| Límites | `MaxRulesPerDatabase=25` y `MaxRulesPerPort=25` cuentan reglas de ambas familias. Ojo: la cuota de AWS (60 reglas por SG y por familia, ajustable) también las cuenta por separado. |
| Allowlist de la app (proxy) | Compara por prefijo en ambas familias; un cliente IPv6 con lista no vacía ya no recibe 403 si está cubierto. Una lista solo IPv4 **no** admite clientes IPv6 (por diseño); lista vacía = público en ambas. |
| IP del cliente | `X-Forwarded-For` desde la derecha, con IPv6 (sin/con corchetes y puerto). Se saltan privadas, ULA `fc00::/7`, loopback `::1`, link-local `fe80::/10`, multicast y no especificada. Lo que está a la izquierda del primer salto público sigue sin confiarse (sin suplantación). Con ALB dualstack, el ALB añade la IPv6 del cliente. |
| `GET /network/my-ip` | `{"ip": "...", "family": "ipv4"\|"ipv6"}`. Desde una conexión solo se ve **una** dirección: la otra familia no se puede conocer; CLI y dashboard lo avisan y piden agregarla a mano. |
| Migración `000059_cidr_ipv6` | `database_access_rules.cidr` y `project_port_rules.cidr` pasan de `varchar(18)` a `varchar(43)`. `projects.ip_allowlist` es `text[]`: sin cambio. Idempotente. Down: borra las reglas IPv6 antes de estrechar. |
| CLI 0.7.3 y dashboard | Normalización equivalente a la del backend con una tabla compartida (`testdata/cidr_cases.json`, copiada en cada módulo; el test de backend avisa si difiere de la canónica). `--my-ip` agrega la dirección detectada (IPv4 o IPv6) y avisa de la otra familia. Dashboard: `isPublicCidr`/`listCoversIp` con prefijos (BigInt). |

Límites conocidos (honestos): el rate limiting por IP (`middleware/ratelimit.go`) usa la IP de socket y cuenta por /128; un atacante IPv6 puede rotar dentro de su /64. Conviene agrupar por /64 en una iteración posterior. No cambia con este trabajo.

## 2. Qué NO funciona hasta cambiar AWS / Docker / DNS

Sin los pasos de la sección 4 la plataforma sigue siendo solo IPv4 de cara a Internet: el código acepta y guarda reglas IPv6 y AWS las acepta en el SG, pero la instancia no tiene dirección IPv6 ni ruta, así que nadie puede llegar por IPv6.

## 3. Diseño de red (`deploy/terraform/ipv6.tf`, todo detrás de `ipv6_enabled = false`)

1. `aws_vpc_ipv6_cidr_block_association`: /56 de Amazon sobre la VPC por defecto. No se puede quitar mientras haya subredes que lo usen.
2. `aws_default_subnet` por AZ con `ipv6_cidr_block` (/64 vía `cidrsubnet(.., 8, i)`) y `assign_ipv6_address_on_creation`. Las subredes por defecto no se crean con `aws_subnet`; `aws_default_subnet` las **adopta** (no las crea ni las destruye). Riesgo: si el plan muestra cambios en otros atributos (por ejemplo `map_public_ip_on_launch`), parar y reconciliar. Alternativa manual: `aws ec2 associate-subnet-cidr-block --subnet-id ... --ipv6-cidr-block <un /64>` y luego `terraform import aws_default_subnet.dual["us-east-1a"] subnet-...`.
3. `aws_route ::/0 -> igw` sobre la tabla de rutas principal (no `aws_default_route_table`, que revocaría rutas no declaradas).
4. IPv6 en la instancia sin reemplazarla: `terraform_data` con `aws ec2 assign-ipv6-addresses` sobre la ENI primaria (en caliente, sin reinicio). `aws_instance.builder` tiene `ignore_changes=[ami,user_data]`; añadir `ipv6_address_count = 1` en `ec2.tf` también es una actualización en sitio, pero se evitó tocar ese archivo. El plan debe mostrar `aws_instance.builder` **sin** `must be replaced`. Reversa manual: `aws ec2 unassign-ipv6-addresses --network-interface-id <eni> --ipv6-addresses <addr>`.
5. ALB `ip_address_type = "dualstack"` (cambio en sitio de `aws_lb.capsule`, una línea en `alb.tf`, no reemplaza). Requiere que todas sus subredes tengan IPv6 (paso 2) y que el SG del ALB permita `::/0` en 80/443 (`security_groups.tf`, inline con `ipv6_cidr_blocks`, por eso vive allí y no en `ipv6.tf`). El ALB habla con los targets por IPv4: los SG 3000/8080 no cambian.
6. Reglas SG nuevas y separadas en el SG `app` (`ignore_changes=[ingress]`): 22 (git ssh), 80/443 y 2200 (solo con `git_enabled`; 2200 con `admin_ssh_ipv6_cidrs`). Las de bases y puertos extra las gestiona la API.
7. Outputs: `builder_ipv6`, `alb_dns_name_dualstack`.

Cambios en dos archivos existentes (sin efecto con `ipv6_enabled=false`): `alb.tf` (+`ip_address_type`) y `security_groups.tf` (+`ipv6_cidr_blocks` en las dos reglas del ALB; `terraform fmt` realineó esos bloques).

Plan: la sesión de AWS estaba vencida (`InvalidClientTokenId`), por lo que **no se ejecutó `terraform plan`**; solo `fmt` y `validate` (OK). Antes de activar, correr `terraform plan -var ipv6_enabled=true` y comprobar: sin `replace` en `aws_instance.builder` ni `aws_lb.capsule`; las subredes solo cambian `ipv6_cidr_block` / `assign_ipv6_address_on_creation`.

## 4. Procedimiento de activación (con reversa)

1. Desplegar el backend con la migración 000059 (puede ir antes: es inocua). Verificar: crear una regla `2001:db8::/32` en una base de pruebas **no** abre nada aún.
2. `terraform plan -var ipv6_enabled=true` (sesión AWS válida); revisar la sección 3.
3. Apply en dos tandas para poder parar: `-target=aws_vpc_ipv6_cidr_block_association.default`, luego `-target=aws_default_subnet.dual`, `aws_route.ipv6_default`, y al final el resto (instancia, ALB, SG). Reversa por tanda: `ipv6_enabled=false` (revierte ALB a `ipv4`, quita reglas/ruta; desasignar la IPv6 de la instancia con `aws ec2 unassign-ipv6-addresses`; quitar el /56 de la VPC solo si ninguna subred lo usa).
4. Docker en el host (`/etc/docker/daemon.json`, requiere reiniciar dockerd, **reinicia los contenedores**: hacerlo en ventana):
   ```json
   { "ipv6": true, "fixed-cidr-v6": "fd00:cafe:1::/64", "ip6tables": true, "experimental": true }
   ```
   (`experimental` solo en Docker < 27 para `ip6tables`.) Para redes definidas por compose: `enable_ipv6: true` y un `ipam` con subred `fd00:...` en la red. `-p host:cont` ya publica en `0.0.0.0` y `[::]` (docker-proxy / ip6tables); las bases y puertos extra se publican igual, y `heldHostPorts` entiende las líneas `[::]:puerto`. Caddy escucha en `[::]` por defecto. Con `ports: "80:80"` en compose ocurre lo mismo. Si se quiere solo IPv4 en un servicio: `127.0.0.1:` / `0.0.0.0:` explícito.
5. DNS (los aplica el dueño, no se aplican desde aquí):
   - `AAAA git  <builder_ipv6>` y `AAAA db <builder_ipv6>` (mismos nombres que sus A).
   - `*.apps` y `app`/`api` apuntan al ALB: Namecheap no tiene alias AAAA. Usar `CNAME <alb_dns_name_dualstack>`: ese nombre ya resuelve A y AAAA. Si hoy hay registros A fijos hacia IPs del ALB, reemplazarlos por el CNAME (los A de un ALB cambian; el CNAME es lo correcto). Un CNAME no convive con otros registros del mismo nombre ni en el apex.
   - TTL bajo (300) antes del cambio para poder revertir.
6. Reversa general: borrar los AAAA / volver el CNAME anterior, `ipv6_enabled=false`. El código del backend queda inocuo.

## 5. Tabla de verificación

| Verificación | Cómo | Estado |
|---|---|---|
| Normalización IPv4/IPv6 (tabla compartida, 3 implementaciones) | `go test ./internal/netaccess`, `go test ./cmd/capsule` (cli), `vitest run lib/network.test.ts` | Corrido, OK |
| Reconciliador con fake EC2, ambas familias, huérfanas, ajenas | `go test ./internal/netaccess` | Corrido, OK |
| Adaptador EC2 envía `Ipv6Ranges`/`IpRanges` y lee ambos | test con cliente simulado | Corrido, OK (no contra AWS real) |
| Allowlist del proxy con clientes IPv6, XFF IPv6 y suplantación | `go test ./internal/server/handlers`, `netaccess` | Corrido, OK |
| Columnas `varchar(43)` | `TEST_DATABASE_URL=... go test -tags dbtest ./internal/repository -run TestCIDRColumnsHoldIPv6` | Escrito, **no corrido** (requiere Postgres) |
| `terraform fmt` / `validate` | `terraform validate` | OK |
| `terraform plan -var ipv6_enabled=true` | requiere sesión AWS | **No corrido** (token vencido) |
| Red IPv6 real (SG, ALB, instancia, DNS) | tras activar: `curl -6 https://git.tumi-ai.com`, `nc -6 -zv <AAAA> 22`, `dig AAAA`, regla `2001:db8::/32` visible con `aws ec2 describe-security-group-rules` | **No verificable sin AWS** |
| Local (WSL) | servidor escuchando en `[::]:8080`, `curl -6 http://[::1]:8080/network/my-ip`, `nc -6 -l`/`nc -6 ::1 PORT`; comprueba extracción de IP y allowlist con clientes IPv6 reales de loopback | Posible; no se ejecutó en esta sesión |
