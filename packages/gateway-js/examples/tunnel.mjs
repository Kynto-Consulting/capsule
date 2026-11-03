// Túnel local para cualquier cliente: psql -h 127.0.0.1 -p 5433 ...
// Uso: CAPSULE_TOKEN=cgs_... node examples/tunnel.mjs capsule://mi-proyecto/db 5433
import { listen } from "@kyntocg/capsule-gateway";

const [uri, port] = process.argv.slice(2);
if (!uri) {
  console.error("uso: node tunnel.mjs <capsule://proyecto/servicio> [puerto-local]");
  process.exit(2);
}

const tunnel = await listen(uri, {
  port: Number(port ?? 0),
  onTunnelError: (e) => console.error(`[túnel] ${e.name}: ${e.message}`), // sin token
});
console.log(`escuchando en ${tunnel.host}:${tunnel.port}`);
process.on("SIGINT", async () => {
  await tunnel.close();
  process.exit(0);
});
