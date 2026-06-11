# TODO — LaneTalk Stat Bets

> The previous TODO items (player mapping, Supabase persistence for frame data)
> shipped with the `lanetalk-import` Edge Function + `lanetalk_game_imports`
> table and were removed. This file now holds the agreed plan for **LaneTalk
> stat betting**, designed 2026-06-11 (settlement moved server-side in the
> same-day revision) and ready to execute.

Bet lines on LaneTalk frame stats — **strikes O/U + spares O/U per game**,
**night-level clean % + first-ball avg O/U** — generated from imported
**official** LaneTalk games and settled when the admin taps **"Confirm LaneTalk
Data"** on the import screen. Archive runs night-of; LaneTalk data often lands
the next day, so these bets ride a **separate settlement clock** from
`archive_week`.

## Design constraints (agreed)

- **Zero schema changes.** No new tables or columns. Every persisted record is
  an ordinary row in the existing betting architecture:
  - A stat line = `bet_markets` with **`market_type = 'prop'`** (already in the
    CHECK, unused — the PIN_ECONOMY_SCHEMA §7 escape hatch).
    `params = { source: 'lanetalk', stat: 'strikes'|'spares'|'clean_pct'|'first_ball_avg', scope: 'game'|'night' }`.
    Per-game markets carry `game_number`; night markets `game_number = null`.
  - Sides = ordinary `bet_selections` (`key: 'over'|'under'`, `line`, same odds
    as score O/U). Bets/legs/ledger flow untouched (`place_house_bet` is
    market-type-agnostic).
- **Settlement values are derived server-side**, same trust model as every
  other settlement path: a SQL function computes the actual stat from
  `lanetalk_game_imports.payload` jsonb inside the settlement transaction
  (mirrors `settle_betting_for_week` deriving scores from `scores`). The
  client never supplies a `result_value` for systematic prop settlement —
  atomic, app-version-independent, auditable (every `result_value`
  reproducible from data in the same DB).
- Client-side stat code (`stats.ts`, shared with FrameStats) is **demoted to
  non-money duty**: line seeding + display only. A bug there mis-prices a
  line (visible before settlement), never mis-pays a bet.
- Line seeding: player's official-import history, **league-average fallback**
  (mirrors score O/U), hardcoded defaults if league has no data.
- Archive settles normal bets and leaves LaneTalk-prop bets pending (backstop
  exemption). Confirm later settles them; admin chooses to leave missing-data
  markets pending **or** void (delete-refund) them.

### Verified enablers (against supabase/schema.sql)

- `lanetalk_game_imports` already carries everything settlement needs, properly
  keyed (schema.sql:215–228): `week_id`, `player_id`, `game_number`,
  `classification = 'official'`, full frame data in `payload` jsonb. The four
  stats are trivial `jsonb_array_elements` aggregations.
- Admin has INSERT/UPDATE/DELETE RLS on `bet_markets` + `bet_selections`
  (schema.sql:1156–1223) → market creation is pure client-side admin writes
  (same pattern as custom-lines CRUD).
- `prevent_self_tank` (schema.sql:3200) keys on selection key `'under'`/`'over'`
  with no market-type gate → anti-tank covers props automatically.
- The O/U + moneyline syncs only touch their own `market_type` → props are
  invisible to them (no dedupe collision, no pruning).
- **Archive/unarchive composes with no snapshot changes:** prop markets are
  week-stamped, so the archive preimage already captures their
  markets/selections/bets/legs; post-archive settlement via
  `settle_lanetalk_props_for_week` only UPDATEs those captured columns and
  INSERTs bet-linked, week-stamped `pin_ledger` rows — exactly what
  `unarchive_week` reverses (schema.sql:5101–5113). Confirm-before-archive
  also composes.

## 1. The one migration (function bodies + 2 new functions, no DDL) — `lanetalk_prop_settlement`

- [ ] Relax `settle_market` / `settle_market_internal` (schema.sql:4146/4161)
      from `market_type = 'over_under'` to `IN ('over_under', 'prop')` — the
      over/under/push derivation + `finalize_bets_for_market` engine settle
      stat props as-is.
