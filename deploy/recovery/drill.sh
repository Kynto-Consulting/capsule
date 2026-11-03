#!/bin/bash
# Monthly drill driver, to run ON the ephemeral instance (terraform: recovery_drill.tf) or on a clean
# machine, with READ-ONLY credentials. Usage: drill.sh   (needs `capsule` in PATH and an API to talk to)
# It restores everything into a scratch target, runs the smoke checks and writes the report to S3 drills/.
# The instance terminates itself at the end of its TTL; this script never touches DNS or production.
set -euo pipefail
: "${CAPSULE_API_URL:?the (ephemeral or staging) Capsule API}" "${CAPSULE_TOKEN:?platform admin token of THAT instance}"
RUN="drill-$(date -u +%Y%m%dT%H%M%SZ)"
capsule recover plan --all --target ephemeral --idempotency-key "$RUN-plan"
capsule recover apply --all --target ephemeral --yes --force-overwrite --wait=4h --idempotency-key "$RUN-apply"
capsule recover verify --all --target ephemeral --idempotency-key "$RUN-verify"
