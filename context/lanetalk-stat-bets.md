# LaneTalk Stat Bets — frame-stat props on a second settlement clock

Bet lines on LaneTalk frame stats: **strikes O/U + spares O/U per game**, and
**night-level clean % + first-ball avg O/U** — generated from imported
**official** LaneTalk games and settled when the admin taps **"Confirm LaneTalk
Data"** on the import screen. Archive runs night-of; LaneTalk data often lands
the next day, so these bets ride a **separate settlement clock** from
`archive_week`.

**Zero schema additions.** Every persisted record is an ordinary row in the
existing betting architecture:

- A stat line = `bet_markets` with **`market_type = 'prop'`** (the
  PIN_ECONOMY_SCHEMA §7 escape hatch) and
  `params = { source: 'lanetalk', stat: 'strikes'|'spares'|'clean_pct'|'first_ball_avg', scope: 'game'|'night' }`.
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
| `clean_pct` | (strikes + spares) / frames × 100 |
| `first_ball_avg` | Σ first-ball pins (`throws->0->>'pins'`) / frames |

The client mirror lives in
[app/src/data/lanetalk/stats.ts](../app/src/data/lanetalk/stats.ts)
(`gameStats` / `nightStats`) and is **demoted to non-money duty**: line seeding
and display only. If the two ever drift, **the SQL wins** — a client bug
mis-prices a line (visible before settlement), never mis-pays a bet. Night
aggregates are **frame-level totals**, not per-game means.

## The two-clock settlement model

1. **Archive (night-of).** `settle_betting_for_week` settles score O/U +
   moneylines as always, but its no-pending-bets **backstop now exempts any
   pending bet with ≥1 leg on an unsettled `prop` market** — from the RAISE
   count, the abort listing, and the force-void loop. So archive succeeds
   without force while stat bets stay pending. Mixed parlays still die at
   archive when a score leg loses (`finalize_bets_for_market` skips bets with
   unresolved legs; a lost leg fails the bet regardless).
2. **Confirm (next day, after import).**
   `settle_lanetalk_props_for_week(p_week_id, p_void_missing default false)` —
   admin-gated, one transaction, idempotent / re-runnable:
   - **Game markets**: actual from the subject's `official` import row matching
     (week, player, game_number) via `lanetalk_game_stats`.
   - **Night markets**: frame-weighted aggregate across the player's official
     imports for the week, **only when their official-game count ≥ their
     scored-game count** (never settle clean% off half a night); else missing.
   - Data present → `settle_market_internal` (relaxed to
     `IN ('over_under','prop')` — same over/under/push engine).
   - Missing → left pending when `NOT p_void_missing`; else the market is
     **DELETEd** (the `refund_bets_before_market_delete` trigger refunds bets
     whole — see void semantics below).
   - Returns `(settled, voided, left_pending)` for the confirm toast.

**App flow:** `LanetalkImportAdminScreen` shows a **Confirm LaneTalk Data**
button on any week group with unsettled props →
[`LanetalkConfirmModal`](../app/src/components/admin/LanetalkConfirmModal.tsx)
(client-side coverage preview via `stats.ts` — informational only; the RPC
recomputes server-side) → **Settle Available** or the armed
**Settle + Void Missing**.

**Void semantics = delete-refund.** Refunded bets are *removed* rather than
kept as `void` records — the existing delete-refund rail. Keeping void records
would require a settle-RPC change later.

**Archive/unarchive composition.** Prop markets are week-stamped, so the
archive preimage already snapshots their markets/selections/bets/legs;
post-archive settlement only UPDATEs captured columns and INSERTs bet-linked,
week-stamped `pin_ledger` rows — exactly what `unarchive_week` reverses.
Confirm-before-archive composes too.

## Line generation (admin client-side writes, no sync function)

**"Generate Stat Lines"** on `AdminSportsbookScreen` →
[`useLanetalkLineAdmin`](../app/src/hooks/useLanetalkLineAdmin.ts). Idempotent
+ re-runnable: existing markets (any status) are skipped; open/closed markets
whose subject/game fell off the ladder are DELETEd (bets refunded whole).

- **Eligibility** = the O/U sync's ladder (participation `scores` rows when
  games exist, else team slots, else RSVP `'in'` × games 1–2) **∩ players with
  ≥1 official import**. No league-average or default fallback — a player with
  no imported official games has no stat lines (leftovers prune on re-run).
- **Seeding**: the player's own official-import history, frame-weighted (one
  game is sufficient). Re-runs **reprice unbet markets** whose seeded line
  drifted after new imports; a line never moves under a placed bet.
- **Rounding:** counts → `floor(avg)+0.5` clamped [0.5, 9.5] (no pushes);
  clean% → `floor(avg/5)*5+2.5` (20-frame night results are multiples of 5 →
  no pushes); first-ball avg → `round(avg,1)` (a rare push refunds normally).
- **Caveat — no server-side roster coupling.** The `resync_week_markets`
  triggers only sync O/U + moneyline. Roster changes after generation need an
  admin re-tap (or the Confirm flow voids strays).

## Board & bet surfaces

Third consumer of the line-board stack (see
[betting-line-board.md](betting-line-board.md)): per-game props share each
game's **Player Overs** menu with the score O/U lines; night props form a
**Night Props** section under a
**WEEKLY** group that leads the board, above the game groups (shared with the
week-level specials' header). `LineView.statKey` carries the stat, and the pick button is the full condition
itself (`4.5+ STRIKES`, via `selectionButtonLabel` — all board bets are overs
by definition; score lines read `142.5+ PINS`); **unders are UI-hidden**
(same social policy + trivial revert as score O/U). Game start/stop toggles
(`setPropStatusByWeekGame`) close a game's props with it; **closing game 1 also
closes the night markets**; `reopenOUForWeek` reopens props too. Placed-bet
surfaces render `betLineSuffix` ("OVER 4.5 STRIKES"); `SettleBetModal` keeps a
manual enter-a-value escape hatch for props (decimals allowed) — systematic
settlement is the Confirm RPC.
