# Weekly Archive / Unarchive — Implementation Handoff

**Status:** Designed, not yet implemented. This document is the actionable spec for an executing agent.
**Audience:** An engineer/agent who will write the migration + app code.
**Verified against:** `supabase/schema.sql` (current live schema dump) — all table/column/FK facts below
were confirmed there, *not* from the (in places stale) migration history.

---

## 1. Why this exists

The **weekly archive** is the most critical operation in the game. It locks a week's PBL performance
(scores → standings) and derives **every** Pinsino economy effect from it in one settlement pass:
score-credit pincome, Sportsbook settlement (O/U + moneyline), Loan Shark garnishment/interest, PvP
auto-settlement, and the house-P&L Activity Feed event.

Today it **cannot be reversed**, which blocks two needs:

1. **Forward-looking testing** — run a user flow, archive, inspect how the archive handled it, reset,
   repeat.
2. **Production bug recovery** — if a score or a settlement derivation is wrong, the derived economy is
   permanently baked in; the only fix is hand-surgery on the live DB.

### Root-cause diagnosis (the risk to fix)

The archive runs **client-side as three separate, non-atomic calls** in
`app/src/components/AdminArchiveModal.tsx` (`confirm()`):

1. `weeks.update({ is_archived: true, bowled_at })`
2. `betMarkets.settleForWeek(weekId)` → `settle_betting_for_week` RPC (the 6-step settlement)
3. `weeks.insert(next week)`

Problems:

- **Input lock is decoupled from derived effects.** Step 1 (the `is_archived` source-of-truth flag)
  is independent of step 2 (settlement). The modal even has a live "archived — settlement failed"
  branch: the flag can be `true` while the economy was never derived. No transaction boundary → a crash
  between steps leaves a partially-archived week with no recovery.
- **No first-class settlement record.** Idempotency is scattered heuristics (`description LIKE
  'Week N %'` for score credits; row-existence checks in `process_weekly_loans`; `status <> 'settled'`
  market checks). Nothing records "week N's settlement ran; here is exactly what it produced."
- **No reversal path** exists anywhere.

### What to build

1. **Atomic coupling.** One transactional `archive_week(p_week_id)` RPC: set the lock, capture a
   pre-image snapshot, run settlement, create the next week — all-or-nothing. The modal calls only this.
2. **A reversible mirror.** `unarchive_week(p_week_id, p_mode, p_force)` that restores the economy to
   the exact pre-archive checkpoint, **always destroys week N+1**, so re-running `archive_week(N)`
   re-derives everything fresh on a clean slate.
3. **An admin "League Tools" screen** to drive it safely (LIFO guard + downstream-activity warning).

---

## 2. Confirmed design decisions

- **Atomic archive.** One `archive_week` RPC owns the whole operation.
- **Both unarchive modes destroy week N+1.** Re-running archive recreates a brand-new N+1 + fresh
  settlement entries. The reversal core is identical for both modes.
- **Soft vs Hard = whether the score lock is touched** (the only difference):
  - **Soft** — reverse the derived economy + delete N+1, but leave `weeks[N].is_archived = true`
    (scores stay locked). Use case: a *settlement/derivation* bug — fix the logic, re-trigger archive to
    re-derive the same scores in place.
  - **Hard** — everything Soft does, plus set `weeks[N].is_archived = false`, `bowled_at = NULL`
    (reopen scores/standings for editing). Use case: an *input-data* bug — reopen, correct the score, re-archive.
- **Downstream guard.** Unarchive only the most-recently-archived week (LIFO). If a later week holds
  player activity, **warn but allow override** via `p_force`.

---

## 3. The reversal model — archive as a point-in-time snapshot

