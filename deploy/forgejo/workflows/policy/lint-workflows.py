#!/usr/bin/env python3
"""Politica de workflows de Git Capsule (SPEC 6.3). Solo libreria estandar.

Uso: lint-workflows.py [--labels ci,node22] [--allow ARCHIVO] RUTA...   (archivos o directorios)
Sale con 1 si hay violaciones. Reglas (id):
  PR-TARGET     pull_request_target
  WRITE-ALL     permissions: write-all
  CURL-PIPE     curl/wget canalizado a un interprete (curl | sh, bash <(curl ...), sh -c "$(curl ...)")
  UNPINNED-USE  uses: remoto sin SHA de 40 hex, o docker:// sin @sha256:
  RUNS-ON       runs-on con una etiqueta que no esta registrada
  CAPSULE-CREDS uso de ~/.capsule o 'capsule login' en un workflow (6.5.5)
Excepciones: archivo --allow con lineas 'ruta-del-workflow:REGLA' (lo protege CODEOWNERS como los workflows).
El analisis es por lineas (sin dependencias); los comentarios se ignoran.
"""
import argparse
import os
import re
import sys

SHA40 = re.compile(r"^[0-9a-f]{40}$")
DEFAULT_LABELS = "ci,node22,ci-untrusted"
INTERP = r"(?:sh|bash|zsh|dash|ksh|python3?|perl|ruby|node|sudo\s+(?:-\S+\s+)*(?:sh|bash))"
FETCH = r"(?:curl|wget)\b"


def strip_comment(line):
    out, q = [], None
    for i, ch in enumerate(line):
        if q:
            if ch == q:
                q = None
        elif ch in "'\"":
            q = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            break
        out.append(ch)
    return "".join(out)


def scalar(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        v = v[1:-1]
    return v


def lint_text(text, labels):
    """Devuelve [(linea, regla, mensaje)]."""
    found = []
    lines = [strip_comment(l.rstrip("\n")) for l in text.splitlines()]
    for n, line in enumerate(lines, 1):
        s = line.strip()
        if not s:
            continue
        if re.search(r"\bpull_request_target\b", s):
            found.append((n, "PR-TARGET", "pull_request_target esta prohibido (T6)"))
        if re.match(r"^permissions\s*:\s*['\"]?write-all['\"]?\s*$", s) or re.search(r"\bpermissions\s*:\s*\{?\s*['\"]?write-all", s):
            found.append((n, "WRITE-ALL", "permissions: write-all esta prohibido; declara permisos minimos"))
        if (re.search(FETCH + r"[^|;&]*\|\s*(?:\S+/)?" + INTERP + r"\b", s)
                or re.search(INTERP + r"\s+<\(\s*" + FETCH, s)
                or re.search(INTERP + r"\s+-c\s+[\"']?\$\(\s*" + FETCH, s)):
            found.append((n, "CURL-PIPE", "descargar y ejecutar (curl | sh) esta prohibido; descarga, verifica sha256 y ejecuta"))
        if re.search(r"(~|\$HOME|\$\{HOME\}|/root|/home/[^/\s]+)/\.capsule\b|\bcapsule\s+login\b", s):
            found.append((n, "CAPSULE-CREDS", "los runners no usan credenciales de usuario (capsule login / ~/.capsule)"))
        m = re.match(r"^-?\s*uses\s*:\s*(.+)$", s)
        if m:
            ref = scalar(m.group(1))
            if ref.startswith("./") or ref.startswith("../"):
                pass
            elif ref.startswith("docker://"):
                if "@sha256:" not in ref:
                    found.append((n, "UNPINNED-USE", "docker:// debe fijarse por digest @sha256:"))
            else:
                at = ref.rfind("@")
                if at < 0 or not SHA40.match(ref[at + 1:]):
                    found.append((n, "UNPINNED-USE", "la accion debe fijarse por SHA de 40 hex: %s" % ref))
        m = re.match(r"^-?\s*runs-on\s*:\s*(.+)$", s)
        if m:
            raw = m.group(1).strip()
            if raw.startswith("["):
                items = [scalar(x) for x in raw.strip("[]").split(",") if x.strip()]
            elif raw == "":
                items = []
                j = n
                while j < len(lines) and re.match(r"^\s*-\s+", lines[j]):
                    items.append(scalar(re.sub(r"^\s*-\s+", "", lines[j])))
                    j += 1
            else:
                items = [scalar(raw)]
            for it in items:
                if it.startswith("${{"):
                    found.append((n, "RUNS-ON", "runs-on no puede ser una expresion"))
                elif it not in labels:
                    found.append((n, "RUNS-ON", "etiqueta no registrada: %s" % it))
    return found


def files_of(paths):
    for p in paths:
        if os.path.isdir(p):
            for root, _, names in sorted(os.walk(p)):
                for nm in sorted(names):
                    if nm.endswith((".yml", ".yaml")):
                        yield os.path.join(root, nm)
        elif os.path.isfile(p):
            yield p


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.environ.get("POLICY_LABELS", DEFAULT_LABELS))
    ap.add_argument("--allow", default="")
    ap.add_argument("paths", nargs="+")
    a = ap.parse_args(argv)
    labels = {x.strip() for x in a.labels.split(",") if x.strip()}
    allow = set()
    if a.allow and os.path.isfile(a.allow):
        for l in open(a.allow, encoding="utf-8"):
            l = l.split("#", 1)[0].strip()
            if ":" in l:
                allow.add(l)
    bad = 0
    for f in files_of(a.paths):
        norm = f.replace("\\", "/")
        for n, rule, msg in lint_text(open(f, encoding="utf-8").read(), labels):
            if any(norm.endswith(x.rsplit(":", 1)[0]) and x.rsplit(":", 1)[1] == rule for x in allow):
                continue
            print("%s:%d: [%s] %s" % (norm, n, rule, msg))
            bad += 1
    if bad:
        print("workflow-policy: %d violacion(es)" % bad, file=sys.stderr)
        return 1
    print("workflow-policy: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
