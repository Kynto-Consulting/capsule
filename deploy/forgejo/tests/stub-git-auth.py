#!/usr/bin/env python3
"""Stub de /internal/git-auth para probar el Caddyfile (el endpoint real lo implementa el paquete A7).

Contrato que imita (ver INTEGRATION.md, "Borde de acceso"):
  - sin Authorization Basic, o contrasena que no empieza por cgt_  -> 200 sin X-WEBAUTH-USER (Forgejo decide)
  - contrasena cgt_good...  -> 200 + X-WEBAUTH-USER: <usuario del Basic>
  - contrasena cgt_limited  -> 429 + Retry-After
  - cualquier otro cgt_     -> 401 + WWW-Authenticate: Basic realm="Git Capsule"
El endpoint exige X-Capsule-Git-Auth == CAPSULE_GIT_AUTH_SECRET (503 si no; como el de A7) y rechaza X-Amzn-Trace-Id.
Ademas: GET /__calls devuelve cuantas veces se llamo a /internal/git-auth y las ultimas cabeceras recibidas (solo para las pruebas).
Uso: stub-git-auth.py <puerto>
"""
import base64, json, os, sys
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("CAPSULE_GIT_AUTH_SECRET", "")
STATE = {"calls": 0, "last_headers": {}, "last_path": "", "last_method": "", "secret_ok": None}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # silencioso: no imprimir credenciales
        pass

    def _send(self, code, headers=None, body=b""):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path  # forward_auth conserva la query original (?service=git-upload-pack): el endpoint real debe ignorarla
        if path == "/__calls":
            return self._send(200, {"Content-Type": "application/json"}, json.dumps(STATE).encode())
        if path != "/internal/git-auth":
            return self._send(404)
        STATE["calls"] += 1
        STATE["last_headers"] = {k: v for k, v in self.headers.items() if k.lower() != "authorization"}
        STATE["last_headers"]["_has_authorization"] = "Authorization" in self.headers
        STATE["last_path"] = self.headers.get("X-Forwarded-Uri", "")
        STATE["last_method"] = self.headers.get("X-Forwarded-Method", "")
        STATE["secret_ok"] = bool(SECRET) and self.headers.get("X-Capsule-Git-Auth", "") == SECRET
        STATE["last_headers"].pop("X-Capsule-Git-Auth", None)
        if SECRET and not STATE["secret_ok"]:
            return self._send(503, body=b"secreto compartido ausente o incorrecto\n")
        if "X-Amzn-Trace-Id" in self.headers:  # como el endpoint real de A7
            return self._send(400)
        auth = self.headers.get("Authorization", "")
        user = pw = ""
        if auth.lower().startswith("basic "):
            try:
                user, _, pw = base64.b64decode(auth[6:]).decode().partition(":")
            except Exception:
                return self._send(401, {"WWW-Authenticate": 'Basic realm="Git Capsule"'})
        if not pw.startswith("cgt_"):
            return self._send(200)
        if pw.startswith("cgt_good"):
            return self._send(200, {"X-WEBAUTH-USER": user})
        if pw == "cgt_limited":
            return self._send(429, {"Retry-After": "30"})
        return self._send(401, {"WWW-Authenticate": 'Basic realm="Git Capsule"'}, b"token invalido\n")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
