# TODO — DB Performance (Audit §3)

> From the 2026-06-11 database-layer audit of [supabase/schema.sql](supabase/schema.sql).
> Companion docs: [TODO_DB_CONSOLIDATION.md](TODO_DB_CONSOLIDATION.md),
> [TODO_DB_FUNCTION_HYGIENE.md](TODO_DB_FUNCTION_HYGIENE.md),
> [TODO_DB_SECURITY.md](TODO_DB_SECURITY.md).
>
> **Scale caveat (keep honest):** rec-league row counts mean none of this is a
> latency emergency. Item 1 is the only real CPU hot spot (trigger-amplified JSONB
> parsing); items 2–4 are cheap hygiene; item 5 is measure-first.

Workflow per [context/agent-rules.md](context/agent-rules.md) §12. Index-only
migrations don't need a types regen; column additions (item 1) do.

---

## 1. Persist LaneTalk per-import stats (stop re-parsing JSONB history)

Today `lanetalk_seed_lines(player)` parses the `frames` JSONB of the player's
**entire official import history** on every call, and it's called per eligible
player by `sync_lanetalk_prop_markets_for_week` — which fires from **four
statement-level resync triggers** (rsvp, team_slots, scores, games). A single
admin team-generation flow triggers it repeatedly (games insert → eager score
seeding → scores trigger → full resync). `settle_lanetalk_props_for_week` parses
again at settlement.

The fix: compute each import's stats **once at insert**, store them as plain
columns, and make every consumer read columns.

**Status: ✅ DONE 2026-06-12** — migrations `20260612180513_lanetalk_import_stats_columns`
+ `20260612180553_lanetalk_consumers_read_columns` (commit `b16deee`). Five stat
columns + recompute trigger; seed/settle/sync read columns; seed lines for all
6 players verified byte-identical to the JSONB-parsing originals.

