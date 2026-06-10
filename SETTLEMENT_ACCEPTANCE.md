# Settlement Acceptance Testing — Archive / Unarchive Vectors

Working checklist for validating the consolidated weekly Pinsino settlement through the UI.
The flow under test: take Pinsino actions in the current week → **Archive & Advance**
(MatchupsScreen) → verify every settlement outcome below → **unarchive** (More → Archives)
→ repeat.

Source of truth: `archive_week()` → `settle_betting_for_week()` and `unarchive_week()`
(see `supabase/schema.sql`; authored in migration `20260611000000_archive_unarchive_week.sql`).
Everything here was confirmed against the RPC bodies — if settlement behavior changes,
update this list.

## Settlement order (what one archive run does)

1. Snapshot pre-image (`week_archive_snapshot`)
2. Lock week (`is_archived = true`, `bowled_at` stamped)
3. **Score credits** (pincome mint)
4. **Over/Under markets** settle
5. **Moneyline markets** settle
6. **Loans**: garnishment, then interest, per active loan
7. **PvP**: cancel open offers, auto-settle locked contracts
8. **House weekly P&L** feed event
9. Create week N+1

All steps run in one atomic transaction and are idempotency-guarded (re-running cannot
double-mint, double-pay, or double-garnish).

---

## A. Archive-derived settlement vectors

### A1. Score credit (pincome mint) — the economy's only faucet

- [x] **V1** Real player with scores in week N → after archive, one `score_credit` row per
  game (`Week N Game G: X pins`). Observe: PlayerPinsinoScreen → Activity ("PINCOME" rows),
  balance ↑, PinsinoScreen leaderboard reorders.
  *Accepted 2026-06-10 (S2W6): two credits (150/175), exact descriptions, balance +325;
  ledger + DB verified; hard-unarchive reversed both rows exactly.*
- [ ] **V2** Fill-in player (`is_fill = true`) and player with no score → **no** credit rows.
  *No-score half accepted 2026-06-10: unscored in-player got zero ledger rows, their O/U
  markets went `closed` ungraded, and (by the `score IS NOT NULL` stats convention) no
  standings W/L. Fill-in half deferred — fold into the I9 cycle (unscored-fills roster).*

### A2. Over/Under bet settlement (`bet_payout` / `bet_refund`)

- [x] **V3** O/U **win** → bet status `won`, "WINNING PAYOUT" ledger row (+potential_payout),
  house −payout. Observe: SportsbookScreen → Settled Bets (WIN badge), PlayerPinsinoScreen
  ledger, PinsinoAccountingScreen.
  *Accepted 2026-06-10 (S2W6): 100 @ 2.0 → `won`, payout pair +200/−200 exactly
  potential_payout. Found+fixed: payout/refund rows lacked `week_id` and vanished from the
  week-grouped Activity view (`…191008_week_stamp_bet_settlement_ledger` + backfill).*
- [x] **V4** O/U **loss** → status `lost`, **no** new ledger row (stake was kept at placement),
  balance unchanged.
  *Accepted 2026-06-10 (S2W6): 150 → `lost`, zero settlement ledger rows, verified across
  archive → unarchive → re-archive.*
- [x] **V5** O/U **push** (score exactly on the line) → `bet_refund` ("PUSH · REFUND"),
  stake returned. *N/A by design (2026-06-10): lines are always set on the .5
  (sync formula floor(avg)+0.5 and league convention), so an exact-on-the-line O/U
  push is unreachable. Push mechanics get covered by the moneyline tie (V9); note
  the same reasoning makes V7(c)'s push-leg unreachable for O/U-only parlays.*
- [ ] **V6** O/U on a subject with **no score** → market goes `closed` (= no longer taking
  action, but ungraded — distinct from `settled`), bet stays **pending**, zero ledger rows.
  Not a dead end: the settlement loop retries any market `<> 'settled'`, so hard-unarchive →
  enter the missing score → re-archive grades it.
- [ ] **V7** **Parlay**: (a) all legs win → payout at combined odds; (b) one leg loses →
  whole bet lost; (c) one leg pushes → leg drops out, payout at reduced combined odds.

### A3. Moneyline settlement

- [ ] **V8** Moneyline **win/loss** → higher combined team total wins; payout/refund rows
  as in A2.
- [ ] **V9** Moneyline **tie** → push, stakes refunded.
- [ ] **V10** A team missing scores → market `closed`, bets stay pending.

### A4. Loan Shark (per active loan, in order: garnish → interest)

