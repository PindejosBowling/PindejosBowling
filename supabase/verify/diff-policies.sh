#!/usr/bin/env bash
# Semantic diff of two policies-dump.sql captures (before/after a policy
# migration). Normalizes the three equivalent renderings of the admin check —
# the two inline JWT variants and the is_admin() helper call — to one token,
# then diffs everything else byte-for-byte. An empty diff proves the migration
# changed nothing but the admin-expression spelling.
#
# Usage: diff-policies.sh before.json after.json
set -euo pipefail

WRAPPED="(((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)"
BARE="(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)"
# Deparsed renderings of ( SELECT public.is_admin()) — with and without the
# alias pg_get_expr may add.
HELPER_ALIASED="( SELECT is_admin() AS is_admin)"
HELPER_PLAIN="( SELECT is_admin())"

# jq gsub needs regex-escaped patterns; plain string replace via split/join is
# exact and escape-free.
norm() {
  jq --arg w "$WRAPPED" --arg b "$BARE" --arg ha "$HELPER_ALIASED" --arg hp "$HELPER_PLAIN" '
    def rep($s; $t): split($s) | join($t);
    map(
      .qual       = (if .qual       == null then null else (.qual       | rep($w;"«ADMIN»") | rep($b;"«ADMIN»") | rep($ha;"«ADMIN»") | rep($hp;"«ADMIN»")) end) |
      .with_check = (if .with_check == null then null else (.with_check | rep($w;"«ADMIN»") | rep($b;"«ADMIN»") | rep($ha;"«ADMIN»") | rep($hp;"«ADMIN»")) end)
    )
    | sort_by(.tablename, .policyname, .cmd)
  ' "$1"
}

diff <(norm "$1") <(norm "$2") && echo "OK: policy catalogs are semantically identical ($(jq length "$1") policies)"