### Migration A — `lanetalk_import_stats_columns`
1. ```sql
   ALTER TABLE public.lanetalk_game_imports
     ADD COLUMN frames integer,
     ADD COLUMN strikes integer,
     ADD COLUMN spares integer,
     ADD COLUMN clean_pct numeric,
     ADD COLUMN first_ball_avg numeric;
   ```
   (Plain columns + trigger, not `GENERATED` — `lanetalk_game_stats` is a
   set-returning function, which generated-column expressions can't call.)
2. Backfill in the migration:
   ```sql
   UPDATE lanetalk_game_imports i SET
     frames = jsonb_array_length(COALESCE(i.payload->'frames','[]'::jsonb)),
     strikes = st.strikes, spares = st.spares,
     clean_pct = st.clean_pct, first_ball_avg = st.first_ball_avg
   FROM LATERAL public.lanetalk_game_stats(i.payload) st;
   ```
3. `BEFORE INSERT OR UPDATE OF payload` row trigger that recomputes the five
   columns from `NEW.payload` (the `lanetalk-import` Edge Function needs no change —
   the trigger covers its inserts).
4. Keep `lanetalk_game_stats(jsonb)` — it stays the single stat definition,
   now invoked once per import instead of per resync.

### Migration B — `lanetalk_consumers_read_columns`
Rewrite to read the columns instead of `CROSS JOIN LATERAL lanetalk_game_stats(payload)`:
- `lanetalk_seed_lines` (both the stats and the `frames > 0` filter),
- `settle_lanetalk_props_for_week` (per-game and night-aggregate branches),
- `sync_lanetalk_prop_markets_for_week` (the "no official history" prune
  predicate currently does `jsonb_array_length(payload->'frames') > 0` per row).

### Verification
- For a sample of imports, assert columns equal the function output:
  `SELECT count(*) FROM lanetalk_game_imports i, LATERAL lanetalk_game_stats(i.payload) st WHERE i.strikes IS DISTINCT FROM st.strikes …` → 0.
- Lines on the Place Bets board unchanged before/after (same seeded values).
- "Confirm LaneTalk Data" settles a dev week identically.
- Update [context/lanetalk-stat-bets.md](context/lanetalk-stat-bets.md): SQL
  columns (still SQL-side, still authoritative for money) replace on-the-fly parsing.

---

## 2. Covering index for balance checks

Every economic RPC computes `SUM(amount)` over `(player_id, season_id)`; the
existing `idx_pin_ledger_player_season` doesn't carry `amount`, so each check
heap-fetches. One covering index makes the hottest query in the schema
index-only.

**Status: ✅ DONE 2026-06-12** — migration `20260612181842_index_tuning`
(commit `cc0fe25`). `EXPLAIN (ANALYZE)` confirmed Index Only Scan on the
balance query.

### Migration — `pin_ledger_balance_covering_index`
```sql
DROP INDEX public.idx_pin_ledger_player_season;
CREATE INDEX idx_pin_ledger_player_season
  ON public.pin_ledger (player_id, season_id) INCLUDE (amount);
```
Verify with `EXPLAIN (ANALYZE)` on the balance query via `db query` —
expect `Index Only Scan`.

---

## 3. Drop redundant / dead indexes

**Measure first** (read-only):
```sql
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes
WHERE indexrelname IN ('bounty_post_season_id_idx','bounty_post_week_id_idx',
                       'idx_bets_status','idx_bet_markets_status',
                       'idx_pin_ledger_house','idx_pin_ledger_season');
```

**Status: ✅ DONE 2026-06-12** — migration `20260612181842_index_tuning`
(commit `cc0fe25`). Evidence-gated: dropped only the two zero-scan
prefix-redundant bounty indexes; **kept** `idx_bets_status`,
`idx_bet_markets_status`, `idx_pin_ledger_house`, `idx_pin_ledger_season` on
`idx_scan` evidence.

### Migration — `drop_redundant_indexes`
- `bounty_post_season_id_idx` — prefix-redundant with
  `bounty_post_board_idx (season_id, status, closes_at, created_at)`.
- `bounty_post_week_id_idx` — prefix-redundant with
  `bounty_post_week_board_idx (week_id, status, closes_at)`.
- `idx_bets_status`, `idx_bet_markets_status` — low-cardinality singletons;
  drop if `idx_scan` confirms unused (status filters always ride a week/season
  predicate that has its own index).
- `idx_pin_ledger_house (season_id) WHERE is_house` vs `idx_pin_ledger_season` —
  keep the partial (it serves `db.ts` house-row queries), drop the full
  `idx_pin_ledger_season` **only if** `idx_scan` shows the partial + player_season
  cover everything.

---

## 4. Add missing FK indexes (cascade-delete paths)

`scores(game_id)`, `team_slots(player_id)`, `rsvp(player_id)` have FKs but no
index with that leading column. They matter when the referenced side deletes
(week teardown cascades through `games → scores`; player merges/deletes scan
`team_slots`/`rsvp`).

**Status: ✅ DONE 2026-06-12** — migration `20260612181842_index_tuning`
(commit `cc0fe25`). All three FK indexes created.

### Migration — `fk_indexes`
```sql
CREATE INDEX scores_game_id_idx     ON public.scores (game_id);
CREATE INDEX team_slots_player_id_idx ON public.team_slots (player_id);
CREATE INDEX rsvp_player_id_idx     ON public.rsvp (player_id);
```

---

## 5. (Measure-first, deferred) Resync trigger amplification

One admin team-generation flow fires `resync_week_markets` several times
(games insert → participation seeding → scores statement trigger → …), each run
doing the full prune/create/reprice pass for **two** market families. After item 1
lands, each pass is cheap, which may make this moot.

If it still shows up (slow admin team-gen):
- Option A: short-circuit `resync_week_markets` when nothing it derives from
  changed — hard to detect cheaply; skip.
- Option B: session-level debounce via
  `SET LOCAL pindejos.skip_resync = on` around the multi-statement admin flows,
  checked at the top of the trigger functions, with one explicit
  `resync_week_markets()` call at the end (the admin flows already run through
  single RPC/db.ts paths).
- Option C (cheapest): accept it — the triggers are statement-level and the sync
  functions are idempotent.

Decide only with timings from the dev server. **Do not build B speculatively.**

---

## Done when
- [x] LaneTalk stats are columnar; consumers read columns; lines + settlement
      verified identical on a dev week
- [x] Balance query plans as Index Only Scan
- [x] Redundant indexes dropped (with `idx_scan` evidence), FK indexes added
- [x] Snapshot + types regenerated; lanetalk-stat-bets.md updated
