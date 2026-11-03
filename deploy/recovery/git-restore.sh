#!/bin/bash
# F3 of DR-BACKUP.md: restore a `forgejo dump` (encrypted by deploy/forgejo/scripts/forgejo-backup.sh).
# Usage: git-restore.sh check|apply|verify      (called by `capsule recover` or by recover.sh)
# check  exit 0 = already restored (marker for this exact dump), 10 = not yet, other = error
# apply  download, verify sha256, decrypt, extract, place files in RECOVERY_DATA_DIR (never half-way)
# verify structure checks of the restored tree (app.ini, repositories, DB file)
#
# Env (secrets only through the environment, never arguments, never echoed):
#   RECOVERY_DUMP_KEY        object key, e.g. forgejo/forgejo-dump-20261102T091700Z.tar.gz.enc
#   RECOVERY_DUMP_SHA256     expected sha256 of the .enc file (from the .sha256 sidecar). REQUIRED.
#   RECOVERY_RUN_ID          run id (names the work dir and the pre-restore copy)
#   GIT_BACKUP_PASSPHRASE    passphrase of the dump (kept OUTSIDE the server)
#   RECOVERY_DATA_DIR        destination (the Forgejo data volume mount, or a scratch dir for a drill)
#   RECOVERY_SOURCE_DIR      local directory holding the object (tests/drills); otherwise S3 via aws cli:
#   RECOVERY_BUCKET, AWS_*   bucket and credentials (read-only for drills)
#   RECOVERY_FORCE=1         allow overwriting a non-empty RECOVERY_DATA_DIR (a copy is kept first)
#   RECOVERY_SKIP_DB_LOAD=1  do not load forgejo-db.sql (drills without sqlite3)
#   RECOVERY_FORGEJO_CMD     command that runs forgejo as the git user for `admin regenerate hooks`
#                            and `doctor check --all` (e.g. "docker compose exec -u git git forgejo");
#                            empty = print the commands to run instead
set -euo pipefail
verb="${1:?usage: git-restore.sh check|apply|verify}"
: "${RECOVERY_DATA_DIR:?}" "${RECOVERY_DUMP_KEY:?}"
RUN="${RECOVERY_RUN_ID:-manual}"
MARK="$RECOVERY_DATA_DIR/.capsule-recovered-${RECOVERY_DUMP_SHA256:-unknown}"

case "$verb" in
check)
  if [ -f "$MARK" ]; then echo "dump ${RECOVERY_DUMP_SHA256:0:12} already restored"; exit 0; fi
  exit 10 ;;
apply|verify) ;;
*) echo "unknown verb $verb" >&2; exit 2 ;;
esac

if [ "$verb" = "verify" ]; then
  [ -f "$MARK" ] || { echo "no restore marker for this dump" >&2; exit 1; }
  [ -f "$RECOVERY_DATA_DIR/gitea/conf/app.ini" ] || { echo "app.ini missing" >&2; exit 1; }
  [ -d "$RECOVERY_DATA_DIR/git/repositories" ] || { echo "repositories missing" >&2; exit 1; }
  n=$(find "$RECOVERY_DATA_DIR/git/repositories" -maxdepth 2 -name '*.git' -type d | wc -l)
  echo "structure ok: $n bare repositories"
  if [ -n "${RECOVERY_FORGEJO_CMD:-}" ]; then
    $RECOVERY_FORGEJO_CMD forgejo doctor check --all >/dev/null || { echo "forgejo doctor reported problems" >&2; exit 1; }
    echo "forgejo doctor ok"
  fi
  exit 0
fi

: "${RECOVERY_DUMP_SHA256:?the dump has no .sha256 sidecar: refusing to restore unverified data}"
: "${GIT_BACKUP_PASSPHRASE:?}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/recovery-git-$RUN.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ENC="$WORK/dump.tar.gz.enc"

if [ -n "${RECOVERY_SOURCE_DIR:-}" ]; then
  cp "$RECOVERY_SOURCE_DIR/$RECOVERY_DUMP_KEY" "$ENC"
else
  : "${RECOVERY_BUCKET:?}"
  aws s3 cp "s3://$RECOVERY_BUCKET/$RECOVERY_DUMP_KEY" "$ENC" --only-show-errors
fi

# 1. checksum BEFORE decrypting
got="$(sha256sum "$ENC" | cut -d' ' -f1)"
if [ "$got" != "$RECOVERY_DUMP_SHA256" ]; then
  echo "checksum mismatch: dump ${got:0:12} != expected ${RECOVERY_DUMP_SHA256:0:12}; nothing restored" >&2
  exit 1
fi
# 2. decrypt (same parameters as forgejo-backup.sh) and extract in the scratch dir
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:GIT_BACKUP_PASSPHRASE -in "$ENC" -out "$WORK/dump.tar.gz" \
  || { echo "decryption failed (wrong GIT_BACKUP_PASSPHRASE or corrupted dump); nothing restored" >&2; exit 1; }
mkdir "$WORK/dump"
tar -xzf "$WORK/dump.tar.gz" -C "$WORK/dump"
for need in app.ini repos data; do
  [ -e "$WORK/dump/$need" ] || { echo "dump lacks $need; nothing restored" >&2; exit 1; }
done

# 3. place into a staging tree, then swap (the destination is never left half-written)
STAGE="$RECOVERY_DATA_DIR.stage-$RUN"
rm -rf "$STAGE"; mkdir -p "$STAGE/gitea/conf" "$STAGE/git/repositories"
cp "$WORK/dump/app.ini" "$STAGE/gitea/conf/app.ini"
cp -a "$WORK/dump/repos/." "$STAGE/git/repositories/"
cp -a "$WORK/dump/data/." "$STAGE/gitea/"
[ -d "$WORK/dump/custom" ] && { mkdir -p "$STAGE/gitea/custom"; cp -a "$WORK/dump/custom/." "$STAGE/gitea/custom/"; }
if [ -f "$WORK/dump/forgejo-db.sql" ] && [ "${RECOVERY_SKIP_DB_LOAD:-0}" != "1" ]; then
  rm -f "$STAGE/gitea/forgejo.db"
  sqlite3 "$STAGE/gitea/forgejo.db" < "$WORK/dump/forgejo-db.sql"
fi
touch "$STAGE/.capsule-recovered-$RECOVERY_DUMP_SHA256"

if [ -d "$RECOVERY_DATA_DIR" ] && [ -n "$(ls -A "$RECOVERY_DATA_DIR" 2>/dev/null)" ]; then
  if [ "${RECOVERY_FORCE:-0}" != "1" ]; then
    rm -rf "$STAGE"
    echo "destination is not empty; pass --force-overwrite (RECOVERY_FORCE=1) to replace it" >&2
    exit 3
  fi
  mv "$RECOVERY_DATA_DIR" "$RECOVERY_DATA_DIR.pre-restore-$RUN"   # kept 14 days by the operator policy
fi
mkdir -p "$(dirname "$RECOVERY_DATA_DIR")"
mv "$STAGE" "$RECOVERY_DATA_DIR"

if [ -n "${RECOVERY_FORGEJO_CMD:-}" ]; then
  $RECOVERY_FORGEJO_CMD forgejo admin regenerate hooks
else
  echo "next (as the git user): forgejo admin regenerate hooks && forgejo doctor check --all"
fi
echo "restored dump ${RECOVERY_DUMP_SHA256:0:12} into $RECOVERY_DATA_DIR"