- [ ] **V11** **Garnishment** = min(week pincome × rate, outstanding): pin_ledger
  `loan_weekly_garnishment` (player −, house +) + loan_ledger `weekly_garnishment`.
  Observe: LoanSharkScreen → Payment History ("GARNISHED"), outstanding ↓,
  PlayerPinsinoScreen NET WORTH.
- [ ] **V12** **Interest** accrual on remaining balance: loan_ledger `weekly_interest` only
  ("INTEREST") — verify **no** pin_ledger row / no balance change, only debt ↑.
- [ ] **V13** **Paid-off transition**: small outstanding fully cleared by garnishment →
  `loans.status = 'paid_off'`, no interest accrued that week. Observe: LoanSharkAdminScreen
  paid-off list, PinsinoScreen "OWED" pill gone.

### A5. PvP Challenge Contracts

- [ ] **V14** **Pending/countered** challenge at archive → auto-`cancelled`, offers declined,
  **no** ledger rows (nothing was escrowed). Observe: PvPScreen inbox.
- [ ] **V15** Locked **line duel, decisive** → winner takes whole pot: `pvp_payout`
  (winner +pot, house −pot), status `settled`, winner badge; **feed event**
  `pvp_challenge_settled` (won) in Market Moves.
- [ ] **V16** Locked duel **tie** → push: both stakes refunded (`pvp_refund`), status
  `pushed`, feed event (push).
- [ ] **V17** Locked duel where a participant has **no score** → **void**: `pvp_refund`
  both, status `voided`.
- [ ] **V18** **Head-to-head with handicap** → winner determined on handicap-adjusted scores.
- [ ] **V19** **Prop duel** → settles off the underlying market's result (verify ordering:
  markets settle in steps 4–5 before PvP in step 7; if the prop market closed unsettled per
  V6, the prop duel should void).

### A6. Activity Feed (archive-published events only)

- [ ] **V20** `sportsbook_weekly_house_result` appears once in Market Moves with house net;
  test both signs (house up / players beat house). Note: this and the PvP-settled events are
  the **only** feed events published by archive settlement — loan garnishment/interest
  produce **no** feed cards.

### A7. Week advance

- [x] **V21** Week N+1 created: MatchupsScreen resets for team gen, RSVP opens,
  SportsbookScreen Active Bets empty, week number increments.
  *Accepted 2026-06-10 (S2W6→W7): all four surfaces confirmed — header Week 7 (live via
  the realtime week clock), fresh team gen, blank RSVPs, empty Active Bets. Week N+1
  creation/destruction also exercised repeatedly across the U1–U3 cycles.*

---

## B. Unarchive (reversal) vectors — More → Archives (ArchivesScreen)

*2026-06-10 design change (mid-acceptance): the soft/hard split collapsed into a single
`unarchive_week(week_id, force)` = the old hard mode (migration
`…193032_single_mode_unarchive`). Unarchive always reopens the week — it is simply in
play again, and MatchupsScreen's Archive & Advance is the re-archive path. The soft
state (settlement reversed, week still locked, no current week anywhere) no longer
exists; it had no UI re-archive path and every screen had to special-case it.*

- [x] **U1** **Unarchive** after a full A1–A7 run: every settlement-created row deleted
  (score credits, payouts/refunds, garnishments, interest, pvp rows, feed events incl.
  house P&L), bets back to pending, markets restored to pre-archive status, PvP back to
  `locked`, paid-off loans back to `active`, week N+1 (+RSVPs) deleted, balances exactly
  pre-archive (stakes still debited), **week back in play**: teams/games/scores intact
  and editable, header shows week N, archive bar available.
  *Settlement-reversal half verified 2026-06-10 (S2W6, pre-collapse soft mode): all
  deletions/restores/balances exact, incl. the week-stamped payout rows. Reopen half
  verified same day under the single-mode flow (week visible/editable on MatchupsScreen,
  re-archived from its archive bar).*
- [x] **U2** **Re-archive with untouched scores** (Archive & Advance) → identical
  settlement re-derives; verify idempotency guards (no double pincome mint, single house
  P&L event, no duplicate garnishment).
  *Accepted 2026-06-10 (S2W6): unarchive → re-archive produced a byte-identical economy —
  9 ledger rows / single payout pair / credits once each / one P&L event (+50) / same bet
  statuses and balances. (Loan-garnishment idempotency still to observe in the A4 cycle.)*
