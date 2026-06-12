# CURRENT_STATE — DB Tech-Debt Cleanup

> Snapshot of the database-layer tech-debt effort as of **2026-06-12**, on branch
> **`db-changes`**. Read this first when picking the work back up; the detailed
> plans live in the four `TODO_DB_*.md` docs.

## Where this came from

A full audit of [supabase/schema.sql](supabase/schema.sql) (2026-06-11, against
the supabase-postgres-best-practices rules) produced findings in four areas, each
with an execution-plan doc:

| Doc | Scope | Status |
|---|---|---|
| [TODO_DB_CONSOLIDATION.md](TODO_DB_CONSOLIDATION.md) | Drop dead peer layer; `pin_ledger_double_entry()` helper; `bets.week_id`; cap `pin_ledger` ref columns; event catalog; bounty 4→2 | **§1 done**, rest not started |
| [TODO_DB_FUNCTION_HYGIENE.md](TODO_DB_FUNCTION_HYGIENE.md) | Shared helpers (`assert_admin`, `current_player_id`, `current_season_id`, `pin_balance`, `is_admin`); `score_credit` guard fix; reversal rule docs; `search_path` normalization; PvP status cleanup | Not started |
| [TODO_DB_PERFORMANCE.md](TODO_DB_PERFORMANCE.md) | Persist LaneTalk per-import stats; balance covering index; redundant/missing indexes; resync amplification (measure-first) | Not started |
| [TODO_DB_SECURITY.md](TODO_DB_SECURITY.md) | **Anon lockdown (confirmed directive)**; `is_admin()` RLS dedup; phone-oracle docs; `players.name` → GENERATED | **§1 + §3 done 2026-06-12**, rest not started |

**Agreed sequencing:** anon lockdown → shared helpers → consolidation RPC
rewrites (which consume the helpers) → everything else.

## Done so far

- **`20260612003905_drop_deferred_peer_layer` — applied to the live DB.**
  Dropped `bet_offers` + `bet_matches` (never built on: zero rows, no RPC, no
  app path) and `bets.counterparty` (every row was `'house'`); recreated
  `place_house_bet` without the column. Peer wagering remains the PvP Challenge
  Contracts system — unrelated tables, untouched. `bet_legs.side` kept (dormant
  back/lay branch; separate decision, TODO_DB_CONSOLIDATION §1 Migration B).
- **Verified:** tables/column gone on the remote, snapshot regenerated
  (35 tables), `database.types.ts` regenerated, `tsc --noEmit` clean.
- **Docs updated:** [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md)
  (peer-layer sections → removal record), [context/database-schema.md](context/database-schema.md),
  [AGENTS.md](AGENTS.md) (real table count — the old "22" had drifted).

- **Anon lockdown (SECURITY §1 + §3) — applied to the live DB 2026-06-12.**
  Migrations `20260612120954_anon_lockdown` + `20260612125943_anon_lockdown_public_execute`:
  17 anon policies dropped; anon table/sequence grants + PUBLIC function EXECUTE
  revoked (current + default privileges) — anon's sole capability is
  `is_registered_player(text)`, and a stray future `TO anon` policy is inert
  without a grant. `refresh-schema-snapshot.sh` now runs an inheritance-aware
  posture assertion ([supabase/anon-posture-assert.sql](supabase/anon-posture-assert.sql))
  after every push; it already caught the PUBLIC-inheritance gap that motivated
  the follow-up migration. Curl-verified; AUTH.md documents posture + phone oracle.

## ⚠️ Incident found during the push (resolved, watch for recurrence)

The remote DB had migration **`20260612000000_lanetalk_imports_authenticated_read`**
applied, but its `.sql` file existed in **no git ref** — pushed from a worktree
whose branch was never committed/merged. It opened `lanetalk_game_imports`
SELECT from admin-only to all `authenticated`. Resolution: reconstructed the file
from live `pg_policy` state ([the file](supabase/migrations/20260612000000_lanetalk_imports_authenticated_read.sql)
is commented as reconstructed) so local/remote migration history match. The
schema snapshot had been stale for the same reason.
**Resolved 2026-06-12:** the "orphaned" worktree branch was merged to main as
`005f363` (LaneTalk import admin screen + the original migration file); the
reconstruction was superseded by the authored file when main was merged back
into `db-changes` (PR #39). Remaining lesson: worktree workers must commit
migration files before pushing them.

## Working tree (uncommitted, branch `db-changes`)

- New: 2 migration files (the drop + the reconstruction), 4 `TODO_DB_*.md` docs,
  this file.
- Modified: `supabase/schema.sql`, `database.types.ts`, `PIN_ECONOMY_SCHEMA.md`,
  `context/database-schema.md`, `AGENTS.md`.
- Nothing committed yet; no PR.

## Next action

Commit/PR the above, then execute **TODO_DB_SECURITY §1 (anon lockdown)** — it is
independent, user-confirmed, and purely subtractive (drop 19 anon policies +
revoke anon EXECUTE on everything except `is_registered_player`).
