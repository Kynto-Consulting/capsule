# Puertos UDP directos (sin túnel)

Un puerto de proyecto (`project_ports`) puede ser `tcp` (por defecto) o `udp`. El número público sale del mismo rango (`CAPSULE_PORT_RANGE`, 41000-41999) y la unicidad es por **(puerto, protocolo)**: el mismo número puede existir en TCP y en UDP, en el contenedor y en el host. El servicio del gateway sigue siendo el NOMBRE del puerto; su acceso `direct_port` apunta a este puerto publicado.

## Datos
Migración `000064_project_ports_udp`: `project_ports.protocol` (`tcp|udp`), índices únicos `(project_id, container_port, protocol)` y `(host_port, protocol)`, y `project_port_rules.protocol` con clave foránea compuesta `(port_id, protocol)`. Las filas existentes quedan en `tcp`. La migración inversa borra los puertos UDP.

## Firewall (security group)
- Reglas por IP de la lista del proyecto, IPv4 e IPv6, `IpProtocol: tcp|udp`, un solo puerto.
- Descripción: TCP `capsule:port:<proyecto>:<puerto>:<cidr>` (formato histórico, sin cambios) y UDP `capsule:port:udp:<proyecto>:<puerto>:<cidr>`. Solo se tocan reglas con ese prefijo; `capsule:db:`, `capsule:gw…`, SSH y las demás nunca se revocan. Una regla propia con el protocolo equivocado se revoca y se vuelve a crear.
- Se rechazan protocolos distintos de tcp/udp y puertos fuera de 1024-65535. Máximo 25 reglas por (puerto, protocolo); la cuota del SG responde `SG_RULE_LIMIT`.
- Terraform no define reglas estáticas para 41000-41999 (las gestiona solo la API por IP y `ignore_changes = [ingress]`), así que no hay nada que añadir.

## Docker
El worker publica `-p host:contenedor` (tcp) o `-p host:contenedor/udp`; un mapeo con puerto fuera de 1-65535 o protocolo desconocido nunca se publica. El healthcheck del despliegue solo sondea el puerto HTTP principal: nunca se hace un healthcheck TCP sobre un puerto UDP, y por eso un servicio solo-UDP no produce falsos fallos. Como los puertos extra son fijos, el despliegue sin solape (blue-green exclusivo) aplica también a UDP.

## API
`GET/PUT /orgs/{o}/projects/{p}/ports` llevan `protocol` en cada puerto (`PUT` sin `protocol` = tcp). `POST /ports/{container_port}/access` acepta `"protocol":"udp"` en el cuerpo o `?protocol=udp`; `DELETE /ports/{container_port}/access/{rule}` usa `?protocol=udp`. Sin protocolo = tcp, igual que antes. Errores: `INVALID_PROTOCOL` (400), `DUPLICATE_PORT` (400), `NOT_FOUND` (404, "el puerto N/udp no está publicado…"), `PORT_RANGE_EXHAUSTED` (409). La capacidad `ports` informa `"protocols":["tcp","udp"]`.

## CLI
`capsule ports add --container 7777 --udp` (o `--protocol udp`), `ports list` muestra la columna `PROTO` y filtra con `--udp` / `--protocol`, `ports access add|remove` y `ports remove` usan el mismo flag.