- [x] **U3** **Re-archive with changed score**: after unarchive, change a score on
  MatchupsScreen, re-archive, confirm a bet flips outcome (e.g., V3 win → loss) and
  pincome reflects the new score.
  *Accepted 2026-06-10 (S2W6): G1 200→10 flipped the V3 bet won→lost; payout pair cleanly
  gone (0 rows), credit re-minted once at 10, house P&L re-derived 50→250, balances exact.
  Also caught+fixed en route: `reversed_mode` check constraint rejected the new
  single-mode value (`…194424_reversed_mode_allow_unarchive`) — the failed unarchive
  rolled back whole, incidentally demonstrating reversal atomicity.*
- [ ] **U4** **LIFO guard**: with 2+ archived weeks, Unarchive button disabled for all but
  the most recent.
- [ ] **U5** **Downstream-activity guard**: after archiving N, add activity in N+1 (a score
  / bet / RSVP), attempt unarchive → server warning surfaces in modal, button arms to
  "Force Unarchive"; forcing deletes N+1 and refunds its bets (via the
  `refund_bets_before_market_delete` trigger) — verify those refunds in the affected
  player's ledger.
- [ ] **U6** ⚠️ **Post-archive manual activity in week N** (caveat to characterize): settle
  a bounty or take a manual admin action that writes week-N pin_ledger rows *after*
  archiving, then unarchive. Snapshot-diff deletion will wipe those ledger rows, but
  non-snapshotted tables (e.g., `bounty_posts` status) won't revert — document observed
  behavior; this is the known sharp edge of the snapshot model.

---

## C. Market–roster integrity vectors (no hanging `pending` at archive)

**Acceptance criterion:** it must not be possible for a week to be archived while any
sportsbook bet remains `pending`. A pending-unsettleable bet arises whenever a market
survives a destructive action on the teams/players it derives from. Couplings that
exist today, and the holes:

All four integrity layers are now implemented (migration
`20260611120000_settlement_integrity.sql`): slot-coupled O/U line ownership +
schedule-authoritative game pruning in the sync RPC, roster→market coupling
triggers on `rsvp`/`team_slots`/`games`, and a no-pending-bets backstop in
`settle_betting_for_week(week_id, force)` threaded through
`archive_week(week_id, force)`. The vectors below verify each layer.

**Couplings (regression-test these):**

- [ ] **I1** Moneyline ↔ teams: regenerate teams (or Reset matchups) with a pending
  moneyline bet → `teams.removeByWeek` cascades teams → games →
  `bet_markets.subject_game_id ON DELETE CASCADE` → the
  `refund_bets_before_market_delete` trigger deletes the bet **and** its ledger pair
  (whole parlay refunds). Verify: bet gone, stake back, no orphan ledger rows.
- [ ] **I2** RSVP out via RsvpScreen (before teams exist): flip an in-player with a
  pending O/U bet to "out", save → their lines are refunded + deleted (now enforced
  by the `rsvp` triggers even if the client's sync call fails).
- [ ] **I3** Remove Game N (MatchupsScreen): pending O/U + moneyline bets on game N →
  refunded via `removeOUForGame` + games-delete cascade (+ games trigger). Verify refunds.
- [ ] **I4** Prop duel whose underlying market gets deleted (e.g., via I2) →
  `prop_market_id` is SET NULL → duel **voids with refund at archive** (resolves;
  does not hang).

**Closed holes (each previously stranded a pending bet at archive — verify the fix):**

- [ ] **I5** Game-count shrink: week has game-3 O/U lines with a pending bet, then
  teams regenerate into a 2-game schedule → at the schedule (`games`) insert, the
  sync prunes the game-3 lines and refunds the bet. Verify: refund at regen time,
  no game-3 lines reappear.
- [ ] **I6** In-RSVP but undrafted: more "in" players than team slots → once teams
  exist the roster owns the lines, so the undrafted player's lines are pruned (bets
  refunded) at team-gen. Verify: refund + no lines for undrafted players.
- [ ] **I7** Week-editor roster swap: swap/remove a player with active O/U lines in
  MatchupsScreen Edit mode → the `team_slots` triggers prune their lines (refund)
  and create lines for the player swapped in. Verify both directions.
- [ ] **I8** Trigger coupling: make an RSVP/roster change by any path (the DB
  triggers fire regardless of client sync calls). Verify markets track the change.
- [ ] **I10** Clear Matchups (Reset): teams wiped → moneylines cascade-refund; O/U
  ownership reverts to RSVP and the explicit sync recreates lines for all in-players
  (including any pruned while undrafted). *Also verify the 2026-06-10 finding/fix:
  lines closed by Start Game must come back `open` after Clear Matchups **and** after
  team regen (`reopenOUForWeek` — surviving lines used to stay stranded `closed`,
  unbettable with no reopen toggle visible).*

**Backstop (the fail-safe — verify both branches):**

