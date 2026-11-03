// Conexión directa (CommonJS) con half-close.
// Uso: CAPSULE_TOKEN=cgs_... node examples/connect.cjs
const { connect, NotAuthorized, Unavailable } = require("@kyntocg/capsule-gateway");

(async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30_000);
  try {
    const sock = await connect("capsule://mi-proyecto/echo", { signal: ac.signal });
    sock.write("hola");
    sock.end(); // half-close: close_notify, pero se puede seguir leyendo
    for await (const chunk of sock) process.stdout.write(chunk);
  } catch (e) {
    if (e instanceof NotAuthorized) console.error("token sin permiso o servicio inexistente");
    else if (e instanceof Unavailable) console.error("destino no disponible");
    else throw e;
  }
})();
