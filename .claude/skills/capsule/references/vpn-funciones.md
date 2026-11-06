# VPN Connector y funciones dentro del túnel

Diseño completo: `docs/vpn-connector.md`. Operación del nodo de trabajo: `docs/vpn-connector-operacion.md`.

Para leer archivos o servicios de la red de un cliente (FortiGate, WireGuard, IPsec, OpenVPN) sin dar acceso a esa red a la app ni
pasar los datos por el host de builds: un **túnel por proyecto** y **funciones** que lo usan.

## Túnel (`capsule vpn`)

```bash
# las credenciales se leen de stdin, nunca de argumentos
echo '{"private_key":"...","peer_public_key":"...","address":"10.99.0.2/32"}' | \
  capsule vpn create estudio --provider wireguard --host 203.0.113.5:51820 --cidr 10.48.0.0/24 --secret-stdin
capsule vpn status estudio        # estado, último apretón de manos, error
capsule vpn logs estudio          # auditoría: conexión, reconexión, corridas (quién, alcance, bytes), destinos denegados
capsule vpn off estudio           # interruptor: corta conexiones, cancela corridas, revoca tokens
capsule vpn on estudio
```

| Proveedor | Credenciales (JSON por stdin) | Notas |
|---|---|---|
| `wireguard` | `private_key`, `peer_public_key`, `preshared_key`?, `address` | en espacio de usuario dentro del gateway: sin interfaz, rutas ni DNS en el host |
| `fortigate` | `username`, `password` | openfortivpn en un netns; usa `--cert-pin <sha256>` |
| `openvpn` | `username`, `password` | netns, `route-nopull` |
| `ipsec` | `psk` o `username`+`password` | strongSwan en netns |

Solo se enrutan las `--cidr` declaradas. `--cidr 0.0.0.0/0` se rechaza. Tope `--max-conns` (4) y `--bandwidth` (8 MiB/s) por túnel.
La función **nunca** recibe las credenciales: las usa el gateway.

## Funciones (`capsule fn`)

```bash
capsule fn deploy migrar --image registry/migrar:1 --vpn estudio --cron "0 2 * * *" --memory 512m --timeout 2h \
  --scope api:importacion --scope storage:biblioteca
capsule fn run migrar           # disparo por API;  capsule fn enqueue migrar  = disparo por cola
capsule fn runs migrar          # historial: quién, estado, bytes
capsule fn logs <run-id>        # cola del log (secretos ocultos);  capsule fn cancel <run-id>
```

Alcances explícitos (`api:<nombre>`, `storage:<nombre>`, `db:<nombre>`), sin comodines. Corren de a una por omisión
(`--concurrency`), con memoria sin swap, CPU, tiempo máximo y sistema de archivos de solo lectura, en el **nodo de trabajo**, no en el host de builds.

## Librería `@kyntocg/capsule-fn`

```ts
import { defineFunction } from "@kyntocg/capsule-fn";
export default defineFunction(async (ctx) => {
  const r = await ctx.vpn.http("http://10.48.0.20:8080/lista");           // también ctx.vpn.sftp / ctx.vpn.smb / ctx.vpn.forward
  await ctx.api.upload({ source: await r.buffer(), init, putPart, close }); // lista -> conocidos -> partes de 8 MiB -> cierre
  ctx.storage.bucket("biblioteca");  ctx.db.url("expedientes");              // solo con su alcance
});
```

`ctx.api.fetch` envía el token `capfn_…` de la corrida (corta vida, vive timeout+5 min, muere al terminar). La app lo valida con
`POST /api/v1/fn/tokens/introspect {"token":"capfn_…"}` → `{active, scopes, function, run_id, expires_at}` y exige el alcance exacto.
`ctx.db` entrega `postgres://…@host.docker.internal:<puerto>/…` (ruta interna); `ctx.storage` usa el almacén de objetos del proyecto.

## Permisos

Se reutilizan los átomos existentes: `network:read|manage` (túnel; `manage` es sensible), `worker:read|manage` (definir funciones),
`cron:trigger` (lanzar y cancelar corridas), `log:read` (auditoría y corridas). Panel: pestaña **VPN y funciones** del proyecto.

## Errores frecuentes

| Síntoma | Causa |
|---|---|
| 422 `one tunnel per project` / 409 | el proyecto ya tiene túnel |
| `connection ... refused by the gateway (outside the declared networks)` | el destino no está en las `--cidr`; el SDK solo acepta IP, no nombres |
| `this function is not attached to a VPN tunnel` | se desplegó sin `--vpn` |
| corrida en cola que no arranca | otra corrida de la misma función está activa (concurrencia 1), el túnel está apagado, o el nodo de trabajo está detenido |