- [ ] **I11** Unforced: contrive a pending bet on an unsettleable market (e.g., I9
  below) and Archive & Advance → the RPC raises naming the market(s); the whole
  archive rolls back (week not archived, nothing settled); AdminArchiveModal shows
  the warning and arms **Force Archive**.
- [ ] **I12** Forced: retry with Force Archive → those bets become `void`, stakes
  refunded (`bet_refund` pair, "Voided at archive — market never settled"), archive
  completes, **zero pending bets remain**. Verify ledger + Settled Bets show VOID.
- [ ] **I13** Reversibility: unarchive after a forced archive → the voided bets
  return to `pending` (pre-images restored) and the void refunds are deleted.
- [ ] **I9** Moneyline on a team with zero recorded scores (all unscored fills) →
  market closes; the bet is caught by the backstop (I11/I12) instead of hanging.

**Per-game lineup edits (the participation model — migration
`20260611130000_per_game_participation.sql`):** a `(team_slot, game)` `scores` row
is the lineup marker (null score = present, not yet scored); rows are seeded at
matchup creation and O/U lines are keyed to them, so per-game edits act on lines
**at edit time**, not at archive.

- [ ] **I14** Moneylines ride through lineup changes (documented semantic): a
  per-game add/remove never touches the `games` row, so the moneyline market and
  its bets are untouched; settlement grades the team total from whoever actually
  has scores on that team for that game. A side with zero participants totals 0
  and loses; a game with zero scores overall closes and its bets fall to the
  backstop (I11/I12).
- [ ] **I15** Seeding: generate teams → every slot × scheduled game has a
  null-score `scores` row; O/U lines exist exactly for non-fill participants ×
  scheduled games.
- [ ] **I16** Per-game REMOVE (week editor): take a player out of game 2 only
  (slot kept via game 1) → their game-2 line is pruned and its bets refunded at
  save; game-1 line untouched.
- [ ] **I17** Per-game ADD (week editor): add a player to game 2 only → exactly
  one line (game 2) is created — no lines for games they don't bowl.
- [ ] **I18** Cross-team night (Team 1 game 1, Team 2 game 2 — two slots): both
  lines exist and settle from the right scores; O/U lines are team-agnostic.
- [ ] **I19** Score-pad clear: typing then clearing a score inline upserts a null
  score and must NOT prune the line or refund bets (the row — the lineup marker —
  survives). Entering a score for an editor-removed player re-adds them to the
  lineup and recreates their line.
- [ ] **I20** Backstop scope check: after I15–I19, the only way to reach the
  backstop (I11) is a *participant whose score was never entered* — every known
  lineup edit resolves at edit time.

**Note on V20:** the weekly House P&L event previously summed only week-stamped
rows (`bet_payout`/`bet_refund` were not week-stamped → stakes only, always ≥ 0);
it now follows `bet_id` through the week's markets, so verify it reflects true
net (negative when players beat the House). *2026-06-10 (V3 finding): payout/refund
rows are now ALSO week-stamped (`…191008_week_stamp_bet_settlement_ledger`, with
backfill) — they previously vanished from the week-grouped player Activity view
entirely. Verify payouts/refunds appear under the correct week per-player.*

---

## D. Explicitly NOT archive-derived (out of scope, but useful controls)

| Path | When it settles | Why listed |
|---|---|---|
| `bet_stake` / `pvp_stake` debits | At placement/acceptance (`place_house_bet`, `accept_pvp_challenge`) | Pre-archive baseline balances must include these |
| **Bounties** (close/settle/payout) | Manual admin only (`close_bounty`, `settle_bounty` via BountyAdminScreen) — never touched by `settle_betting_for_week` | Interacts with unarchive only via U6 |
| Loan issue/repay + their feed events | At action time (`take_loan`, `repay_loan`) | Their feed cards should *survive* unarchive (pre-existing snapshot IDs) — spot-check during U1 |
| Season-close loan settlement | `settle_loans_for_season_close()` at season end | Separate lifecycle |
| Admin rollback helpers (cancel bet, void PvP, cancel loan, suppress feed event) | Manual, any time | Per-action undo tools used alongside unarchive |

---

## Suggested test-data recipe (one cycle covers V1–V21)

Before archiving, set up: 1 active loan + 1 O/U bet that wins + 1 O/U bet landing exactly
on the line (push) + 1 parlay + 1 moneyline bet + 1 decisive locked PvP duel + 1 tied duel
+ 1 pending (unaccepted) challenge + 1 rostered player left without a score. Archive once,
walk sections A1–A7, then run B in order: U1 → U2 → U3 (U4/U5/U6 need their own setups).
