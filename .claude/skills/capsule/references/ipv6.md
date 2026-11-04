# IPv6

Fuente: `docs/ipv6.md`. Resumen para un agente: el **código** ya soporta IPv6; la red de AWS ya tiene IPv6 aplicado (ver abajo).

## Qué funciona hoy (código)

| Área | Comportamiento |
|---|---|
| CIDR de reglas (`ports`, `db access`, `network`) | acepta IPv4 e IPv6; IPv6 canónico (comprimido, minúsculas); dirección suelta -> `/128`; bits de host a cero; zonas (`%eth0`) rechazadas; `::ffff:a.b.c.d` cuenta como IPv4 |
| Prefijos mínimos | IPv4 `/8`, IPv6 `/32` |
| Público | `0.0.0.0/0` y `::/0` solo con `--allow-public`, owner/admin y confirmación (por familia) |
| `--my-ip` | añade tu IP detectada como `/32` o `/128` y avisa de que la otra familia no se puede conocer |
| Límites | 25 reglas por base y por puerto (ambas familias juntas); AWS cuenta 60 reglas por SG **por familia** |
| Lista de IPs de la app | compara por prefijo en ambas familias; una lista solo IPv4 no admite clientes IPv6; lista vacía = pública |
| IP del cliente | se toma de `X-Forwarded-For` desde la derecha; privadas, ULA, loopback, link-local y multicast se saltan |
| Migración | `000059_cidr_ipv6` (columnas `cidr` a `varchar(43)`), ya aplicada en producción |

Ejemplos:

```bash
capsule db access add mydb --cidr 2001:db8:abcd::/48 --desc "oficina IPv6"
capsule ports access add 5432 --cidr 2001:db8::1            # queda 2001:db8::1/128
capsule network allow --my-ip                               # IPv4 o IPv6 según tu conexión
```

Si el usuario usa ambas familias, añade las dos explícitamente (`--my-ip` solo detecta una).

## Estado de la red (2026-11-03)

- **Aplicado en AWS**: VPC con IPv6, ALB `dualstack` e IPv6 en la instancia.
- **Registros DNS**: constan los **A** de `git` y `db`. No des por hechos los `AAAA` (`git`, `db`, `tcp.`/`udp.` del
  gateway): compruébalo (`dig AAAA git.tumi-ai.com`) o pregunta al usuario.
- **Docker con IPv6 en el host** (publicar `[::]`) y la conectividad real de punta a punta por IPv6: verifícalas
  con el usuario antes de prometer que un cliente IPv6 llega a un puerto o base.
- Un agente no aplica Terraform ni toca DNS ni Docker del host. Procedimiento y reversa: `docs/ipv6.md` sección 4.

Verificación (para el usuario): `curl -6 https://git.tumi-ai.com`, `nc -6 -zv <AAAA> 22`, `dig AAAA …`.
Gateway e IPv6 (`family=`, Happy Eyeballs): `udp-ipv6.md`.

## Límite conocido

El rate limiting por IP cuenta por /128: un atacante IPv6 puede rotar dentro de su /64. No cambia con este trabajo.
