// Ejemplo con `mysql2` (no es dependencia de la librería: npm i mysql2).
// Uso: CAPSULE_TOKEN=cgs_... node examples/mysql2.mjs
import mysql from "mysql2/promise";
import { openLocal } from "@kyntocg/capsule-gateway";

const local = await openLocal("capsule://mi-proyecto/mysql");
const conn = await mysql.createConnection({
  host: local.host,
  port: local.port,
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [rows] = await conn.query("select 1 as uno");
  console.log(rows);
} finally {
  await conn.end();
  await local.close();
}
