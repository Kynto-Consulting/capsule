#!/bin/bash
# F8 of DR-BACKUP.md: smoke checks against a recovered instance. Usage: smoke.sh check|apply|verify
# Env: RECOVERY_BASE_URL (e.g. https://app.tumi-ai.com or the ephemeral host), RECOVERY_EXPECT_PROJECTS (count, optional)
# Read-only: it never writes. `check` always answers "not done" (10) so apply/verify run.
set -euo pipefail
case "${1:?usage: smoke.sh check|apply|verify}" in check) exit 10 ;; esac
: "${RECOVERY_BASE_URL:?}"
curl -fsS --max-time 20 "$RECOVERY_BASE_URL/health" >/dev/null || { echo "health check failed" >&2; exit 1; }
echo "health ok"
if [ -n "${RECOVERY_REPOS_DIR:-}" ]; then
  # git fsck on a sample (10 percent, at least 3) of the restored bare repositories
  mapfile -t repos < <(find "$RECOVERY_REPOS_DIR" -maxdepth 2 -name '*.git' -type d | sort)
  n=${#repos[@]}; k=$(( n / 10 )); [ "$k" -lt 3 ] && k=3; [ "$k" -gt "$n" ] && k=$n
  for ((i = 0; i < k; i++)); do git -C "${repos[$i]}" fsck --no-progress >/dev/null || { echo "git fsck failed: ${repos[$i]}" >&2; exit 1; }; done
  echo "git fsck ok on $k of $n repositories"
fi
