#!/bin/bash
# Bootstrap mode of `capsule recover` (DR-BACKUP.md section 3): from an OPERATOR host with the AWS CLI and
# Terraform, when the Capsule API does not exist yet. It covers the phases the server never runs:
#   F1 network (terraform), F2 core (RDS), F7 DNS. Data phases are `capsule recover apply` once the API is up,
#   or deploy/recovery/git-restore.sh by hand.
# Safe by default: without --apply-infra it only PLANS (terraform plan) and prints what it would do.
# Usage: recover.sh plan|apply [--apply-infra] [--run-id ID]
#   RECOVERY_TF_DIR   terraform dir (default: deploy/terraform next to this script)
#   RECOVERY_JOURNAL  journal file (default ./recovery-<run>.json): same shape as recovery_runs.steps
set -euo pipefail
cmd="${1:?usage: recover.sh plan|apply [--apply-infra] [--run-id ID]}"; shift || true
APPLY_INFRA=0; RUN="$(date -u +%Y%m%dT%H%M%SZ)"
while [ $# -gt 0 ]; do case "$1" in
  --apply-infra) APPLY_INFRA=1 ;;
  --run-id) RUN="$2"; shift ;;
  *) echo "unknown flag $1" >&2; exit 2 ;;
esac; shift; done
TF_DIR="${RECOVERY_TF_DIR:-$(cd "$(dirname "$0")/../terraform" && pwd)}"
JOURNAL="${RECOVERY_JOURNAL:-./recovery-$RUN.json}"
log() { printf '{"time":"%s","step":"%s","status":"%s","detail":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2" "$3" >> "$JOURNAL"; echo "[$2] $1: $3"; }

for t in terraform aws; do command -v "$t" >/dev/null || { log "f0-preflight" failed "$t not installed"; exit 1; }; done
aws sts get-caller-identity >/dev/null 2>&1 || { log "f0-preflight" failed "AWS credentials not available"; exit 1; }
log "f0-preflight" ok "tools and credentials present"

( cd "$TF_DIR" && terraform init -input=false >/dev/null && terraform plan -input=false -lock-timeout=60s -out="$PWD/recovery-$RUN.tfplan" -detailed-exitcode ) && rc=0 || rc=$?
case "$rc" in
  0) log "f1-network" ok "infrastructure already matches the code" ;;
  2) if [ "$cmd" = plan ] || [ "$APPLY_INFRA" != 1 ]; then log "f1-network" skipped "changes pending; re-run with 'apply --apply-infra' to apply the saved plan"
     else ( cd "$TF_DIR" && terraform apply -input=false "recovery-$RUN.tfplan" ) && log "f1-network" ok "applied recovery-$RUN.tfplan" || { log "f1-network" failed "terraform apply failed"; exit 1; }; fi ;;
  *) log "f1-network" failed "terraform plan failed (state reachable? credentials?)"; exit 1 ;;
esac
echo "next: F2 restore RDS (aws rds restore-db-instance-to-point-in-time ... ; tag capsule:recovery=$RUN), start the host,"
echo "      then 'capsule recover plan --all' / 'capsule recover apply --all --yes' against the new API, and F7 DNS by hand."
