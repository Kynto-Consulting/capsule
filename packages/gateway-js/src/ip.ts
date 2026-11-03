/** Análisis y formato de direcciones IP (sin dependencias de Node). RFC 5952 para IPv6. */

const V4_RE = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/;

export function parseIPv4(s: string): Uint8Array | null {
  const m = V4_RE.exec(s);
  if (!m) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(m[i + 1]);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

export function parseIPv6(s: string): Uint8Array | null {
  if (s.length === 0 || s.length > 45 || s.includes("%")) return null;
  let head = s;
  let tail: string | null = null;
  const dc = s.indexOf("::");
  if (dc >= 0) {
    if (s.indexOf("::", dc + 1) >= 0) return null; // ":::" o dos "::"
    head = s.slice(0, dc);
    tail = s.slice(dc + 2);
  }
  const toGroups = (part: string, allowV4Last: boolean): number[] | null => {
    if (part === "") return [];
    const pieces = part.split(":");
    const groups: number[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i] as string;
      if (allowV4Last && i === pieces.length - 1 && p.includes(".")) {
        const v4 = parseIPv4(p);
        if (!v4) return null;
        groups.push(((v4[0] as number) << 8) | (v4[1] as number), ((v4[2] as number) << 8) | (v4[3] as number));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
        groups.push(parseInt(p, 16));
      }
    }
    return groups;
  };
  let groups: number[];
  if (tail === null) {
    const g = toGroups(head, true);
    if (!g || g.length !== 8) return null;
    groups = g;
  } else {
    const h = toGroups(head, false);
    const t = toGroups(tail, true);
    if (!h || !t) return null;
    const fill = 8 - h.length - t.length;
    if (fill < 1) return null; // "::" debe sustituir al menos un grupo
    groups = [...h, ...new Array<number>(fill).fill(0), ...t];
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = (groups[i] as number) >> 8;
    out[i * 2 + 1] = (groups[i] as number) & 0xff;
  }
  return out;
}

export function formatIPv4(b: Uint8Array): string {
  return `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;
}

/** Forma canónica comprimida RFC 5952, minúsculas. */
export function formatIPv6(b: Uint8Array): string {
  const g: number[] = [];
  for (let i = 0; i < 8; i++) g.push(((b[i * 2] as number) << 8) | (b[i * 2 + 1] as number));
  let bestStart = -1;
  let bestLen = 0;
  let i = 0;
  while (i < 8) {
    if (g[i] === 0) {
      let j = i;
      while (j < 8 && g[j] === 0) j++;
      if (j - i > bestLen) {
        bestStart = i;
        bestLen = j - i;
      }
      i = j;
    } else {
      i++;
    }
  }
  const hex = (n: number): string => n.toString(16);
  if (bestLen < 2) return g.map(hex).join(":");
  const left = g.slice(0, bestStart).map(hex).join(":");
  const right = g.slice(bestStart + bestLen).map(hex).join(":");
  return `${left}::${right}`;
}

export interface ParsedIp {
  version: 4 | 6;
  bytes: Uint8Array;
}

export function parseIp(s: string): ParsedIp | null {
  const v4 = parseIPv4(s);
  if (v4) return { version: 4, bytes: v4 };
  const v6 = parseIPv6(s);
  if (v6) return { version: 6, bytes: v6 };
  return null;
}

/** Canonicaliza una IP de origen: IPv4 mapeada en IPv6 pasa a IPv4; rechaza identificador de zona. */
export function canonicalIp(text: string): ParsedIp | null {
  if (text.includes("%")) return null;
  const ip = parseIp(text);
  if (!ip) return null;
  if (ip.version === 6) {
    const b = ip.bytes;
    let mapped = (b[10] as number) === 0xff && (b[11] as number) === 0xff;
    for (let i = 0; i < 10 && mapped; i++) if (b[i] !== 0) mapped = false;
    if (mapped) return { version: 4, bytes: b.slice(12, 16) };
  }
  return ip;
}

/**
 * Lista de IP por familia (PROTOCOL.md §12.1): una IP solo coincide con CIDR de su misma familia.
 * Es lógica del gateway; se ofrece para que las aplicaciones puedan comprobar sus propias listas.
 * Lanza RangeError si una CIDR está mal formada.
 */
export function ipAllowed(cidrs: readonly string[], ip: string): boolean {
  const c = canonicalIp(ip);
  if (!c) throw new RangeError("IP inválida");
  for (const entry of cidrs) {
    const slash = entry.indexOf("/");
    if (slash < 0) throw new RangeError("CIDR inválida");
    const net = parseIp(entry.slice(0, slash));
    const bitsStr = entry.slice(slash + 1);
    if (!net || !/^[0-9]{1,3}$/.test(bitsStr)) throw new RangeError("CIDR inválida");
    const bits = Number(bitsStr);
    if (bits > net.bytes.length * 8) throw new RangeError("CIDR inválida");
    if (net.version !== c.version) continue;
    let match = true;
    for (let i = 0; i < bits && match; i++) {
      const mask = 0x80 >> (i % 8);
      if (((net.bytes[i >> 3] as number) & mask) !== ((c.bytes[i >> 3] as number) & mask)) match = false;
    }
    if (match) return true;
  }
  return false;
}
