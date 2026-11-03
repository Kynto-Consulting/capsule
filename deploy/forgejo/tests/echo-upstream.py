#!/usr/bin/env python3
"""Upstream de prueba que hace de Forgejo: responde en JSON las cabeceras y la ruta recibidas y cuantos bytes de cuerpo leyo.
Uso: echo-upstream.py <puerto>"""
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def handle_any(self):
        n = 0
        length = int(self.headers.get("Content-Length") or 0)
        while n < length:
            chunk = self.rfile.read(min(1 << 20, length - n))
            if not chunk:
                break
            n += len(chunk)
        body = json.dumps({
            "path": self.path,
            "method": self.command,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body_bytes": n,
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Server", "echo-upstream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass  # el cliente (Caddy) cerro antes: caso de cuerpo rechazado por limite

    do_GET = do_POST = do_PUT = handle_any


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
