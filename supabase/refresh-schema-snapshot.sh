#!/usr/bin/env bash
# Regenerates supabase/schema.sql — the current-state DDL snapshot of the public
# schema, read directly from the linked database (no Docker required).
#
# Run this as the LAST step of every `supabase db push`, so schema.sql always
# reflects the live schema. Migration files are append-only history; schema.sql
# is the single source of truth for what the schema looks like RIGHT NOW.
#
# Usage:  ./supabase/refresh-schema-snapshot.sh
set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 1
fi

TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2)"
if [ -z "$TOKEN" ]; then
  echo "error: SUPABASE_ACCESS_TOKEN not found in app/.env.local" >&2
  exit 1
fi

SUPABASE_ACCESS_TOKEN="$TOKEN" \
  supabase db query --linked --workdir "$ROOT" \
    --file supabase/schema-snapshot.gen.sql -o json 2>/dev/null \
  | jq -r '.rows[0].schema_sql' > supabase/schema.sql

LINES="$(wc -l < supabase/schema.sql | tr -d ' ')"
if [ "$LINES" -lt 50 ]; then
  echo "error: generated schema.sql looks empty ($LINES lines) — check the query/connection" >&2
  exit 1
fi
echo "wrote supabase/schema.sql ($LINES lines)"
