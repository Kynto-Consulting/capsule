#!/bin/bash
# forgejo dump (repos + database + config) -> client-side AES-256 -> S3 (SSE-S3). Retention: bucket lifecycle.
# Run as a Capsule cron in this same image (volume mounted at /data).
# Required env: BACKUP_BUCKET, BACKUP_PASSPHRASE, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
set -euo pipefail

: "${BACKUP_BUCKET:?}" "${BACKUP_PASSPHRASE:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
APP_INI="${FORGEJO_APP_INI:-/data/gitea/conf/app.ini}"
WORK="/data/backup-tmp"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$WORK/forgejo-dump-$STAMP.tar.gz"

rm -rf "$WORK"; mkdir -p "$WORK"; chown git:git "$WORK" 2>/dev/null || true
trap 'rm -rf "$WORK"' EXIT

# Run as the git user; --tempdir on the volume (the dump can exceed /tmp).
su-exec git forgejo dump --config "$APP_INI" --type tar.gz --tempdir "$WORK" --file "$OUT"

# The dump contains app.ini (SECRET_KEY, INTERNAL_TOKEN): never upload it in clear.
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -in "$OUT" -out "$OUT.enc"
sha256sum "$OUT.enc" | tee "$OUT.enc.sha256"

KEY="forgejo/forgejo-dump-$STAMP.tar.gz.enc"
aws s3 cp "$OUT.enc" "s3://$BACKUP_BUCKET/$KEY" --sse AES256 --only-show-errors
aws s3 cp "$OUT.enc.sha256" "s3://$BACKUP_BUCKET/$KEY.sha256" --sse AES256 --only-show-errors
# Uploader has List but not Get: confirm the object is there.
aws s3 ls "s3://$BACKUP_BUCKET/$KEY" >/dev/null
echo "backup ok: s3://$BACKUP_BUCKET/$KEY"
