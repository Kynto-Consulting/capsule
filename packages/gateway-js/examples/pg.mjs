// Ejemplo con `pg` (no es dependencia de la librería: npm i pg).
// Uso: CAPSULE_TOKEN=cgs_... node examples/pg.mjs
import { Client } from "pg";
import { postgresConnectionOptions } from "@kyntocg/capsule-gateway";

const conn = await postgresConnectionOptions("capsule://mi-proyecto/db", {
  // token: se toma de CAPSULE_TOKEN si no se indica
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "postgres",
});

// PostgreSQL negocia su propio TLS dentro del túnel (doble TLS): el gateway no ve el contenido.
const client = new Client({
  host: conn.host,
  port: conn.port,
  user: conn.user,
  password: conn.password,
  database: conn.database,
  ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: true } : false,
});

try {
  await client.connect();
  const { rows } = await client.query("select version()");
  console.log(rows[0]);
} finally {
  await client.end().catch(() => {});
  await conn.close();
}
