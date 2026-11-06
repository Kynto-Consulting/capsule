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

## Detalles que importan

- UDP: cada datagrama viaja entero; si el lector es lento se pierden datagramas; las sesiones por origen se cierran
  al minuto sin tráfico.
- El agente hace una petición HTTP al servicio cada pocos minutos para que el proyecto no se duerma por inactividad
  (el reaper cuenta solo peticiones HTTP, no WebSockets).
- Si la base del servicio no está disponible, el servidor no acepta agentes (falla cerrado).
- Para el redeploy: un push al repo `tumi-ai/tunnel` despliega solo; vigila la memoria del servidor (ver la regla de
  no compilar a la vez que otro build).
