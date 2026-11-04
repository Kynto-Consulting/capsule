// Diagnostic: plain TCP echo through the Windows<->WSL localhost relay, no gateway and no TLS. Same shape as the 5 MB half-close scenario.
import net from "node:net";
const [host, port, mb] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] || 5)];
const data = Buffer.alloc(mb << 20, 7);
const s = net.connect({ host, port });
let n = 0; const t0 = Date.now();
s.on("data", (d) => { n += d.length; });
s.on("error", (e) => { console.log(JSON.stringify({ ok: false, err: e.code, got: n })); process.exit(0); });
s.on("close", () => { console.log(JSON.stringify({ ok: n === data.length, got: n, want: data.length, ms: Date.now() - t0 })); process.exit(0); });
s.on("connect", () => { s.write(data); s.end(); });
