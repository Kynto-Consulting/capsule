# Túnel de puertos y redes (tunnel.apps.tumi-ai.com)

Servicio aparte del gateway: comparte puertos (TCP y UDP) o una red entera de una máquina con otra, o publica
una web local, usando una cuenta de Capsule. Es un proyecto normal de Capsule (`tumi-ai/tunnel`, repo propio en
Git Capsule). No es `capsule tunnel` (ese abre un puerto local hacia un servicio de un proyecto por el gateway;
ver `gateway.md`).

## Cliente

Se descarga de la web del servicio (`https://tunnel.apps.tumi-ai.com/`): PowerShell, PowerShell administrador,
CMD, Linux (sh) y macOS (sh). Los scripts de CMD, Linux y macOS bajan el cliente en Go (Windows, Linux y macOS,
Intel y ARM) la primera vez y verifican su suma de control. El de PowerShell lleva el cliente dentro.
`TUNNEL_SERVER` cambia el servidor; `CAPSULE_TUNNEL_TOKEN` sustituye el login por un token (automatización).

```bash
tunnel login | whoami | logout          # sesión con la cuenta de Capsule (navegador, PKCE); login la guarda en la máquina
tunnel share   --name mi-pc --service db=127.0.0.1:5432,ssh=22     # quien comparte
tunnel share   --name mi-web --http 3000 --public                  # web en https://tunnel.apps.tumi-ai.com/t/mi-web/
tunnel share   --name oficina --lan                                # comparte la red de la máquina (solo la cuenta dueña)
tunnel share   --name oficina --service dns=udp:53                 # servicio UDP
tunnel connect --tunnel mi-pc --map db=15432,ssh=2222              # quien consume: abre puertos locales
tunnel connect --tunnel oficina --forward 2222:192.168.1.67:22     # un host de la red compartida
tunnel connect --tunnel oficina --forward 15353:192.168.1.67:53/udp
tunnel scan    --tunnel oficina [--range 192.168.1.0/24 --ports 1-1024]   # puertos abiertos y banners
tunnel ping    --tunnel oficina --host 192.168.1.67 [--count 4]           # ICMP real, no TCP
tunnel trace   --tunnel oficina --host 192.168.1.67 [--hops 30]           # traceroute real
tunnel arp     --tunnel oficina                                          # cache ARP del agente (pasivo, no sondea)
tunnel dns     --tunnel oficina --dns-server 192.168.1.1 servidor.local   # resuelve con el DNS de esa LAN, no el tuyo
tunnel expose  --tunnel oficina --name db --local 127.0.0.1:5432 --remote-port 19090   # al revés: tu puerto, visible en esa LAN
tunnel install --name mi-pc --service db=5432     # vuelve solo (tarea programada, systemd de usuario o LaunchAgent)
tunnel uninstall --name mi-pc
tunnel release --name mi-pc                        # desconecta y libera el nombre
```

En PowerShell los parámetros llevan guion simple y las listas van con comas: `-Service db=...,ssh=22`
(no repitas `-Service`). `install` funciona sin administrador (tarea del propio usuario al iniciar sesión);
`tunnel-admin.ps1` o `--elevated` piden privilegios altos.

## Modelo de seguridad

- El servidor valida el token de Capsule contra `/oauth/userinfo` en cada conexión; el script solo presenta la identidad.
- Un nombre de túnel queda reservado para la cuenta que lo reclamó primero (tabla en la base del proyecto, sobrevive a
  reinicios; hasta 10 nombres por cuenta). Se libera con `release` o con el botón de la web.
- Solo la cuenta dueña usa la red compartida (`@ip:puerto`); las cuentas de `--allow correo` solo usan los servicios
  nombrados. El agente comprueba otra vez que la IP esté dentro de las redes declaradas.
- La web no usa cookies: el login es PKCE en el navegador y el token vive en `sessionStorage`. Los túneles HTTP
  comparten origen bajo `/t/<nombre>/`, por eso la sesión nunca debe ir en una cookie.
- El panel muestra por túnel (solo al dueño) el equipo que comparte, quién consume, el registro de eventos y
  peticiones HTTP, y el tráfico acumulado; todo persiste en la base.

## Herramientas de red reales (no solo TCP)

- `ping` y `trace` hacen un ICMP/traceroute de verdad desde la máquina que comparte (`ping`/`tracert` o
  `ping`/`traceroute` del sistema, según el SO), no un intento de conexión TCP; por eso sí sirven contra hosts que
  no tienen ningún puerto abierto. No hace falta administrador/root más allá de lo que ya pide un ping normal de ese SO.
- `arp` lee la caché ARP que el agente ya tiene (`arp -a` / `ip neigh`), filtrada a las redes compartidas; no sondea
  la red, así que puede no mostrar nada si nadie habló con esos equipos hace poco (un `ping`/`scan` antes ayuda).
- `dns` arma y manda la consulta DNS él mismo (A o `--type aaaa`), reusando el mismo túnel UDP que cualquier otro
  servicio `udp:`; sirve para resolver nombres que solo existen en esa red (DNS interno de una oficina, por ejemplo).
- `expose` es el sentido contrario a todo lo demás: en vez de alcanzar la LAN remota, hace que un servicio **tuyo**
  (`--local host:puerto`) sea alcanzable desde ella, en el puerto que el agente abre (`--remote-port`, por defecto
  en `0.0.0.0`). El agente nunca inicia una conexión hacia ti: por cada conexión que acepta en su LAN, abre un
  WebSocket saliente nuevo hacia `/ws/expose-accept` y el servidor lo empareja con una de las conexiones idle que
  `tunnel expose` mantiene abiertas (`/ws/expose`, 2 a la vez); si no hay ninguna esperando, esa conexión del lado
  de la LAN simplemente se cierra. `--name` identifica la exposición (no el nombre del túnel); solo el dueño del
  túnel puede usarlo.

## Detalles que importan

- UDP: cada datagrama viaja entero; si el lector es lento se pierden datagramas; las sesiones por origen se cierran
  al minuto sin tráfico.
- El agente hace una petición HTTP al servicio cada pocos minutos para que el proyecto no se duerma por inactividad
  (el reaper cuenta solo peticiones HTTP, no WebSockets).
- Si la base del servicio no está disponible, el servidor no acepta agentes (falla cerrado).
- Para el redeploy: un push al repo `tumi-ai/tunnel` despliega solo; vigila la memoria del servidor (ver la regla de
  no compilar a la vez que otro build).
