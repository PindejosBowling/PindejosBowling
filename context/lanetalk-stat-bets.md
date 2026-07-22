# LaneTalk Stat Bets — frame-stat props on a second settlement clock

> **OddsEngine (2026-07-22):** `sync_lanetalk_prop_markets_for_week` now mints
> fair-priced alt-line **ladders** around the unchanged `lanetalk_seed_lines`
> seed (official games only feed the pricing model), and the betless reprice
> block became a churn-guarded re-ladder. Settlement grades each rung against
> its own line (side-aware). See [odds-engine.md](odds-engine.md).

Bet lines on LaneTalk frame stats: **strikes + spares + clean frames O/U, both
per game and night-level** (standardized 2026-07-01 — every scope carries the
full stat range; **first-ball avg is retired as a bettable line**, kept only
for settled history) — generated from imported **official** LaneTalk games and
settled when the admin taps **"Confirm LaneTalk Data"** on the import screen.
The same Confirm also settles **LaneTalk-clock team props**
(`market_type='team_prop'`, `params.clock='lanetalk'` — game AND night scope;
**generation retired 2026-07-21**, settle path kept for cutover/history) and
**LaneTalk-clock combo lines** (`market_type='combo'`,
`params.clock='lanetalk'` — the team-prop replacement, settled in `settle_week`
step (c‴) with a per-member complete-data guard; see
[combo-lines.md](combo-lines.md)). Archive runs night-of; LaneTalk data often
lands the next day, so these bets ride a **separate settlement clock** from
`archive_week`. The Confirm badge queries (`listUnsettledLanetalkProps` /
`listSettledLanetalkPropWeeks` in `db/economy.ts`) therefore match **three**
market shapes: lanetalk props, lanetalk-clock team props, and lanetalk-clock
combos.

**Zero schema additions.** Every persisted record is an ordinary row in the
existing betting architecture:

- A stat line = `bet_markets` with **`market_type = 'prop'`** (the
  PIN_ECONOMY_SCHEMA §7 escape hatch) and
  `params = { source: 'lanetalk', stat: 'strikes'|'spares'|'clean_frames'|'first_ball_avg', scope: 'game'|'night' }`.
  Per-game markets carry `game_number`; night markets have `game_number = null`.
- Sides = ordinary `bet_selections` (`key: 'over'|'under'`, shared `line`,
  even-money odds like score O/U). Bets/legs/ledger flow untouched
  (`place_house_bet` is market-type-agnostic); `prevent_self_tank` keys on the
  `'under'` selection key, so anti-tank covers props automatically.

## Stat definitions — SQL is authoritative

The four stats have **one money definition**: the SQL function
`lanetalk_game_stats(p_payload jsonb)` (IMMUTABLE), computed from
`lanetalk_game_imports.payload`:

| stat | definition |
|---|---|
| `strikes` | frames with `is_strike` |
| `spares` | frames with `is_spare` |
| `clean_frames` | strikes + spares (a frame count; night = total across games) |
| `first_ball_avg` | Σ first-ball pins (`throws->0->>'pins'`) / frames |

(`clean_pct` — (strikes+spares)/frames×100 — and `first_ball_avg` are retired
for new markets; the settle RPC still grades any pre-change market carrying
them, and the sync prunes only **betless** retired-stat markets so a live FBA
bet rides to Confirm untouched.)

The client mirror lives in
[app/src/data/lanetalk/stats.ts](../app/src/data/lanetalk/stats.ts)
(`gameStats` / `nightStats`) and is **demoted to non-money duty**: line seeding
and display only. If the two ever drift, **the SQL wins** — a client bug
mis-prices a line (visible before settlement), never mis-pays a bet. Night
aggregates are **frame-level totals**, not per-game means.

**Stats are columnar since 2026-06-12** (`lanetalk_import_stats_columns`):
each import's `frames`/`strikes`/`spares`/`clean_pct`/`first_ball_avg` are
plain columns on `lanetalk_game_imports`, computed once by a
`BEFORE INSERT OR UPDATE OF payload` trigger that calls
`lanetalk_game_stats()` — which remains the single (still SQL-side, still
money-authoritative) stat definition. `lanetalk_seed_lines`, the settle RPC,
and the sync prune predicate read the columns; nothing re-parses payload
JSONB per resync anymore.

## The two-clock settlement model

**As of the advance/settle split** (migrations `…190000`/`…200000`), both clocks
are the SAME RPC on different days — LaneTalk prop settlement is **folded into
`settle_week`** (step c″), not a separate function. `settle_lanetalk_props_for_week`
survives only as a deprecated shim → `settle_week`. See
[archive-and-settlement.md](archive-and-settlement.md) §3.

1. **Advance (bowl-night).** `advance_week` locks the week and moves no money —
   nothing settles yet, so stat bets (and everything else) simply stay pending.
   The old archive-time backstop no longer runs here.