- [ ] `settle_betting_for_week` backstop (schema.sql:3835): exempt any pending
      bet with ≥1 leg on an unsettled `prop` market from both the RAISE count
      and force-void. (Mixed parlays already work: `finalize_bets_for_market`
      skips bets with unresolved legs; a lost score-leg still kills the bet at
      archive.)
- [ ] **New** `lanetalk_game_stats(p_payload jsonb)` — IMMUTABLE helper
      returning `(strikes int, spares int, clean_pct numeric, first_ball_avg numeric)`
      from a game payload (strikes = frames with `is_strike`; spares =
      `is_spare`; cleanPct = (strikes+spares)/frames×100; firstBallAvg =
      Σ `throws->0->>'pins'` / frames; null-coerce missing fields the way
      `payloadToGame` does). Single authoritative stat definition for money.
- [ ] **New** `settle_lanetalk_props_for_week(p_week_id uuid, p_void_missing boolean DEFAULT false)`
      — admin-gated RPC mirroring `settle_betting_for_week`'s loop
      (schema.sql:3779–3802), one transaction:
  - Loop non-settled `prop` markets of the week with
    `params->>'source' = 'lanetalk'`.
  - **Game markets**: actual value from the player's `official` import row
    matching (week, player, game_number) via `lanetalk_game_stats`.
  - **Night markets**: aggregate stats across the player's official imports
    for the week, **only when their official-game count ≥ their scored-game
    count** (never settle clean% off half a night); otherwise treat as
    missing data.
  - Data present → `settle_market_internal(market_id, value)` (idempotent).
  - Data missing → leave pending when `NOT p_void_missing`; else DELETE the
    market (the `refund_bets_before_market_delete` trigger refunds bets
    whole, same delete-refund rail as everywhere else).
  - Return a summary row `(settled int, voided int, left_pending int)` for
    the confirm toast.
- [ ] Follow PIN_ECONOMY_SCHEMA §5 function conventions (header comment,
      pinned search_path). Push, then regen `database.types.ts` +
      `./supabase/refresh-schema-snapshot.sh`.

## 2. Shared stat helpers (app — display + line seeding only, never settlement)

- [ ] New pure module `app/src/data/lanetalk/stats.ts`, extracted from / shared
      with `useFrameStatsData.ts` `computeSessionStats`:
  - `gameStats(game)` → `{ strikes, spares, cleanPct, firstBallAvg }`
    (same formulas as `lanetalk_game_stats` — keep a comment cross-linking
    the two; SQL is authoritative if they ever drift).
  - `nightStats(games)` → same four aggregated across a week's official games.
- [ ] Consumers: line generation (§3) and FrameStats display. Settlement (§4)
      goes through the §1 RPC and never touches this module.

## 3. Line generation — admin client-side writes (no sync function)

- [ ] `useLanetalkLineAdmin` hook + db.ts methods; **"Generate Stat Lines"**
      button on `AdminSportsbookScreen`. Idempotent + re-runnable.
- [ ] Eligible subjects = same ladder as the O/U sync (participation `scores`
      rows when games exist, else slots, else RSVP), read via existing queries.
- [ ] Lines from **official** imports only: player history when ≥3 official
      games, else league average across all official imports, else defaults
      (strikes 3.5, spares 3.5, clean 62.5, first-ball 8.0). Rounding:
      counts → `floor(avg)+0.5` clamp [0.5, 9.5]; clean% → `floor(avg/5)*5+2.5`
      (night results over 20 frames are multiples of 5 → no pushes);
      first-ball avg → `round(avg,1)` (rare push → existing push-refund).
