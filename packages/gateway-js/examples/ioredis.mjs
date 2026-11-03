// Ejemplo con `ioredis` (no es dependencia de la librería: npm i ioredis).
// Uso: CAPSULE_TOKEN=cgs_... node examples/ioredis.mjs
import Redis from "ioredis";
import { openLocal } from "@kyntocg/capsule-gateway";

const local = await openLocal("capsule://mi-proyecto/redis");
const redis = new Redis({ host: local.host, port: local.port, password: process.env.REDIS_PASSWORD, lazyConnect: true });

try {
  await redis.connect();
  await redis.set("saludo", "hola");
  console.log(await redis.get("saludo"));
} finally {
  redis.disconnect();
  await local.close();
}
