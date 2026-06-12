# CURRENT_STATE — DB Tech-Debt Cleanup

> Handoff snapshot as of **2026-06-12 (end of session 2)**, branch **`db-changes`**,
> worktree `.claude/worktrees/db-changes`. Read this first; detailed plans live in
> the four `TODO_DB_*.md` docs (each section carries its own ✅ status block).
> **⛔ One migration is WRITTEN BUT NOT PUSHED — see "In flight" below.**

## Where this came from

A full audit of [supabase/schema.sql](supabase/schema.sql) (2026-06-11) produced
four execution-plan docs. Agreed sequencing was: anon lockdown → shared helpers →
consolidation RPC rewrites → everything else. That sequence is now ~95% executed.

| Doc | Status |
|---|---|
| [TODO_DB_CONSOLIDATION.md](TODO_DB_CONSOLIDATION.md) | §1 ✅ §2 ✅ §3 ✅ §4 ✅ · **§5 in flight (migration written, NOT pushed)** · §6 deferred by design |
| [TODO_DB_FUNCTION_HYGIENE.md](TODO_DB_FUNCTION_HYGIENE.md) | §1 ✅ §2 ✅ §4 ✅ §5 ✅(option a) · §3 + §6 are **docs-only, not done** |
| [TODO_DB_PERFORMANCE.md](TODO_DB_PERFORMANCE.md) | §1 ✅ §2 ✅ §3 ✅ §4 ✅ · §5 deferred by design (measure-first; §1 likely mooted it) |
| [TODO_DB_SECURITY.md](TODO_DB_SECURITY.md) | §1 ✅ §2 ✅ §3 ✅ §4 ✅ — **complete** |

## Process contract (user-confirmed, follow it)

1. **Pause for user review before EVERY `supabase db push`.** Show the migration,
   wait for explicit go-ahead. This is live-production DB work.
2. **After every push:** `./supabase/refresh-schema-snapshot.sh` (now also runs
   the anon posture assertion and FAILS on regression) → run the probe suite
   (`./supabase/verify/run-all-probes.sh`) → regen types if schema shape changed
   (`supabase gen types …` per [context/page-creation.md](context/page-creation.md))
   → `tsc --noEmit` from `app/` → commit the unit with a detailed message.
3. **Checkpoint merges to main** at known-working states via PR (user decides
   when). Done so far: PR #39, #40, #41. Several verified-but-unmerged commits
   now sit on `db-changes` (see below) — a checkpoint PR is warranted.
4. **Generate, don't hand-type**, when rewriting existing objects: dump
   `pg_get_functiondef`/`pg_policies` from the live catalog, apply targeted
   textual replacements with asserts, diff before/after. Used for the RLS dedup,
   admin-guard batch, search_path batch, LaneTalk consumers, §2/§5 hygiene.

## The DB test suite (new this session — use it)

`supabase/verify/` + [context/db-verification.md](context/db-verification.md).
Rollback-probes: real RPC flows executed against the live DB inside
always-aborting transactions (zero persistence), self-contained fixtures
(synthetic auth users/players/markets/products created in-tx), claims
impersonation via `set_config('request.jwt.claims', …)`, absolute assertions
(balance deltas, statuses, 2-row back-links, double-entry net-zero), negative
admin-guard tests (20 RPCs must raise exactly 'Admin only'). Runner:
`./supabase/verify/run-all-probes.sh` (5 probes; fail-fast). AGENTS.md rule 8
amended: economy-RPC migrations must run the suite before AND after pushing.
The posture assertion caught two real regressions live (PUBLIC function
inheritance; per-schema default-ACL gotcha) — trust it.

## Done this session (all applied to live DB, all probe-verified)