2. **Settle (next day, after import).** `settle_week(week, void_missing, force)`
   settles score O/U + moneylines + team `total_pins`, **and** in step c″ the
   LaneTalk player + team props — one transaction, idempotent / re-runnable for
   late imports:
   - **Game markets**: actual from the subject's `official` import row matching
     (week, player, game_number) via `lanetalk_game_stats`.
   - **Night markets**: frame-weighted aggregate across the player's official
     imports for the week, **only when their official-game count ≥ their
     scored-game count** (never settle a night stat off half a night); else missing.
   - **LaneTalk-clock team props** (since `…153000_standardize_betting_lines_settlement`,
     which closed a gap — earlier comments claimed the Confirm settled these but
     the loop only selected `market_type='prop'`): team value = **Σ official
     imports of the team's NON-FILL roster** (the population `team_prop_seed_line`
     prices and the anti-tank trigger guards; fills contribute nothing), for the
     market's game (game scope) or the whole week (night scope). Complete-data
     guard mirrors the player night guard: every non-fill roster player with a
     recorded score (for that game / any game) must have covering official
     imports, and ≥1 import must exist (an import-less team never settles at 0).
   - Data present → `settle_market_internal` (accepts
     `over_under`/`prop`/`team_prop` — same over/under/push engine).
   - Missing → left pending when `NOT p_void_missing`; else the market is
     **DELETEd** (the `refund_bets_before_market_delete` trigger refunds bets
     whole — see void semantics below).
   - `settle_week`'s **narrowed backstop** then exempts a still-pending bet from
     the void only if it has a leg on a still-unsettled LaneTalk market AND
     `NOT p_void_missing` — i.e. a market genuinely still awaiting data. With
     `p_void_missing=true` those markets were already delete-refunded, so nothing
     is exempt.
   - Returns `{settled, voided, left_pending, house_net}` (the shim returns the
     old `(settled, voided, left_pending)` TABLE).

**App flow:** `LanetalkImportAdminScreen` shows a **Settle Week** button on any
advanced-but-unsettled week group (or **Re-settle Week** when a settled week has
late-imported props pending) →
[`AdminSettleModal`](../app/src/components/admin/AdminSettleModal.tsx), whose
warning is driven by the **server-side** `preview_settle_week` (the old
client-side `stats.ts` coverage mirror is gone) → **Settle Available** or the
armed **Settle + Void Missing**.

**Void semantics = delete-refund.** Refunded bets are *removed* rather than
kept as `void` records — the existing delete-refund rail. Keeping void records
would require a settle-RPC change later.

**Archive/unarchive composition.** Prop markets are week-stamped, so the
archive preimage already snapshots their markets/selections/bets/legs;
post-archive settlement only UPDATEs captured columns and INSERTs bet-linked,
week-stamped `pin_ledger` rows — exactly what `unarchive_week` reverses.
Confirm-before-archive composes too.

## Line generation — server-side sync, RSVP-coupled (no manual step)

`sync_lanetalk_prop_markets_for_week(week_id)` (migration
`…170000_lanetalk_prop_sync`) mirrors `sync_over_under_markets_for_week` and is
called from **`resync_week_markets`**, so the statement-level coupling triggers
on `rsvp` / `team_slots` / `games` / `scores` keep stat lines in lockstep with
the roster — RSVP in → lines appear, RSVP out → lines pruned (bets refunded by
the market-delete trigger). Client calls (`betMarkets.syncLanetalkPropsForWeek`)
sit alongside the `syncOUForWeek` belt-and-braces call sites. Idempotent.

- **Eligibility** = the O/U sync's ladder (participation `scores` rows when
  games exist, else team slots, else RSVP `'in'` × target games) **∩ players
  with ≥1 official import**. No league-average or default fallback — a player
  with no imported official games has no stat lines (`lanetalk_seed_lines`
  returns zero rows; their leftovers prune on the next sync).
- **Seeding** (`lanetalk_seed_lines(player_id)`): the player's own
  official-import history, frame-weighted (one game is sufficient). Syncs
  **reprice unbet open/closed markets** whose seeded line drifted after new
  imports; a line never moves under a placed bet.
- **Scope matrix (standardized 2026-07-01):** strikes, spares, and clean
  frames are all generated at **both** scopes — per game (`scope='game'`,
  `game_number` set) and night (`scope='night'`, `game_number` null).
- **Rounding:** per-game counts → `floor(avg)+0.5` clamped [0.5, 9.5]; night
  counts → `floor(avg-per-game × scheduled-games)+0.5` clamped
  [0.5, 10·games−0.5] (all frame counts max 10/game — the money definitions
  count FRAMES, so a triple-strike 10th is one frame). No pushes anywhere.
  Legacy `first_ball_avg` lines are frozen (the reprice CASE yields NULL).

## Board & bet surfaces

Third consumer of the line-board stack (see
[betting-line-board.md](betting-line-board.md)): per-game props share each
game's **Player Overs** menu with the score O/U lines, consolidated into one
row per player (a unified button set: `142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES`); night props form a
**Night Props** section under a
**WEEKLY** group that leads the board, above the game groups (shared with the
week-level specials' header). `LineView.statKey` carries the stat, and the pick button is the full condition
itself (`4.5+ STRIKES`, via `selectionButtonLabel` — all board bets are overs
by definition; score lines read `142.5+ PINS`); **unders are UI-hidden**
(same social policy + trivial revert as score O/U). Game start/stop toggles
(`setPropStatusByWeekGame` + `setTeamPropStatusByWeekGame`) close a game's
props with it; **closing game 1 also closes the night markets (player AND
team)**; `reopenOUForWeek` reopens props + team props too. The Confirm surface
(`listUnsettledLanetalkProps` / `listSettledLanetalkPropWeeks`) matches both
player props and lanetalk-clock team props via a PostgREST `or()`. Placed-bet
surfaces render `betLineSuffix` ("OVER 4.5 STRIKES"); `SettleBetModal` keeps a
manual enter-a-value escape hatch for props (decimals allowed) — systematic
settlement is the Confirm RPC.
