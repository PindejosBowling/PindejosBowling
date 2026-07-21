# Combo Lines — player-composed member-set aggregate markets

The replacement for team props (and the reason moneyline generation retired with
them). A **combo line** is an over/under on the **summed stat of an explicit set
of players** — "Alice + Bob + Carl combined strikes (night): Over 12.5" — with
**zero FK to `teams`/`games`**, so team regeneration can never delete-refund a
combo bet. Shipped 2026-07-21 (migrations `20260721150000_combo_lines_core`,
`20260721151000_combo_lines_settlement`,
`20260721170000_retire_team_prop_moneyline_generation`).

## The market shape

A combo is a `bet_markets` row, `market_type='combo'`, with ordinary
over/under `bet_selections` (shared line, even-money 2.000). No new tables.

- `subject_player_id` NULL, `subject_game_id` NULL (deliberate — nothing team-
  or game-anchored can cascade it away). `game_number` set for game scope only.
- `created_by_player_id` = the composer. Title is server-generated
  (`'Alice + Bob Strikes — Night'` / `'… — Game 2'`).
- `params`:
  ```json
  { "family": "combo",
    "stat": "strikes|spares|clean_frames|total_pins",
    "scope": "game|night",
    "clock": "lanetalk|archive",            // total_pins → archive, frame stats → lanetalk
    "member_ids":   ["<uuid text>", …],      // sorted ascending, ≥2 distinct, TEXT strings
    "member_names": ["Alice", …],            // aligned display snapshot — the app never fetches N names
    "combo_key": "<stat>|<scope>|<game_number|n>|<uuid,uuid,…>" }
  ```
  `member_ids` are **jsonb strings** on purpose: the `?` containment operator
  (anti-tank, auto-void) only matches string elements.

## Dedup — one live market per identical combo

`combo_key` is the canonical identity. A partial unique index
(`bet_markets_combo_dedup` on `(week_id, params->>'combo_key') WHERE
market_type='combo' AND status IN ('open','closed')`) plus a
`pg_advisory_xact_lock` in the RPC guarantee one live market per identical
(member set × stat × scope × game × week). A second identical compose **joins**
the existing market (`deduped: true`, same frozen line). Settled/void combos
never block a recompose.

## Compose = bet (the single write path)

`compose_combo_bet(p_week_id, p_member_ids, p_stat, p_scope, p_game_number,
p_stake, p_extra_selection_ids DEFAULT NULL) → {market_id, bet_id, line,
deduped}` — SECURITY DEFINER, caller from `current_player_id()`, granted to
`authenticated`.

One transaction: validate → dedup-or-create market + selections → place the
composer's bet by **calling `place_house_bet`** (which re-checks open/stake/
balance/locked-week per leg and writes bet + legs + the `bet_stake` double
entry). A combo market can therefore **never exist without a bet on it**, and a
failed placement rolls the market back. Validations:

- week exists and is not archived (locked weeks take no composes);
- stat ∈ the four; scope game ⇒ `game_number` on the week's schedule (defaults
  `{1,2}` pre-teams, the O/U sync convention), night ⇒ no game number;
- ≥2 **distinct** members, every member RSVP'd `'in'` for the week, all real
  players (the name-snapshot join proves it).

**Parlays**: combo selections are ordinary selections, so board combos stage
into the bet slip like any line. Additionally `p_extra_selection_ids` lets the
composer parlay the **fresh** combo leg with already-staged selections in the
same atomic bet (`place_house_bet(over ∥ extras, stake)` — parlay odds
multiply). The RPC rejects self-referential extras (the combo's own
selections). Note: if a combo market dies, the refund trigger deletes the
**whole** parlay bet and refunds it — standard market-death semantics.

**Line seeding**: `combo_seed_line(member_ids[], stat, season, n_games)` —
`team_prop_seed_line` generalized from a roster scan to `unnest(member_ids)`.
Granted to `authenticated` (STABLE, read-only) so the composer sheet previews
the exact server number. The line freezes at market birth (a combo always
carries a bet, and no sync ever reseeds combos).

**Feed**: market birth publishes `sportsbook_combo_composed` (template
`sportsbook.combo_composed`), bet-linked via `sportsbook_bet_id` — so an
auto-void cascade removes the card with the bet. Dedup joins publish nothing
(beyond `place_house_bet`'s own big-ticket/parlay priority events — a
big-stake compose can emit both a compose card and a big-ticket card;
accepted).

## Anti-tank

`prevent_self_tank` third branch: back-`under` / lay-`over` on a combo whose
`member_ids` contains the bettor → RAISE. Backing the over on a combo
containing yourself is allowed (incentive-aligned, like self-over on a player
prop). The board's under-hidden UI policy applies to combos
(`isSelectionHiddenInUI`), and `SportsbookScreen.isSelfTank` pre-checks via
`LineView.comboMemberIds` — the trigger is authoritative.

## RSVP-out auto-void — erasure, not void (decision: final)

`sync_combo_markets_for_week(p_week_id)` is a **prune-only** sync in the
`resync_week_markets` fan-out: DELETE open/closed combos having any member
without an `'in'` rsvp row. The predicate reads **only `rsvp`** — team_slots/
games/scores churn provably cannot kill a combo (the headline requirement).
The `refund_bets_before_market_delete` trigger makes every bet whole (ledger
pair deleted, bets deleted — parlays refund whole, feed cards cascade away).

**Void is final**: a member flipping back to `'in'` does NOT resurrect the
market — someone recomposes (30 seconds in the composer). The fan-out's
archived-week guard means no pruning after week lock; from there the
settle-time guard takes over.

