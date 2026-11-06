import net from "node:net";

/** Opens a TCP connection to host:port through the gateway's SOCKS5 endpoint (unix socket). Only IPs of the tunnel's declared networks are accepted by the gateway. */
export function socksConnect(socketPath: string, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const ip = net.isIP(host);
    if (!ip) return reject(new Error(`ctx.vpn needs an IP address of the customer network, got "${host}"`));
    // unix socket path in the run container; tcp://host:port is accepted for local tests on systems without unix sockets
    const m = /^tcp:\/\/(.+):(\d+)$/.exec(socketPath);
    const s = m ? net.connect(Number(m[2]), m[1]) : net.connect(socketPath);
    s.once("error", reject);
    let buf = Buffer.alloc(0);
    let stage: "method" | "connect" = "method";
    const fail = (e: Error) => {
      s.destroy();
      reject(e);
    };
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === "method") {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf[1] !== 0) return fail(new Error("socks: handshake refused"));
        buf = buf.subarray(2);
        stage = "connect";
        const addr = ip === 4 ? Buffer.from(host.split(".").map(Number)) : ipv6(host);
        s.write(Buffer.concat([Buffer.from([5, 1, 0, ip === 4 ? 1 : 4]), addr, Buffer.from([port >> 8, port & 255])]));
      }
      if (stage === "connect") {
        if (buf.length < 10) return;
        s.off("data", onData);
        s.off("error", reject);
        if (buf[1] !== 0) return fail(new Error(`vpn: connection to ${host}:${port} refused by the gateway (${reason(buf[1]!)})`));
        const rest = buf.subarray(10);
        if (rest.length) s.unshift(rest);
        resolve(s);
      }
    };
    s.on("data", onData);
    s.once("connect", () => s.write(Buffer.from([5, 1, 0])));
  });
}

function reason(code: number): string {
  const m: Record<number, string> = {
    1: "failure or connection ceiling",
    2: "outside the declared networks",
    4: "host unreachable",
    7: "command not supported",
    8: "address type not supported",
  };
  return m[code] ?? `code ${code}`;
}

function ipv6(host: string): Buffer {
  const parts = host.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return Buffer.concat(groups.map((g) => Buffer.from([parseInt(g, 16) >> 8, parseInt(g, 16) & 255])));
}
