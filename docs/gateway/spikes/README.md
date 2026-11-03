# Experimentos del gateway (spikes)

Módulo Go aislado (`gwspikes`): backends falsos (`cmd/backends`), gateway propio (`cmd/gw`), cliente de túnel (`cmd/ct`), `cmd/bench`, `cmd/pgclient` (pgx).
Ejecución: compilar con `GOOS=linux go build ./cmd/...`, copiar a `~/gw` en WSL y correr `run-gw.sh`; Caddy con `caddy-l4.json` (binario compilado con xcaddy fuera del repo).
Resultados reales en `results/`. `pgpy.py` usa libpq 18 (psycopg binary) en un venv de WSL. Limitaciones y lo no probado: PLAN.md sección 14.
Los scripts auxiliares de Caddy y memoria (`run-caddy.sh`, `run-caddy-fix.sh`, `run-mem.sh`, `run-ipv6-reload-check.sh`) son copias de lo ejecutado; sus resultados están en `results/caddy-l4.txt` y `results/gw-mem.txt`.
