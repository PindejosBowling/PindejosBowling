# TODO — LaneTalk Stat Bets

> The previous TODO items (player mapping, Supabase persistence for frame data)
> shipped with the `lanetalk-import` Edge Function + `lanetalk_game_imports`
> table and were removed. This file now holds the agreed plan for **LaneTalk
> stat betting**, designed 2026-06-11 and ready to execute.

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
  - Stats computed from `lanetalk_game_imports.payload` jsonb **client-side**
    (FrameStats screen already does this).
- Line seeding: player's official-import history, **league-average fallback**
  (mirrors score O/U), hardcoded defaults if league has no data.
- Archive settles normal bets and leaves LaneTalk-prop bets pending (backstop
  exemption). Confirm later settles them; admin chooses to leave missing-data
  markets pending **or** void (delete-refund) them.

### Verified enablers (against supabase/schema.sql)

- Admin has INSERT/UPDATE/DELETE RLS on `bet_markets` + `bet_selections`
  (schema.sql:1156–1223) → market creation is pure client-side admin writes
  (same pattern as custom-lines CRUD).
- `prevent_self_tank` (schema.sql:3200) keys on selection key `'under'`/`'over'`
  with no market-type gate → anti-tank covers props automatically.
- The O/U + moneyline syncs only touch their own `market_type` → props are
  invisible to them (no dedupe collision, no pruning).
- **Archive/unarchive composes with no snapshot changes:** prop markets are
  week-stamped, so the archive preimage already captures their
  markets/selections/bets/legs; post-archive settlement via `settle_market`
  only UPDATEs those captured columns and INSERTs bet-linked, week-stamped
  `pin_ledger` rows — exactly what `unarchive_week` reverses
  (schema.sql:5101–5113). Confirm-before-archive also composes.

## 1. The one migration (function bodies only, no DDL) — `lanetalk_prop_settlement`

- [ ] Relax `settle_market` / `settle_market_internal` (schema.sql:4146/4161)
      from `market_type = 'over_under'` to `IN ('over_under', 'prop')` — the
      over/under/push derivation + `finalize_bets_for_market` engine settle
      stat props as-is.
- [ ] `settle_betting_for_week` backstop (schema.sql:3835): exempt any pending
      bet with ≥1 leg on an unsettled `prop` market from both the RAISE count
      and force-void. (Mixed parlays already work: `finalize_bets_for_market`
      skips bets with unresolved legs; a lost score-leg still kills the bet at
      archive.)
- [ ] Follow PIN_ECONOMY_SCHEMA §5 function conventions (header comment,
      pinned search_path). Push, then regen `database.types.ts` +
      `./supabase/refresh-schema-snapshot.sh`.

## 2. Shared stat helpers (app)

- [ ] New pure module `app/src/data/lanetalk/stats.ts`, extracted from / shared
      with `useFrameStatsData.ts` `computeSessionStats` so betting and the
      FrameStats screen can never disagree:
  - `gameStats(game)` → `{ strikes, spares, cleanPct, firstBallAvg }`
    (strikes = frames with `is_strike`; spares = `is_spare`;
    cleanPct = (strikes+spares)/frames×100; firstBallAvg = Σ `throws[0].pins` / frames).
  - `nightStats(games)` → same four aggregated across a week's official games.

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

## 4. Settlement — "Confirm LaneTalk Data" (client loop over existing RPC)

- [ ] On `LanetalkImportAdminScreen`, per week group with unsettled stat props:
      **Confirm LaneTalk Data** button → `LanetalkConfirmModal`
      (pattern: `AdminArchiveModal` — summary, warning box, armed second action).
- [ ] Hook computes per market: actual value from official imports joined on
      (week, player, game) via the §2 helpers. Night markets require the
      player's official-game count ≥ their scored-game count (never settle
      clean% off half a night).
- [ ] **Settle Available**: loop `betMarkets.settle(marketId, value)`
      (existing `settle_market` RPC, idempotent → safely re-runnable after
      late imports; partial failure → just re-run).
- [ ] **Settle + Void Missing** (armed): same, then DELETE data-less markets
      through RLS → refund trigger returns stakes whole. *Semantics note:
      refunded bets are removed rather than kept as `void` records — the
      existing delete-refund rail; keeping void records would need a
      settle-RPC migration later.*
- [ ] Toast summary (settled / refunded / left pending); reload; button hides
      when nothing is unsettled.

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
      enter-a-value path works once the RPC accepts props.

## 6. Docs

- [ ] New `context/lanetalk-stat-bets.md` (stat definitions, line seeding, the
      two-clock settlement model, delete-refund void semantics, no-roster-
      coupling caveat) + AGENTS.md index row.
- [ ] Update `supabase/PIN_ECONOMY_SCHEMA.md` (§3 mapping row for LaneTalk
      props, RPC table notes), `context/betting-line-board.md` (third
      consumer), `context/archive-and-settlement.md` (backstop exemption +
      post-archive composition).

## Verification (no test suite — Expo + `supabase db query`)

1. Push the migration; settle a throwaway prop via `settle_market`; confirm
   O/U behavior unchanged.
2. Generate stat lines → board shows Player Props per game + Night Props under
   WEEKLY; unders hidden; own-under blocked server-side if forced.
3. Place a single + a mixed parlay (score leg + stat leg). Archive night-of →
   succeeds without force; score bets settle; stat bets stay pending.
4. Import a session next day → Confirm → settled values match the FrameStats
   screen for the same game; payouts hand-checked. Missing-data market: leave
   pending, re-import, re-confirm; test Void Missing on a throwaway (stakes
   restored).
5. Unarchive after confirm → stat bets restored to pending + balances restored
   (PIN_ECONOMY §10 ledger integrity queries); re-archive + re-confirm →
   identical results.