The archive must be a checkpoint that unarchive restores to the **exact instant before archive ran,
touching nothing that happened earlier in the week.** Reconstruction-by-rule ("set markets back to
`open`", "flip cancelled PvP challenges back to `pending`") is **unsafe**: the pre-archive value is
ambiguous — a `bet_market` may have been manually `closed`, and a `pvp_challenge` may already be
`cancelled` from the **"Start Game"** admin action or a player **decline** *earlier in the week*
(`close_open_pvp_challenges` reuses `status='cancelled'`). Guessing would resurrect pre-archive actions.

So `archive_week` **captures a pre-image snapshot at archive-start (before any settlement runs)**, and
`unarchive_week` restores from it. Two capture kinds, anchored to the archive run id.

### 3a. Append-row id capture (reverse INSERTs by exact id-set)

Settlement only *inserts* into these tables. Capture the set of ids that **already existed** for the
week before settlement; unarchive deletes the rows matching the predicate whose id is **not** in the
captured set — i.e. exactly the rows the archive inserted. Stakes posted earlier (`bet_stake`,
`pvp_stake`, `loan_issued`) were already present → captured → **preserved**.

| Table | Capture / delete predicate | Why |
|---|---|---|
| `pin_ledger` | `week_id = N` **OR** `bet_id IN (<week-N bets>)` | ⚠️ `bet_payout`/`bet_refund` are inserted with **`week_id = NULL`** (see `finalize_bets_for_market`), linked only by `bet_id`. The `bet_id` branch is **required**. `score_credit`, `loan_weekly_garnishment`, `pvp_*` rows are all `week_id = N`. |
| `loan_ledger` | `week_id = N` | `weekly_garnishment` + `weekly_interest` rows are week-stamped. (Loan issuance/repayment rows for the week are pre-existing → preserved.) |
| `pvp_ledger` | `week_id = N` | `payout`/`refund` settlement rows are week-stamped (`v_challenge.week_id`). `stake` rows are pre-existing → preserved. |
| `activity_feed_events` | `week_id = N` | Both settlement-published events — `sportsbook_weekly_house_result` and `pvp_challenge_settled` — pass `p_week_id = N` (verified). Deleting them is **required**: `pvp_challenge_settled` has a UNIQUE `(pvp_challenge_id, event_type)` index, so a leftover row makes re-archive fail. |

`<week-N bets>` = `SELECT DISTINCT b.id FROM bets b JOIN bet_legs l ON l.bet_id=b.id JOIN
bet_selections s ON s.id=l.selection_id JOIN bet_markets m ON m.id=s.market_id WHERE m.week_id = N`.

### 3b. Column pre-image capture (reverse UPDATEs by restoring exact prior values)

Capture `(table, pk, jsonb of the mutable columns)` for every week-N lifecycle row settlement may
update; unarchive restores them verbatim. A row already cancelled/closed *before* archive has a
pre-image in that state → restore is a no-op (this is the "Start Game"/decline correctness case).

| Table | Rows to capture | Mutable columns to snapshot + restore |
|---|---|---|
| `bet_markets` | `week_id = N` | `status`, `result_value`, `settled_at` |
| `bet_selections` | `market_id IN (week-N markets)` | `result` |
| `bets` | `id IN (<week-N bets>)` | `status`, `potential_payout`, `settled_at` |
| `bet_legs` | `selection_id IN (selections of week-N markets)` | `result` |
| `pvp_challenges` | `week_id = N` | `status`, `winner_player_id`, `result_detail`, `settled_at`, `admin_note` |
| `pvp_challenge_offers` | `challenge_id IN (week-N challenges)` | `superseded_at`, `accepted_at`, `declined_at` |
| `loans` | `season_id = <season(N)>` AND `status = 'active'` at capture time | `status`, `paid_off_at` |

Over-capturing is safe (restoring an unchanged row to its identical pre-image is a no-op). League scale
makes one run's snapshot small.

### 3c. Destroy week N+1 (both modes)

Deleting the `weeks` row for N+1 cascades to `teams` → `games` → `bet_markets` → `bet_selections`,
and `pvp_challenges` (all `ON DELETE CASCADE`). The existing `refund_bets_before_market_delete`
BEFORE-DELETE trigger on `bet_markets` auto-refunds any bets placed on N+1 (deletes the ledger pair +
the bets). **Gotcha:** `rsvp.week_id → weeks` has **no `ON DELETE CASCADE`** — you must
`DELETE FROM rsvp WHERE week_id = <N+1>` *before* deleting the week, or the delete throws an FK error.
(`pin_ledger`/`pvp_ledger`/`loan_ledger`/`activity_feed_events`/`bounty_post` week_id FKs are
`ON DELETE SET NULL`, so any N+1 rows there are nulled, not blocked.)

---

## 4. Migration spec

New file: `supabase/migrations/<YYYYMMDDhhmmss>_archive_unarchive_week.sql` (use a timestamp later than
`20260610120000`). All functions: `SECURITY DEFINER SET search_path = ''`, admin guard
`IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;`,
then `REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`. **`season_id` is `uuid`**.

### 4a. Tables

```
week_archive_runs (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid not null references weeks(id) on delete cascade,
  season_id    uuid not null references seasons(id) on delete cascade,
  actor_id     uuid references players(id) on delete set null,
  archived_at  timestamptz not null default now(),
  status       text not null default 'active' check (status in ('active','reversed')),
  reversed_mode text check (reversed_mode in ('soft','hard')),
  reversed_at  timestamptz,
  details      jsonb not null default '{}'::jsonb
)

week_archive_snapshot (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references week_archive_runs(id) on delete cascade,
  kind       text not null check (kind in ('preexisting_id','preimage_row')),
  table_name text not null,
  pk         uuid not null,
  payload    jsonb,              -- null for preexisting_id; mutable-column snapshot for preimage_row
  created_at timestamptz not null default now()
)
```

Enable RLS on both. No client policies needed (only the SECURITY DEFINER RPCs touch them); optionally
add an admin-only `SELECT` policy if the admin screen will show run history.

### 4b. `archive_week(p_week_id uuid)` — replaces the 3 client steps

1. Admin guard. `SELECT season_id, week_number INTO v_season_id, v_week_number FROM weeks WHERE id=p_week_id;`
   raise if not found.
2. Resolve `v_actor_id` from `players WHERE user_id = auth.uid()`.
3. `INSERT week_archive_runs(week_id, season_id, actor_id) ... RETURNING id INTO v_run_id`.
4. **Capture snapshot (before any mutation):**
   - `preexisting_id` rows: `pin_ledger` (predicate in 3a), `loan_ledger` (`week_id=N`),
     `pvp_ledger` (`week_id=N`), `activity_feed_events` (`week_id=N`).
   - `preimage_row` rows: the seven lifecycle tables in 3b (store the listed columns in `payload`).
   - Helper: a single CTE for `<week-N bets>` / week-N markets reused across captures.
5. `UPDATE weeks SET is_archived=true, bowled_at=current_date WHERE id=p_week_id;` (idempotent — also
   fine when already true in the Soft re-archive case).
6. `PERFORM settle_betting_for_week(p_week_id);` (reuse unchanged; its `NOT EXISTS` guards re-mint
   cleanly after an unarchive wipe).
7. `INSERT INTO weeks(season_id, week_number) VALUES (v_season_id, v_week_number + 1)` **if not exists**
   (`ON CONFLICT (season_id, week_number) DO NOTHING`).
8. One transaction → all-or-nothing.

### 4c. `unarchive_week(p_week_id uuid, p_mode text, p_force boolean default false)`

1. Admin guard. Validate `p_mode IN ('soft','hard')`.
2. **LIFO guard:** raise if any archived week in the season has `week_number > N`.
3. Resolve the latest `status='active'` `week_archive_runs` row for week N (raise if none).
4. **Downstream check:** compute N+1 (`week_number = N+1`, same season). If it exists and has any
   activity — scores, `bet_markets`/`bets` via its markets, `pvp_challenges`, `loans` issued that week,
   ledger rows, or `rsvp` — and `NOT p_force`, `RAISE EXCEPTION` with a summary string the app parses
   (e.g. `Downstream activity: 3 bets, 1 loan`). If `p_force`, proceed.
5. **Reversal core (both modes), inside the transaction:**
   1. For each append table: `DELETE FROM <t> WHERE <predicate-3a> AND id NOT IN
      (SELECT pk FROM week_archive_snapshot WHERE run_id=v_run_id AND table_name='<t>' AND kind='preexisting_id')`.
      Order: `activity_feed_events`, then `pin_ledger`, `pvp_ledger`, `loan_ledger` (no hard FK ordering
      needed among these for deletes, but delete `pin_ledger` rows referencing `pvp_ledger`/`loan_ledger`
      is fine because those FKs are `SET NULL`).
   2. For each `preimage_row`: `UPDATE <table> SET <cols> = payload->>... WHERE id = pk`. Cast jsonb
      back to column types (timestamps, numerics, the `result_detail` jsonb).
   3. Delete week N+1: `DELETE FROM rsvp WHERE week_id = v_next_week_id;` then
      `DELETE FROM weeks WHERE id = v_next_week_id;` (cascades + refund trigger handle the rest).
6. **Mode branch:** `full` → `UPDATE weeks SET is_archived=false, bowled_at=NULL WHERE id=p_week_id;`
   `soft` → leave the week as-is.
7. `UPDATE week_archive_runs SET status='reversed', reversed_mode=p_mode, reversed_at=now() WHERE id=v_run_id;`
   (its `week_archive_snapshot` rows can be left for audit or deleted; cascade handles it if the run is
   ever deleted).

### 4d. Re-archive behavior (sanity)

After unarchive, `archive_week(N)` re-runs cleanly: score credits re-mint (the `description LIKE
'Week N %'` guard finds none, since they were deleted); markets re-settle (reverted to pre-settle
`status <> 'settled'`); loans re-garnish (`loan_ledger` weekly rows deleted); PvP re-settles (challenges
reverted to `locked`; archive-cancelled ones reverted to `pending`/`countered` then re-closed); the feed
event re-publishes; N+1 is recreated. A new `active` run + snapshot is written.

---

## 5. App layer

- **`app/src/utils/supabase/db.ts`** — add a `leagueTools` object (mirror the `betMarkets`/`weeks`
  patterns):
  - `archiveWeek(weekId)` → `supabase.rpc('archive_week', { p_week_id: weekId })`
  - `unarchiveWeek(weekId, mode, force)` → `supabase.rpc('unarchive_week', { p_week_id: weekId, p_mode: mode, p_force: force })`
  - `getArchivedWeeks()` → archived weeks for the current season, most recent first.
  - A downstream-activity summary query for the confirmation sheet (counts of N+1 scores/bets/loans/pvp/rsvp).
- **`app/src/components/AdminArchiveModal.tsx`** — replace the three
  `weeks.update` / `betMarkets.settleForWeek` / `weeks.insert` calls in `confirm()` with a single
  `leagueTools.archiveWeek(activeWeek.id)`. Same UX, now atomic + audited.
- **New screen `app/src/screens/LeagueToolsAdminScreen.tsx`** — gate with
  `const isAdmin = useAuthStore(s => s.role) === 'admin'` (same pattern as `PinsinoAdminScreen.tsx`).
  List archived weeks; each row offers **Soft Unarchive** and **Hard Unarchive**. On tap: a confirmation
  sheet that (a) explains the chosen mode's exact effect, (b) lists any N+1 downstream activity, (c) on
  confirm calls `unarchiveWeek(weekId, mode, true)`. After success, surface "now re-run Archive & Advance
  to re-derive on a clean slate."
- **Register** the screen in `app/src/navigation/MoreStackNavigator.tsx` + its route in
  `MoreStackParamList`, and add an admin-only entry under the **LEAGUE ADMIN** section of
  `app/src/screens/MoreHomeScreen.tsx`.

---

## 6. Schema-compliance corrections (read before coding)

These differ from the older migration files; the live `schema.sql` is authoritative:

1. **The loan ledger is `loan_ledger`, not `debt_ledger`.** The `pin_ledger` link column is
   **`pin_ledger.loan_ledger_id`** (there is no `debt_ledger_id`). Any doc/snippet referencing
   `debt_ledger`/`debt_ledger_id` is stale.
2. **`seasons.id` and `weeks.season_id` are `uuid`** (an early `serial` was migrated). Declare
   `week_archive_runs.season_id uuid`.
3. **`bet_payout`/`bet_refund` `pin_ledger` rows have `week_id = NULL`** — reverse them via the
   `bet_id` branch (§3a), never `week_id` alone.
4. **`activity_feed_events.week_id` is `ON DELETE SET NULL`**, and there are UNIQUE
   `(source_fk, event_type)` indexes (incl. `(pvp_challenge_id, event_type)`). Both settlement-published
   feed events are week-stamped, so the `week_id` id-set delete removes them — necessary so re-archive
   doesn't hit the unique index.
5. **`rsvp.week_id` has no cascade** — delete N+1 rsvp rows before deleting the week (§3c).
6. **PvP live `contract_type`s** are `line_duel`, `prop_duel`, `head_to_head`, `custom`;
   `settle_pvp_for_week` auto-settles the first three (not `custom`). Reversal captures **all** week-N
   `pvp_challenges` regardless, so this needs no special-casing.
7. Live `settle_pvp_challenge` winner path pays the **full `total_pot`** (no separate rake row in the
   current version) — irrelevant to reversal (all `pvp_ledger`/`pin_ledger` settlement rows are
   `week_id = N`), noted for accuracy.

---

## 7. Key files

| Path | Role |
|---|---|
| `supabase/schema.sql` | **Authoritative** current schema. Re-read before writing the migration. |
| `supabase/migrations/<new>_archive_unarchive_week.sql` | New: the two tables + `archive_week` + `unarchive_week`. |
| `supabase/schema.sql` → `settle_betting_for_week` (≈L3412) | Settlement engine reused unchanged; the canonical list of effects to reverse. |
| `supabase/schema.sql` → `finalize_bets_for_market` (≈L2619) | Proves `bet_payout`/`bet_refund` lack `week_id`. |
| `supabase/schema.sql` → `process_weekly_loans` (≈L2931) | Proves `loan_ledger` + `loan_ledger_id`, week-stamped. |
| `supabase/schema.sql` → `settle_pvp_challenge` (≈L3905) / `settle_pvp_for_week` (≈L4142) | PvP settlement + week-scoped `close_open_pvp_challenges`; feed event week-stamped. |
| `supabase/migrations/20260610003542_refund_bets_before_market_delete.sql` | Trigger that makes N+1 deletion self-refunding. |
| `app/src/components/AdminArchiveModal.tsx` | Refactor to one RPC. |
| `app/src/utils/supabase/db.ts` | New `leagueTools` query object. |
| `app/src/screens/LeagueToolsAdminScreen.tsx` (new) + `app/src/navigation/MoreStackNavigator.tsx` + `app/src/screens/MoreHomeScreen.tsx` | The admin UI + registration. |

---

## 8. Verification

Apply with `supabase db push` (needs `SUPABASE_ACCESS_TOKEN` from `app/.env.local` +
`--linked --workdir $(pwd)`); regenerate `supabase/schema.sql` afterward. Drive via `expo start` against
a test season.

1. **Conservation baseline.** Record per-player `SUM(pin_ledger.amount)` and the season identity
   `SUM(amount) = SUM(amount WHERE type='score_credit')` before archiving.
2. **Atomic archive.** Run **Archive & Advance** → confirm score credits, bet payouts, loan
   garnishment, PvP settlements, the `sportsbook_weekly_house_result` feed event, week N+1, and a
   `week_archive_runs` `active` row (+ its `week_archive_snapshot` rows) all appear together.
3. **Soft unarchive.** Assert: all week-N settlement rows in `pin_ledger`/`loan_ledger`/`pvp_ledger`
   and the settlement feed events are gone; `bets`/`bet_markets`/`pvp_challenges`/`loans` restored to
   pre-settle values; **`bet_stake`/`pvp_stake`/`loan_issued` untouched**; week N+1 deleted;
   `weeks[N].is_archived` still **true**. Re-run Archive → fresh settlement + new N+1; conservation
   identity holds.
4. **Hard unarchive.** Same as Soft plus `weeks[N].is_archived=false`, `bowled_at=NULL`. Edit a score,
   re-Archive, confirm the corrected outcome propagates (e.g. a bet that now wins, a flipped moneyline).
5. **Downstream guard.** Place a bet / take a loan / add an RSVP in week N+1, attempt unarchive →
   confirm the RPC raises with the activity summary and the app shows the warning; confirm `force=true`
   proceeds and the N+1 bet is refunded (refund trigger) with balances restored.
6. **LIFO guard.** Archive two weeks, attempt to unarchive the older → confirm rejection.
7. **Snapshot correctness (the point-in-time guarantee).** Before archiving week N: (a) cancel one open
   PvP challenge via **"Start Game"** and have a player **decline** another; (b) leave a third `locked`.
   Archive, then unarchive (either mode). Assert the locked one is back to `locked` and re-settleable,
   while the two **pre-archive** `cancelled` challenges remain `cancelled` with `declined_at` intact —
   reversal restored to the checkpoint and did **not** resurrect pre-archive actions. Repeat the check
   for a manually-`closed` `bet_market`.

---

## 9. Open items for the executor

- **Re-read `supabase/schema.sql` for the exact mutable-column types** when writing the `preimage_row`
  capture/restore (timestamps vs `result_detail jsonb` vs numerics) so the jsonb round-trip casts are
  correct.
- **Decide snapshot storage shape** if `id NOT IN (...)` on `week_archive_snapshot` feels heavy at
  scale: an equivalent is to capture pre-existing ids, run settlement, then store the *inserted* ids
  (`kind='inserted_id'`) and have unarchive delete that exact set. Either is correct; the `NOT IN`
  form avoids a post-settlement diff pass.
- **Confirm `getArchivedWeeks` season scoping** uses `seasons.getCurrent()` semantics
  (`is_active = true AND registration_open = false`), per house rule #4.
- The `force`-delete of a week N+1 that already has *loans* taken in it is best-effort (loan rows get
  `week_id` nulled, loan stays active). Surface this in the warning copy; full cascade of arbitrary N+1
  player activity is out of scope for v1.
