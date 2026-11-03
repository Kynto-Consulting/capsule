// Pruebas de reglas/web.yml
import jwt from "jsonwebtoken";
import cors from "cors";

declare const res: any;
declare const token: string;
declare const key: string;

export function j() {
  // ruleid: tumi-jwt-verify-without-algorithms
  jwt.verify(token, key);
  // ruleid: tumi-jwt-verify-without-algorithms
  jwt.verify(token, key, { issuer: "capsule" });
  // ok: tumi-jwt-verify-without-algorithms
  jwt.verify(token, key, { algorithms: ["HS256"] });
  // ruleid: tumi-jwt-alg-none
  jwt.sign({ a: 1 }, key, { algorithm: "none" });
  // ok: tumi-jwt-alg-none
  jwt.sign({ a: 1 }, key, { algorithm: "HS256" });
  // ruleid: tumi-jwt-decode-for-auth
  jwt.decode(token);
}

export function c() {
  // ruleid: tumi-cookie-missing-flags
  res.cookie("sid", token);
  // ruleid: tumi-cookie-missing-flags
  res.cookie("sid", token, { httpOnly: true });
  // ok: tumi-cookie-missing-flags
  res.cookie("sid", token, { httpOnly: true, secure: true, sameSite: "lax" });
}

// ruleid: tumi-cors-wildcard-credentials
cors({ origin: "*", credentials: true });
// ruleid: tumi-cors-wildcard-credentials
cors({ credentials: true, origin: true });
// ok: tumi-cors-wildcard-credentials
cors({ origin: ["https://app.tumi-ai.com"], credentials: true });
// ok: tumi-cors-wildcard-credentials
cors({ origin: "*" });
