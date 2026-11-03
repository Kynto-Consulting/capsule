// Pruebas de reglas/crypto.yml
import crypto from "crypto";
import fs from "fs";

declare const logger: any;
declare const key: Buffer;
declare const dek: Buffer;
declare const keyId: string;
declare const signature: string;
declare const expectedSignature: string;

// ruleid: tumi-math-random-secret
const sessionToken = Math.random().toString(36).slice(2);
// ok: tumi-math-random-secret
const jitter = Math.random() * 100;
// ok: tumi-math-random-secret
const sessionTokenOk = crypto.randomBytes(32).toString("hex");

// ruleid: tumi-weak-hash-or-cipher
crypto.createHash("md5");
// ruleid: tumi-weak-hash-or-cipher
crypto.createCipheriv("aes-128-ecb", key, null);
// ok: tumi-weak-hash-or-cipher
crypto.createHash("sha256");

// ruleid: tumi-cipher-fixed-iv
crypto.createCipheriv("aes-256-gcm", key, Buffer.from("000000000000", "utf8"));
// ruleid: tumi-cipher-fixed-iv
crypto.createCipheriv("aes-256-gcm", key, Buffer.alloc(12));
// ok: tumi-cipher-fixed-iv
crypto.createCipheriv("aes-256-gcm", key, crypto.randomBytes(12));

export function cmp() {
  // ruleid: tumi-hmac-nonconstant-compare
  if (signature === expectedSignature) return true;
  // ok: tumi-hmac-nonconstant-compare
  if (signature === undefined) return false;
  // ruleid: tumi-hmac-nonconstant-compare
  if (createHmac("sha256", k).update(body).digest("hex") !== signature) return false;
  // ruleid: tumi-hmac-nonconstant-compare
  if (req.headers.providedSignature !== expectedSignature) return false;
  // ok: tumi-hmac-nonconstant-compare
  if (token === "background") return false;
  // ok: tumi-hmac-nonconstant-compare
  if (token.length === 0) return false;
  // ok: tumi-hmac-nonconstant-compare
  if (campo.tokens !== columna) return false;
  // ok: tumi-hmac-nonconstant-compare
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

// ruleid: tumi-hardcoded-secret
const API_SECRET = "Xk9fLm2PqR7sT4vW8yZ1aB3c";
// ok: tumi-hardcoded-secret
const API_KEY_HEADER = "x-api-key";
// ok: tumi-hardcoded-secret
const apiSecret = process.env.API_SECRET;

export function keys() {
  // ruleid: tumi-key-material-in-log
  console.log("dek", dek);
  // ruleid: tumi-key-material-in-log
  logger.info("loaded", dek);
  // ok: tumi-key-material-in-log
  console.log("key id", keyId);
  // ruleid: tumi-key-written-to-disk
  fs.writeFileSync("/data/dek.bin", dek);
  // ok: tumi-key-written-to-disk
  fs.writeFileSync("/data/out.bin", Buffer.from("x"));
}
