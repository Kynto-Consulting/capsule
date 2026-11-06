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
| `ctx.storage.bucket(name)` | almacén de objetos del proyecto (`put`/`get`/`head`/`upload`/`list`, SigV4, path-style) con alcance `storage:<name>`; en Lambda usa el endpoint público `https://<slug>-storage.apps.tumi-ai.com` |
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

## `ctx.storage`: archivos grandes

```ts
const b = ctx.storage.bucket("biblioteca");
// streaming: una parte en memoria (8 MiB por omisión, mín. 5 MiB); un solo PUT si cabe en una parte; abort si algo falla
const { size, etag } = await b.upload("expedientes/García/escrito.pdf", smbReadStream /* AsyncIterable<Uint8Array> | Uint8Array */, {
  size: 734003200,                       // opcional: si la fuente da otra cantidad, falla y aborta
  contentType: "application/pdf",
  metadata: { "source-path": String.raw`\\srv\Expedientes\García\escrito.pdf`, mtime: "2024-03-01T10:00:00Z" }, // UTF-8 (RFC 2047), 2 KB
  partSize: 16 * 1024 * 1024,
});
const info = await b.head("expedientes/García/escrito.pdf"); // { size, metadata, etag, contentType?, lastModified? } | null
let after: string | undefined;
do { const page = await b.list("expedientes/", { after, limit: 1000 }); /* page.items: {key,size,etag,lastModified}[] */ after = page.next; } while (after);
```

Firmas: `upload(key, source: AsyncIterable<Uint8Array> | Uint8Array, opts?: { size?; contentType?; metadata?; partSize? }): Promise<{ size: number; etag: string }>`,
`head(key): Promise<{ size: number; metadata: Record<string,string>; etag: string; contentType?: string; lastModified?: Date } | null>` (quien solo lee `size` no cambia),
`list(prefix, { after?, limit? }): Promise<{ items: { key; size; etag; lastModified }[]; next?: string }>` (ListObjectsV2, `next` = `after` de la página siguiente).
Las partes se reintentan 3 veces ante errores de red o 5xx.

## Imagen construida por Capsule

`capsule fn deploy <nombre> --source <dir> --runtime lambda` construye el `Dockerfile` del directorio en el builder de Capsule y lo publica en
el ECR que Capsule administra (`capsule/fn-<id>`); no hace falta registro propio. Ver `docs/vpn-connector.md` 7b.
