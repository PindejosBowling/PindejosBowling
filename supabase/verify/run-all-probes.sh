#!/usr/bin/env bash
# Runs the full DB probe suite against the linked database. Every probe is a
# rollback-probe: it executes real RPC flows inside an always-aborting
# transaction (assertions raise PROBE_FAIL; success raises PROBE_RESULT), so
# nothing ever persists. Exits non-zero on the first failure.
#
# Run this BEFORE pushing any migration that touches economy RPCs, and again
# after; see context/db-verification.md.
#
# Usage: run-all-probes.sh [artifact-dir]   (default .verify-artifacts)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$DIR/../../.verify-artifacts}"
mkdir -p "$OUT"

PROBES=(probe-loans probe-pvp probe-bets-bounty probe-winners-crutch probe-energy-drink probe-ghost-in-the-slip probe-archive-roundtrip probe-settle-lifecycle probe-auctions probe-admin-guards)
for p in "${PROBES[@]}"; do
  echo "── $p"
  "$DIR/run-probe.sh" "$DIR/$p.sql" "$OUT/$p-latest.json"
done
echo "✓ all ${#PROBES[@]} probes passed (captures in $OUT)"
