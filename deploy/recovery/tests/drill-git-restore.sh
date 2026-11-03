#!/bin/bash
# Local drill of git-restore.sh with REAL openssl, sha256sum and tar on a fabricated forgejo dump
# (a real Forgejo is not needed for this half: the dump layout is the one of forgejo-backup.sh).
# Usage: bash deploy/recovery/tests/drill-git-restore.sh      Exit 0 = every expectation held.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src/forgejo" "$W/dump/repos/org/r1.git" "$W/dump/data"
git init -q --bare "$W/dump/repos/org/r1.git"
echo "[server]" > "$W/dump/app.ini"; echo x > "$W/dump/data/attach.txt"; echo "CREATE TABLE t(a);" > "$W/dump/forgejo-db.sql"
tar -czf "$W/d.tar.gz" -C "$W/dump" .
export GIT_BACKUP_PASSPHRASE='drill-pass-123'
KEY=forgejo/forgejo-dump-20261102T091700Z.tar.gz.enc
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:GIT_BACKUP_PASSPHRASE -in "$W/d.tar.gz" -out "$W/src/$KEY"
SHA="$(sha256sum "$W/src/$KEY" | cut -d' ' -f1)"
export RECOVERY_SOURCE_DIR="$W/src" RECOVERY_DUMP_KEY="$KEY" RECOVERY_DUMP_SHA256="$SHA" RECOVERY_DATA_DIR="$W/restored" RECOVERY_RUN_ID=t1 RECOVERY_SKIP_DB_LOAD=1
S="$HERE/git-restore.sh"
expect() { local want="$1"; shift; set +e; "$@" >/dev/null 2>&1; local rc=$?; set -e; [ "$rc" = "$want" ] || { echo "FAIL: expected exit $want, got $rc: $*" >&2; exit 1; }; echo "ok ($want): ${*: -2}"; }
expect 10 bash "$S" check
expect 0  bash "$S" apply
expect 0  bash "$S" check            # idempotent: already restored
expect 0  bash "$S" verify
expect 1  env RECOVERY_DUMP_SHA256="$(printf '0%.0s' $(seq 64))" RECOVERY_DATA_DIR="$W/r2" bash "$S" apply   # manipulated dump
[ ! -e "$W/r2" ] || { echo "FAIL: nothing may be restored on a checksum mismatch" >&2; exit 1; }
expect 1  env GIT_BACKUP_PASSPHRASE=bad RECOVERY_DATA_DIR="$W/r3" bash "$S" apply                            # wrong passphrase
expect 3  env RECOVERY_RUN_ID=t2 bash "$S" apply                       # non-empty destination without force
expect 0  env RECOVERY_RUN_ID=t3 RECOVERY_FORCE=1 bash "$S" apply      # forced: pre-restore copy kept
[ -d "$W/restored.pre-restore-t3" ] || { echo "FAIL: pre-restore copy missing" >&2; exit 1; }
echo "git-restore drill: all expectations held"
