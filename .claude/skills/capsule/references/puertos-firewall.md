# Puertos TCP/UDP extra y lista de IPs de la app

Dos controles distintos, ambos por proyecto y sin Terraform:

| Control | Qué decide | Comandos |
|---|---|---|
| **Puertos extra (TCP o UDP)** | quién puede conectar a un puerto publicado de la app (además de HTTPS) | `capsule ports ...` |
| **Lista de IPs de la app** (`network`) | quién puede abrir la app en el navegador | `capsule network ...` |

Las bases de datos tienen su propio control: `bases-acceso-externo.md`. Todos los CIDR aceptan IPv4 e IPv6
(`ipv6.md`). Un token `deploy` no puede usar ninguno de estos comandos (403).

## a) Puertos extra (`capsule ports`)

Los puertos son **privados por defecto** (nadie conecta hasta que permitas IPs). Cada cambio **reinicia el
contenedor** y el backend asigna un puerto de host estable (rango 41000-41999).

```bash
capsule ports list                                           # host:puerto asignado + reglas
capsule ports add --container 5432 --name pg --my-ip         # publica y permite TU IP pública (/32 o /128)
capsule ports add --container 8080 --cidr 203.0.113.0/24 --cidr 198.51.100.7
capsule ports add --container 9000                           # privado: nadie conecta aún
capsule ports access add 5432 --my-ip --desc "portátil"      # permitir más IPs a un puerto existente
capsule ports access remove 5432 <id-regla|cidr>
capsule ports remove --container 9000                        # pide confirmación (-y)
capsule ports add --container 7777 --udp --name game --my-ip   # UDP (= --protocol udp); en el código, sin desplegar
capsule ports list --udp                                     # filtra por protocolo; la columna PROTO dice tcp/udp
```

Reglas:
- Un CIDR suelto se normaliza (`1.2.3.4` -> `1.2.3.4/32`). Máximo 25 reglas por puerto (ambas familias cuentan).
- `0.0.0.0/0` y `::/0` solo con `--allow-public` y confirmación. **No lo uses** salvo petición explícita del usuario
  para ese puerto.
- Prefiere `--my-ip`. Con VPN/WARP la IP rota: vuelve a ejecutar `--my-ip`, no amplíes el rango.
- Tras cambiar: `capsule ports list` y prueba (`nc -zv host puerto`). Recuerda que se reinició el contenedor:
  avisa al usuario antes en producción.

- **UDP**: el mismo número puede existir en tcp **y** en udp. `ports access add|remove` y `ports remove` también
  aceptan `--udp`/`--protocol udp`; **sin el flag actúan sobre el TCP**. Reglas del firewall con `IpProtocol` udp;
  máximo 25 reglas por (puerto, protocolo). Estado: en el código, migración 000064 sin aplicar en producción
  (`udp-ipv6.md`).
- **Camino**: el puerto directo es el método **secundario**; el gateway (`capsule connect proyecto/servicio`,
  `gateway.md`) es el primario cuando esté desplegado. Un servicio del gateway se llama como el **nombre** del puerto
  (`--name`): ponle un nombre claro (`pg`, `game`) porque será el `<servicio>` del URI.
- **Puerto aleatorio (20000-29999)**: respaldo del gateway, sin token; solo manda la lista de IP del servicio y
  **vacía deniega**. No se gestiona con `capsule ports`, sino con `capsule api POST .../gateway/services/<svc>/port`
  (`gateway.md`). Máximo de cuotas por proyecto/organización (`409 port_quota_exceeded`).

## b) Lista de IPs de la app (`capsule network`)

```bash
capsule network show
capsule network allow --my-ip                # añade (o --cidr 203.0.113.0/24, repetible)
capsule network deny  --cidr 203.0.113.0/24
capsule network set   --cidr a --cidr b      # reemplaza la lista
capsule network clear -y                     # vacía = app pública; pide confirmación
```

- **Lista vacía = app pública. Una lista no vacía bloquea a todos los demás, incluido tú.** Añade primero tu IP
  (`--my-ip`) y verifica que sigues entrando antes de dejarlo así.
- Máximo 50 entradas; `0.0.0.0/0` no se acepta (usa `clear`). Una lista solo IPv4 **no** admite clientes IPv6 (por
  diseño); lista vacía es pública en ambas familias.
- Los cambios pueden tardar hasta ~15 s.
- 501 `NOT_CONFIGURED` = el firewall no está configurado en el servidor (`APP_SECURITY_GROUP_ID`): díselo al
  usuario; no hay rodeo.

## `--my-ip`

Pide al servidor tu IP pública vista desde la conexión (`GET /network/my-ip`), imprime `Your public IP: …` y la
añade como `/32` (IPv4) o `/128` (IPv6). Desde una conexión solo se ve **una** familia: el CLI avisa de que la
otra familia no se puede conocer y hay que añadirla a mano con `--cidr` si hace falta.
Dentro de un contenedor o CI, tu IP "pública" es la del runner, no la del usuario: no uses `--my-ip` ahí; pide
el CIDR al usuario.

## Flujo seguro para abrir un puerto

1. `capsule ports list` (estado actual). 2. Confirma con el usuario puerto, quién conecta y si es producción.
3. `capsule ports add --container N --name x --my-ip` (o `--cidr` acotado). 4. `capsule ports list` para
verificar. 5. Cuando ya no haga falta: `capsule ports access remove …` o `capsule ports remove --container N -y`.
