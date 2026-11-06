import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Opens a TCP connection inside the function's tunnel through the Capsule relay. Used when the function runs as an AWS Lambda
 * (no VPC, no NAT): the node that owns the tunnel is connected outbound to the API, the Lambda comes in over HTTPS with its run
 * token and the API pairs them. Only IPs of the tunnel's declared networks are accepted; names are not resolved.
 */
export function relayConnect(relayUrl: string, token: string, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (!net.isIP(host)) return reject(new Error(`ctx.vpn needs an IP address of the customer network, got "${host}"`));
    const u = new URL(relayUrl);
    const mod = u.protocol === "https:" ? https : http;
    const dest = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    const req = mod.request({
      method: "POST",
      host: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      headers: { Authorization: `Bearer ${token}`, "X-Capsule-Dest": dest, Connection: "Upgrade", Upgrade: "capsule-relay", "Content-Length": "0" },
      timeout: 60_000,
    });
    req.once("upgrade", (_res, socket, head) => {
      socket.setTimeout(0);
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.once("response", (res) => {
      res.resume();
      reject(new Error(`vpn: connection to ${dest} refused by the relay (${reason(res.statusCode ?? 0)})`));
    });
    req.once("timeout", () => req.destroy(new Error("vpn: relay timeout")));
    req.once("error", reject);
    req.end();
  });
}

function reason(status: number): string {
  const m: Record<number, string> = {
    400: "destination must be ip:port",
    401: "run token is not valid for a tunnel",
    403: "outside the declared networks",
    429: "connection ceiling reached",
    502: "host unreachable",
    503: "the tunnel's node is not attached",
  };
  return m[status] ?? `status ${status}`;
}
