#!/usr/bin/env bash
# Runs a rollback-probe SQL file against the linked DB and extracts the
# PROBE_RESULT JSON it raises. Probes execute real RPC flows inside a
# transaction that always aborts (the result travels out in the exception
# message), so nothing persists. Compare before/after captures with diff.
#
# Usage: run-probe.sh <probe.sql> <out.json>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2)"
RAW="$(SUPABASE_ACCESS_TOKEN="$TOKEN" supabase db query --linked --workdir "$ROOT" \
  --file "$1" -o json 2>&1 || true)"

# Assertion-grade probes raise PROBE_FAIL / PROBE_SETUP_FAILED instead of a
# result — surface those as hard failures.
if printf '%s' "$RAW" | grep -q 'PROBE_FAIL\|PROBE_SETUP_FAILED'; then
  echo "PROBE FAILED ($1):" >&2
  printf '%s\n' "$RAW" | grep -o 'PROBE_\(FAIL\|SETUP_FAILED\)[^"\\]*' | head -3 >&2
  exit 1
fi

python3 - "$2" <<PYEOF
import re, json, sys
raw = '''$(printf '%s' "$RAW" | sed "s/'/\\\\'/g")'''
m = re.search(r'PROBE_RESULT (.*)', raw, re.S)
if not m:
    sys.exit("no PROBE_RESULT in output:\n" + raw[:2000])
s = m.group(1).replace('\\\\"', '"')
depth = 0
for i, ch in enumerate(s):
    if ch == '{': depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            s = s[:i + 1]
            break
obj = json.loads(s)
json.dump(obj, open(sys.argv[1], 'w'), indent=1, sort_keys=True)
print(sys.argv[1] + ': ' + ', '.join(f"{k}={len(v) if isinstance(v, list) else v}" for k, v in sorted(obj.items())))
PYEOF