## Settlement — settle_week step (c‴), both clocks

Loop over the week's open/closed combos, per-member **complete-data guard**
first (an absent member never silently settles the sum low):

- `total_pins` (archive clock): every member has a non-fill `scores` row for
  the game (game scope) / ≥1 non-fill score (night). Value = Σ member scores.
- frame stats (lanetalk clock): game scope — every member has an official
  import for (week, member, game); night — per member `official_n ≥ scored_n
  AND official_n > 0` (the c″ player-night predicate per member). Value =
  Σ member `strikes` / `spares` / `strikes+spares` over official imports
  (`frames > 0` on night).

Complete → `settle_market_internal` (type gate includes `'combo'`; the admin
`settle_market` escape hatch therefore also grades combos). Missing →
`p_void_missing` ? DELETE (refund rail) : left pending. Combos of **both**
clocks are exempt from the settle backstop (all 3 sites in `settle_week`, plus
the legacy `settle_betting_for_week`) — an archive-clock combo missing a member
score never self-heals, but `preview_settle_week`'s combo branch flags it
("a combo member has no recorded score" / "… awaiting LaneTalk import") and
the admin voidMissing rail resolves it. `unsettle_week`/`unarchive_week`
needed **zero changes** (combos only touch snapshot-captured columns +
bet-linked week-stamped ledger pairs).

The Confirm-LaneTalk badge queries (`listUnsettledLanetalkProps` /
`listSettledLanetalkPropWeeks`) match `and(market_type.eq.combo,
params->>clock.eq.lanetalk)` alongside props and legacy team props.

## App layer

- `db/economy.ts`: `betMarkets.listActiveComboByWeek`, `betMarkets.previewComboLine`
  (rpc `combo_seed_line`), `bets.composeCombo` (rpc `compose_combo_bet`),
  `betMarkets.setComboStatusByWeekGame` (game-start toggle; night combos ride
  game 1), `'combo'` in `reopenOUForWeek`.
- `usePinsinoData`: `LineView.comboMemberIds/comboMemberNames`;
  `normalizeMarket` labels a combo by its joined `member_names` (no N-name
  fetch — that's why compose snapshots names); `marketGroup` routes null-game
  combos to WEEKLY; `lineCategory` gives combos their own "Combos" collapsible
  (game groups + WEEKLY); `betLineSuffix`/`selectionButtonLabel` render
  "OVER 12.5 STRIKES"; `rsvpInPlayers` (RSVP'd-in id+name) feeds the picker.
- `ComboComposerSheet` (components/betting): stat + scope pickers, member
  multi-select from `rsvpInPlayers` (min 2, self allowed), stake, debounced
  live line preview, "Parlay with your slip (N legs)" toggle (passes staged
  selection ids as extras; the screen clears the slip on success).
- `SportsbookScreen`: one global "+ Build a Combo" CTA atop the Place view
  (hidden read-only); combos flow through the `LineView → LineRow` seam with
  zero row-component changes; BetDetail copy-bet works unchanged (`getByIds`
  is market-type-agnostic).
- Feed renderer `sportsbook.combo_composed` in `activityFeedTemplates.ts`;
  explainer bullet + `TERMS.combo` in `data/pinsinoExplainers.ts`.

## The retirement (what died, what survived)

Migration `20260721170000_retire_team_prop_moneyline_generation`:

- `resync_week_markets` drops the team_prop PERFORM and the moneyline branch
  body (the `p_moneyline` parameter survives, inert — four trigger fns pass it).
- `sync_team_prop_markets_for_week` **dropped** (server-trigger-only).
- `sync_moneyline_markets_for_week` is a **no-op stub**, not dropped — deployed
  app builds still call it (team gen / add game / playoffs). Drop it in a later
  cleanup once every client is past this release.
- One-time DELETE of **betless** open/closed team_prop + moneyline markets on
  unarchived weeks (refund trigger no-ops on betless; closes the night-team_prop
  orphan window). Bet-carrying markets settle out normally.
- **Kept for history + cutover**: the `market_type` CHECK values, settle_week
  branches (c)/(c′)/(c″), `settle_moneyline_market[_internal]`,
  `team_prop_seed_line`, the self-tank team branch, the app's moneyline/team
  status toggles, and `normalizeMarket`'s team labeling (settled history,
  BetDetail, ledger still render old bets). The probes that used to rely on
  trigger-generated team markets (`probe-bets-bounty`, `probe-archive-roundtrip`,
  `probe-settle-lifecycle`) now synthesize them by hand — the "historical
  market" case the kept branches exist for.
- **Head-to-head gap accepted**: combos can't express "team A beats team B";
  PvP contracts cover me-vs-you. A future combo-vs-combo mode is the natural
  extension if the league misses it.
- Specials: the builder no longer offers Team Stat / Win legs (they'd never
  resolve). **Owner note: any existing permanent Specials with team legs
  silently auto-hide from the board** — edit or disable them.

## Verification

`supabase/verify/probe-combo-lines.sql` (in `run-all-probes.sh`): compose
invariants, shuffled-dedup, 8 validation negatives, anti-tank (self blocked /
non-member allowed), compose-into-parlay (2 legs, ×4 payout), RSVP-out erasure
(market+bets+ledger+feed gone, balances restored, no resurrection), both-clock
settlement values (strikes Σ=5, total_pins Σ=270), pending-exempt →
void_missing delete-refund, idempotent re-settle. Run the suite before AND
after any migration touching these RPCs.
