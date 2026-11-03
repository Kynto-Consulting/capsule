/** Ayudantes para clientes de bases de datos: abren un túnel local y devuelven opciones de conexión. */

import { listen, type ListenOptions, type TunnelServer } from "./server";
import type { ParsedUri } from "./uri";

export interface Credentials {
  user?: string;
  password?: string;
  database?: string;
}

export interface LocalEndpoint {
  host: string;
  port: number;
}

export interface ConnectionStringOptions extends Credentials {
  /** Esquema: `postgres`, `mysql`, `redis`... Por defecto `postgres`. */
  scheme?: string;
  /** Parámetros de consulta adicionales (p. ej. `{ sslmode: "require" }`). */
  params?: Record<string, string>;
}

/** Construye una cadena de conexión hacia el puerto local del túnel. Codifica usuario y clave. */
export function connectionString(endpoint: LocalEndpoint, opts: ConnectionStringOptions = {}): string {
  const scheme = opts.scheme ?? "postgres";
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  let auth = "";
  if (opts.user !== undefined) {
    auth = encodeURIComponent(opts.user);
    if (opts.password !== undefined) auth += ":" + encodeURIComponent(opts.password);
    auth += "@";
  } else if (opts.password !== undefined) {
    auth = ":" + encodeURIComponent(opts.password) + "@";
  }
  const db = opts.database !== undefined ? "/" + encodeURIComponent(opts.database) : "";
  const q = opts.params
    ? "?" + Object.entries(opts.params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : "";
  return `${scheme}://${auth}${host}:${endpoint.port}${db}${q}`;
}

export interface LocalConnection extends LocalEndpoint {
  /** Túnel local subyacente. */
  tunnel: TunnelServer;
  /** Cierra el túnel local y sus conexiones. */
  close(): Promise<void>;
}

/** Abre un túnel local y devuelve `{ host, port, close }` para cualquier cliente TCP (Redis, MySQL, etc.). */
export async function openLocal(uri: string | ParsedUri, opts: ListenOptions = {}): Promise<LocalConnection> {
  const tunnel = await listen(uri, opts);
  return { host: tunnel.host, port: tunnel.port, tunnel, close: () => tunnel.close() };
}

export interface PostgresConnection extends LocalConnection, Credentials {
  /** Cadena `postgres://usuario:clave@127.0.0.1:puerto/base`. */
  connectionString: string;
}

/**
 * Abre el túnel y devuelve la configuración para `pg` (`new Client(cfg)`) o `postgres.js`.
 * PostgreSQL negocia su propio TLS dentro del túnel (doble TLS) si usa `ssl: true`, de modo que el gateway no ve el contenido.
 */
export async function postgresConnectionOptions(
  uri: string | ParsedUri,
  opts: ListenOptions & Credentials = {},
): Promise<PostgresConnection> {
  const { user, password, database, ...lopts } = opts;
  const local = await openLocal(uri, lopts);
  const creds: Credentials = {
    ...(user !== undefined ? { user } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(database !== undefined ? { database } : {}),
  };
  return { ...local, ...creds, connectionString: connectionString(local, { scheme: "postgres", ...creds }) };
}
