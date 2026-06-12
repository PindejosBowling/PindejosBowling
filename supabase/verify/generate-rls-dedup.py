#!/usr/bin/env python3
"""Generate the rls_is_admin_dedup migration from a policies-dump capture.

Reads a policies-dump.sql capture (JSON array of pg_policies rows) and emits
DROP + CREATE statements for every policy whose qual/with_check contains the
inline admin JWT expression, replacing it with ( SELECT public.is_admin()).
Everything else (names, commands, roles, permissive, other operands) is
reproduced verbatim — the companion diff-policies.sh proves it.

Usage: generate-rls-dedup.py policies-before.json > migration-body.sql
"""
import json
import sys

# The two deparsed variants of the admin check found in pg_policies (108 + 4
# occurrences at capture time). Outer parens included so the replacement slots
# into the surrounding boolean expression unchanged.
WRAPPED = "(((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)"
BARE = "(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)"
REPLACEMENT = "( SELECT public.is_admin())"


def substitute(expr: str) -> str:
    return expr.replace(WRAPPED, REPLACEMENT).replace(BARE, REPLACEMENT)


def main() -> None:
    with open(sys.argv[1]) as f:
        policies = json.load(f)

    targets = [
        p for p in policies
        if "app_metadata" in ((p["qual"] or "") + (p["with_check"] or ""))
    ]
    leftover = [
        p["tablename"] + "/" + p["policyname"] for p in targets
        if "app_metadata" in substitute((p["qual"] or "") + " " + (p["with_check"] or ""))
    ]
    if leftover:
        sys.exit(f"unmatched admin-expression variant in: {leftover}")

    for p in sorted(targets, key=lambda p: (p["tablename"], p["policyname"])):
        name, tbl = p["policyname"], p["tablename"]
        print(f'DROP POLICY "{name}" ON public.{tbl};')
        stmt = (
            f'CREATE POLICY "{name}" ON public.{tbl}\n'
            f'  AS {p["permissive"]} FOR {p["cmd"]} TO {", ".join(p["roles"])}'
        )
        if p["qual"] is not None:
            stmt += f"\n  USING ({substitute(p['qual'])})"
        if p["with_check"] is not None:
            stmt += f"\n  WITH CHECK ({substitute(p['with_check'])})"
        print(stmt + ";\n")

    print(f"-- {len(targets)} policies rewritten.", file=sys.stderr)


if __name__ == "__main__":
    main()