- [ ] Writes: INSERT `bet_markets` (`prop`, params, title e.g. "Jordan Strikes
      — Game 1") + two `bet_selections` (over/under, O/U odds); skip when a
      market with same week/subject/params/game exists; prune ineligible
      leftovers with DELETE (the `refund_bets_before_market_delete` trigger
      refunds bets whole).
- [ ] Caveat to document: no server-side roster coupling — roster changes after
      generation need an admin re-tap (or the confirm flow voids strays).

## 4. Settlement — "Confirm LaneTalk Data" (one RPC call)

- [ ] On `LanetalkImportAdminScreen`, per week group with unsettled stat props:
      **Confirm LaneTalk Data** button → `LanetalkConfirmModal`
      (pattern: `AdminArchiveModal` — summary, warning box, armed second action).
- [ ] Modal preview (client-side, informational only): which markets have data
      vs. missing, computed via the §2 helpers — the server recomputes
      authoritatively inside the RPC.
- [ ] **Settle Available**: `settle_lanetalk_props_for_week(weekId)` —
      atomic, idempotent → safely re-runnable after late imports.
- [ ] **Settle + Void Missing** (armed):
      `settle_lanetalk_props_for_week(weekId, true)`. *Semantics note:
      refunded bets are removed rather than kept as `void` records — the
      existing delete-refund rail; keeping void records would need a
      settle-RPC change later.*
- [ ] Toast summary from the RPC's return row (settled / refunded / left
      pending); reload; button hides when nothing is unsettled.

## 5. Board + bet surfaces (pure app code, per context/betting-line-board.md recipe)

- [ ] `betMarkets.listActivePropByWeek(weekId)` (MARKET_GRAPH embed,
      `market_type='prop'`, status open/closed) merged into `openLines` in
      `usePinsinoData`.
- [ ] `LineView` gains `statKey` (from `params.stat`) → `subtitle` like
      `STRIKES · LINE 4.5`.
- [ ] `lineGroup`: prop + `gameNumber == null` → new **WEEKLY** group (after
      games, before SEASON — same label styling custom lines use).
- [ ] `lineCategory`: per-game props → `Player Props`; night props → `Night Props`.
- [ ] `selectionBetsAgainstSubject('prop','under') → true`; extend
      SportsbookScreen's `isSelectionHiddenInUI` so **unders stay UI-hidden**
      (same social policy as score O/U, same trivial revert).
- [ ] Extend per-game open/close toggles (`setOUStatusByWeekGame`,
      `reopenOUForWeek` in db.ts) to include props of the same game; closing
      game 1 also closes night markets.
- [ ] Placed-bet surfaces (`BetRow`, `BetDetailModal`, `SettleBetModal`, ledger
      rows): extend the `marketType === 'over_under'` line-display gates to
      lanetalk props (stat label + line). `SettleBetModal`'s manual
      enter-a-value path works once the RPC accepts props (admin escape
      hatch only — systematic settlement is §4's RPC).

## 6. Docs

- [ ] New `context/lanetalk-stat-bets.md` (stat definitions + the SQL-is-
      authoritative rule, line seeding, the two-clock settlement model,
      delete-refund void semantics, no-roster-coupling caveat) + AGENTS.md
      index row.
- [ ] Update `supabase/PIN_ECONOMY_SCHEMA.md` (§3 mapping row for LaneTalk
      props, RPC table rows for `lanetalk_game_stats` +
      `settle_lanetalk_props_for_week`), `context/betting-line-board.md`
      (third consumer), `context/archive-and-settlement.md` (backstop
      exemption + post-archive composition).

## Verification (no test suite — Expo + `supabase db query`)

1. Push the migration; settle a throwaway prop via `settle_market`; confirm
   O/U behavior unchanged. Spot-check `lanetalk_game_stats` against the
   FrameStats screen for a few imported games (`db query`).
2. Generate stat lines → board shows Player Props per game + Night Props under
   WEEKLY; unders hidden; own-under blocked server-side if forced.
3. Place a single + a mixed parlay (score leg + stat leg). Archive night-of →
   succeeds without force; score bets settle; stat bets stay pending.
4. Import a session next day → Confirm (RPC) → settled values match the
   FrameStats screen for the same game; payouts hand-checked. Missing-data
   market: leave pending, re-import, re-confirm (idempotent); test Void
   Missing on a throwaway (stakes restored).
5. Unarchive after confirm → stat bets restored to pending + balances restored
   (PIN_ECONOMY §10 ledger integrity queries); re-archive + re-confirm →
   identical results.
