#!/usr/bin/env bash
# infra.sh up|down : three disposable PostgreSQL 18 clusters (own data dirs under $W, own ports; the system cluster is not touched).
#   ctl   127.0.0.1:55440  database capsule   control database (the real backend applies every migration; seed.sh fills it)
#   tgt   127.0.0.1:55441  database app, TLS  the "pg" service points here  (row value interop-row-one)
#   tgt2  127.0.0.1:55442  database app, TLS  the "pg2" service points here (row value interop-row-two)
#     roles: app (SCRAM, password app-pass-1), tr (trust, only over TLS from loopback: used by the minimal protocol clients)
set -euo pipefail
W=${W:-/tmp/capsule-interop}
PGBIN=/usr/lib/postgresql/18/bin
as_pg() { runuser -u postgres -- "$@"; }
export PGPASSWORD=interop-pg-pass
case "${1:-}" in
up)
  mkdir -p "$W" && chmod 755 "$W"
  mkdir -p "$W/pg" && chown postgres "$W/pg"; echo interop-pg-pass > "$W/pwfile"; chmod 644 "$W/pwfile"
  [ -f "$W/certs/target.crt" ] || { echo "run certs.sh first"; exit 1; }
  mkdir -p "$W/pgcerts"; cp "$W/certs/target.crt" "$W/certs/target.key" "$W/pgcerts/"; chown -R postgres "$W/pgcerts"; chmod 600 "$W/pgcerts/target.key"
  for n in ctl:55440 tgt:55441 tgt2:55442; do
    name=${n%%:*}; port=${n##*:}; d="$W/pg/$name"
    if [ ! -d "$d" ]; then
      as_pg $PGBIN/initdb -D "$d" -A scram-sha-256 --pwfile="$W/pwfile" -U postgres >/dev/null
    fi
    extra=""
    if [ "$name" != ctl ]; then
      extra="-c ssl=on -c ssl_cert_file=$W/pgcerts/target.crt -c ssl_key_file=$W/pgcerts/target.key -c ssl_min_protocol_version=TLSv1.2"
      cat > "$d/pg_hba.conf" <<HBA
host all postgres 127.0.0.1/32 scram-sha-256
hostssl app tr 127.0.0.1/32 trust
hostssl app tr ::1/128 trust
hostssl all all 127.0.0.1/32 scram-sha-256
hostssl all all ::1/128 scram-sha-256
HBA
      chown postgres "$d/pg_hba.conf"
    fi
    if as_pg $PGBIN/pg_ctl -D "$d" status >/dev/null 2>&1; then continue; fi
    as_pg $PGBIN/pg_ctl -D "$d" -l "$W/pg/$name.log" -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=$W/pg -c fsync=off $extra" -w -t 30 start >/dev/null
  done
  psql -h 127.0.0.1 -p 55440 -U postgres -d postgres -qc "CREATE DATABASE capsule" 2>/dev/null || true
  for pair in 55441:one 55442:two; do
    port=${pair%%:*}; word=${pair##*:}
    psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -qc "CREATE DATABASE app" 2>/dev/null || true
    psql -h 127.0.0.1 -p "$port" -U postgres -d app -q 2>/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app') THEN
    CREATE ROLE app LOGIN PASSWORD 'app-pass-1';
    CREATE ROLE tr LOGIN;
  END IF;
END \$\$;
CREATE TABLE IF NOT EXISTS blob(id int primary key, v text);
INSERT INTO blob VALUES (1,'interop-row-$word') ON CONFLICT DO NOTHING;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app, tr;
GRANT ALL ON SCHEMA public TO app, tr;
SQL
  done
  echo up
  ;;
down)
  for name in ctl tgt tgt2; do
    d="$W/pg/$name"
    if [ -d "$d" ]; then as_pg $PGBIN/pg_ctl -D "$d" -m immediate -w -t 20 stop >/dev/null 2>&1 || true; fi
  done
  echo down
  ;;
esac
