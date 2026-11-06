# @kyntocg/capsule-fn

Librería de las funciones de Capsule que corren dentro del túnel VPN de un proyecto. Diseño: `docs/vpn-connector.md`.

```ts
import { defineFunction } from "@kyntocg/capsule-fn";

export default defineFunction(async (ctx) => {
  const r = await ctx.vpn.http("http://10.48.0.20:8080/lista");
  ctx.log.info(await r.text());
});
```

Imagen de la función: `ENTRYPOINT ["capsule-fn", "run", "dist/main.js"]`. Ver `examples/migrar.ts`.

| `ctx` | Qué es |
|---|---|
| `ctx.vpn.http(url)` | HTTP/HTTPS por el túnel. Solo IP de las redes declaradas; no hay otra salida |
| `ctx.vpn.sftp(opts)` | SFTP por el túnel (peer opcional `ssh2`), con huella de host fijable |
| `ctx.vpn.smb(opts)` | SMB por el túnel (peer opcional `@marsaud/smb2`) |
| `ctx.vpn.connect(ip, port)` / `forward(ip, port)` | socket TCP o puerto local 127.0.0.1 para cualquier librería |
| `ctx.api.fetch(path)` | fetch a la API de la app con `Authorization: Bearer capfn_…` (corta vida, alcance mínimo) |
| `ctx.api.upload({source, init, putPart, close})` | subida reanudable: conocidos → partes de 8 MiB (reintentos) → cierre |
| `ctx.db.url(name)` | URL `postgres://…@host.docker.internal:<puerto>/…` de una base con alcance `db:<name>` |
| `ctx.storage.bucket(name)` | almacén de objetos del proyecto (`put`/`get`/`head`, SigV4) con alcance `storage:<name>` |
| `ctx.log` | logs con el token y las contraseñas de bases ocultas (`***`) |

La función nunca recibe las credenciales del túnel: las usa el gateway. `ctx.vpn` falla si la función se desplegó sin `--vpn`.
`CAPSULE_VPN_SOCKS=tcp://127.0.0.1:<puerto>` permite probar contra un gateway local sin sockets unix.

```bash
npm test      # node --test: gateway SOCKS local, subida reanudable, alcances, redacción, SigV4 contra el ejemplo de AWS
```

## Runtime Lambda (`capsule fn deploy --runtime lambda`)

```ts
import { defineFunction, lambdaHandler } from "@kyntocg/capsule-fn";
export const handler = lambdaHandler(defineFunction(async (ctx) => {
  let i = (ctx.batch.cursor as number | undefined) ?? 0;
  while (i < total) {
    if (ctx.batch.shouldYield()) return { continue: i };   // Capsule re-invokes with this cursor and a new token
    await procesar(i++);
  }
}));
```

Cada invocación es un lote de ≤13 min (`ctx.batch.remainingMs()`); el token `capfn_` llega en el evento, no en variables de entorno. `ctx.vpn` llega al túnel por el relé de la API (sin NAT).
