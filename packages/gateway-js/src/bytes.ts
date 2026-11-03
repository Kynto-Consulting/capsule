/** Utilidades de bytes sin dependencias de Node (válidas también en navegador). */

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new RangeError("hex inválido");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += (b[i] as number).toString(16).padStart(2, "0");
  }
  return s;
}

export function asciiToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) throw new RangeError("se esperaba ASCII");
    out[i] = c;
  }
  return out;
}

/** Decodifica ASCII estricto; devuelve null si hay algún byte >= 0x80. */
export function bytesToAscii(b: Uint8Array): string | null {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    const c = b[i] as number;
    if (c > 0x7f) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