Merged to main (PRs #39/#40/#41):
- **Anon lockdown** (`…120954_anon_lockdown`, `…125943_anon_lockdown_public_execute`)
  — anon's sole capability is `is_registered_player(text)`; posture assertion in
  the snapshot ritual; AUTH.md "Anon posture" section.
- **Shared helpers** (`…130855_db_assert_helpers`) — `is_admin()`, `assert_admin()`,
  `current_player_id()`, `current_season_id()`, `pin_balance()`.
- **RLS dedup** (`…143010_rls_is_admin_dedup`) — 83 policies → `(SELECT is_admin())`,
  proven by empty normalized pg_policies diff (`supabase/verify/diff-policies.sh`).
- **`pin_ledger_double_entry()` + adoption batches** (`…145622`, `…145700` loans,
  `…151409` pvp, `…153019` bets/bounty) — 13 RPCs; granular bounty refs dropped
  (CONSOLIDATION §4 fused in); helper documented in PIN_ECONOMY_SCHEMA §4 as the
  only sanctioned pin mover + one-root-ref policy.

On `db-changes`, verified but NOT yet merged to main:
- `4027aaf` test suite formalized (assertion-grade probes, admin-guard negatives,
  runner, context/db-verification.md, AGENTS.md rule-8 amendment)
- `2941b19` **bets.week_id** (`…172127` + `…172200`) — column/backfill/index,
  place_house_bet stamps + enforces single-week parlays, archive/settle/unarchive
  predicates rewritten; new `probe-archive-roundtrip.sql` (force-void → surgical
  restore, exact ledger sum + row count)
- `d51a834` **final assert_admin batch + search_path** (`…172909`, `…172957`) —
  16 functions generated from catalog; the ONLY remaining admin-JWT expression is
  is_admin() itself. search_path: `'public','pg_temp'` (deliberate deviation from
  the audit's `''`+qualify plan — same security property, no rewrite risk; the
  pg_temp-first shadowing vector is closed). ⚠️ **custom_access_token (JWT hook)
  was touched** — verified by direct invocation, but a real OTP login check by
  the user is still outstanding.
- `5e48d77` **score_credit guard → week_id; PvP week-close → 'expired'**
  (`…175222`) — app already renders 'expired'; no app change needed.
- `7fbf6af` **players.name → GENERATED** (`…175854`) — fixed live stale-rename
  bug; name absent from Insert/Update types.
- `b16deee` **LaneTalk columnar stats** (`…180513` + `…180553`) — five stat
  columns + recompute trigger; seed/settle/sync read columns (seed lines for all
  6 players byte-identical). Includes `…181417_anon_lockdown_global_default_acl`:
  per-schema `ALTER DEFAULT PRIVILEGES` can only ADD to global defaults — the
  PUBLIC-EXECUTE revoke had to be GLOBAL (gotcha documented in AUTH.md).
- `cc0fe25` **index tuning** (`…181842`) — balance covering index (Index Only
  Scan proven), two evidence-gated drops (zero-scan prefix-redundant bounty
  indexes), three FK indexes. Kept idx_bets_status/idx_bet_markets_status/
  idx_pin_ledger_house/idx_pin_ledger_season on idx_scan evidence.

## ⛔ In flight — NOT pushed

**`supabase/migrations/20260612183555_activity_event_catalog.sql`**
(CONSOLIDATION §5) is **written, reviewed by the user, but NOT pushed** — the
user stopped the session at the push-approval gate. It: creates
`activity_event_catalog` (16 seeded rows, RLS authenticated-read/admin-write,
audit columns), swaps the `event_type` CHECK for an FK, and rewrites
`publish_activity_event` (catalog lookup replaces the CASE; FK-exclusivity is
one comparison; failure-path error text consolidated — success paths verbatim).

**Next agent:** re-confirm with the user, push it, then: probe suite → snapshot
ritual → types regen (new table) → tsc → update
[context/activity-feed.md](context/activity-feed.md) recipe ("add a new event
type" = 1 catalog INSERT + app template, no function/constraint edit) → mark
TODO_DB_CONSOLIDATION §5 done → commit.

## Remaining backlog (in suggested order)

1. **Push the in-flight §5 migration** (above).
2. **Docs-only items:** HYGIENE §3 (reversal rule subsection in
   PIN_ECONOMY_SCHEMA + pointer in context/archive-and-settlement.md — text is
   drafted in TODO_DB_FUNCTION_HYGIENE §3) and HYGIENE §6 (PvP challenge↔offer
   mirror note in context/economy/PvP_DB.md; the optional drift guard in
   accept_pvp_challenge is a judgment call).
3. **TODO status sweep:** several doc sections done this session still lack ✅
   blocks (FUNCTION_HYGIENE §2/§4/§5, PERFORMANCE §1–4, CONSOLIDATION §5 once
   pushed). Update each + the table at the top of this file.
4. **Checkpoint PR to main** (commits `4027aaf`…HEAD). Ask the user first.
5. **Ask the user to OTP-login once** (JWT-hook verification, see d51a834).
6. Deferred by design (do NOT do without a new decision): `bet_legs.side` drop
   (CONSOLIDATION §1B), bounty 4→2 (§6), resync debounce (PERF §5).

## Worktree mechanics (gotchas that cost time)

- Gitignored credentials must be copied into the worktree by hand:
  `app/.env.local` AND `supabase/.temp/*` (CLI link state) from the main checkout.
- The Bash session's cwd can silently reset to the main checkout —
  `cd /Users/garrett/Code/PindejosBowling/.claude/worktrees/db-changes` first in
  compound commands, and double-check `pwd` before file-creating commands.
- `app/` has its own `node_modules` (npm, no lockfile committed) — `npm ci`/
  `npm install` once per worktree for `tsc`.
- `supabase migration new` works offline but HANGS when backgrounded (stdin) —
  run it in the foreground with `</dev/null`.
- Probe captures land in gitignored `.verify-artifacts/`.

## Incident log (resolved)

The orphaned `20260612000000_lanetalk_imports_authenticated_read` migration
(pushed from an uncommitted worktree) was resolved: that branch was merged to
main as `005f363`, and the original file superseded the reconstruction when main
was merged back (PR #39). Lesson stands: **commit migration files before pushing
them.**
