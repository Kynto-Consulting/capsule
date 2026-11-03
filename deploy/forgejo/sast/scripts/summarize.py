#!/usr/bin/env python3
"""Resume la salida JSON de un escaner SAST y falla segun severidad.

Uso: summarize.py <semgrep|gosec|bandit|eslint> <archivo.json> [umbral=high]
Severidades normalizadas: high, medium, low. Escribe Markdown en $GITHUB_STEP_SUMMARY (si existe) y en stdout.
Sale con 1 si hay hallazgos >= umbral (SAST_FAIL_ON=off desactiva el fallo).
"""
import json
import os
import sys

ORDER = {"low": 1, "medium": 2, "high": 3}


def norm(v):
    v = str(v).lower()
    if v in ("error", "high", "critical"):
        return "high"
    if v in ("warning", "medium"):
        return "medium"
    return "low"


def load(tool, data):
    out = []
    if tool == "semgrep":
        for r in data.get("results", []):
            e = r.get("extra", {})
            out.append((norm(e.get("severity", "low")), r.get("check_id", ""), r.get("path", ""), r.get("start", {}).get("line", 0), e.get("message", "").strip().splitlines()[0] if e.get("message") else ""))
    elif tool == "gosec":
        for r in data.get("Issues", []) or []:
            out.append((norm(r.get("severity", "low")), r.get("rule_id", ""), r.get("file", ""), r.get("line", 0), r.get("details", "")))
    elif tool == "bandit":
        for r in data.get("results", []):
            out.append((norm(r.get("issue_severity", "low")), r.get("test_id", ""), r.get("filename", ""), r.get("line_number", 0), r.get("issue_text", "")))
    elif tool == "eslint":
        for f in data:
            for m in f.get("messages", []):
                out.append(("high" if m.get("severity") == 2 else "medium", m.get("ruleId") or "parse", f.get("filePath", ""), m.get("line", 0), m.get("message", "")))
    else:
        sys.exit("herramienta desconocida: " + tool)
    return out


def main():
    tool, path = sys.argv[1], sys.argv[2]
    threshold = (sys.argv[3] if len(sys.argv) > 3 else os.environ.get("SAST_FAIL_ON", "high")).lower()
    with open(path, encoding="utf-8") as fh:
        findings = load(tool, json.load(fh))
    findings.sort(key=lambda x: -ORDER[x[0]])
    lines = [f"### SAST: {tool} ({len(findings)} hallazgos, umbral de fallo: {threshold})", ""]
    if findings:
        lines += ["| Severidad | Regla | Ubicacion | Detalle |", "|---|---|---|---|"]
        for sev, rule, f, ln, msg in findings[:200]:
            lines.append(f"| {sev} | `{rule}` | `{f}:{ln}` | {msg.replace('|', '/')[:160]} |")
    text = "\n".join(lines) + "\n"
    print(text)
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        with open(summ, "a", encoding="utf-8") as fh:
            fh.write(text)
    if threshold != "off" and any(ORDER[s[0]] >= ORDER[threshold] for s in findings):
        sys.exit(1)


if __name__ == "__main__":
    main()
