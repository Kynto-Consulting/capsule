#!/usr/bin/env python3
"""bash -n sobre cada bloque `run: |` de un action.yml (actionlint no analiza acciones, solo workflows)."""
import re
import subprocess
import sys

lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
blocks, i = [], 0
while i < len(lines):
    m = re.match(r"^(\s*)run:\s*\|\s*$", lines[i])
    if not m:
        i += 1
        continue
    base = len(m.group(1))
    i += 1
    cur = []
    while i < len(lines) and (lines[i].strip() == "" or len(lines[i]) - len(lines[i].lstrip()) > base):
        cur.append(lines[i])
        i += 1
    blocks.append("\n".join(cur))
bad = 0
for b in blocks:
    script = re.sub(r"\$\{\{.*?\}\}", "X", b)
    r = subprocess.run(["bash", "-n"], input=script.encode(), capture_output=True)
    if r.returncode:
        bad += 1
        print(r.stderr.decode())
print("%s: %d bloques run, %d con error de sintaxis bash" % (sys.argv[1], len(blocks), bad))
sys.exit(1 if bad or not blocks else 0)
