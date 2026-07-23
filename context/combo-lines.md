# Combo Lines — player-composed member-set aggregate markets

> **OddsEngine + value-first lines (2026-07-22):** combos are fair-priced and
> **value-first** — a combo stat pill's value opens the shared `LineEntrySheet`
> editor, priced live by `combo_price_line` (posted rungs verbatim
> when the combo_key already has an open market; ANY other half-point line
> fresh). `compose_combo_bet` specs take optional `"line"` (NULL = seed) and
> `"quoted_odds"` — a quoted unposted line MINTS on demand (fresh and dedup
> paths); new `p_extra_picks` parlays line-shaped regular legs on the same
> bet. `combo_seed_line` is unchanged as the anchor; ⚰️ `combo_preview_ladder`
> + `LineValueSheet` + `useComboLinePreview` retired (RPC kept one release).
> See [odds-engine.md](odds-engine.md). **2026-07-23:** a combo parlayed with
> a pick on one of its OWN members (overlapping scope) is now repriced
> jointly — correlated-parlay pricing clusters combo `member_ids` with pick
> subjects (odds-engine.md § Correlated parlays).

The replacement for team props (and the reason moneyline generation retired with
them). A **combo line** is an over/under on the **summed stat of an explicit set
of players** — "Alice + Bob + Carl combined strikes (night): Over 12.5" — with
**zero FK to `teams`/`games`**, so team regeneration can never delete-refund a
combo bet. Shipped 2026-07-21 (migrations `20260721150000_combo_lines_core`,
`20260721151000_combo_lines_settlement`,
`20260721170000_retire_team_prop_moneyline_generation`).

> **One stat per combo — deliberate.** Mixed-stat legs ("A's total pins + B's
> spares" summed against one line) were shipped and **reverted the same day**
> (2026-07-22, migrations `…000344_combo_mixed_stat_legs` +
> `…002545_revert_combo_mixed_stat_legs` — a no-op pair in history; zero
> markets composed between them): the owner judged summing different stat
> kinds into one value awkward. Don't re-propose without new grilling.

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

## Compose = bet (the single write path — SLIP-shaped)

`compose_combo_bet(p_week_id, p_combos jsonb, p_stake,
p_extra_selection_ids DEFAULT NULL, p_insurance_item_id?, p_crutch_item_id?,
p_boost_item_id?) → {bet_id, combos: [{market_id, line, deduped}, …]}` —
SECURITY DEFINER, caller from `current_player_id()`, granted to
`authenticated`. `p_combos` = an **array** of specs
`{member_ids: [uuid text…], stat, scope, game_number?}` (≥1).

The RPC is the bet slip's combo placement path: composing in the app only
**stages a spec** in the slip; nothing exists in the DB until placement. One
transaction: per spec validate → dedup-or-create market + selections; then
place ONE bet across every combo's over **plus** any `p_extra_selection_ids`
(regular staged picks) by **calling `place_house_bet`** (which re-checks
open/stake/balance/locked-week per leg, applies attached items, and writes bet
+ legs + the `bet_stake` double entry). A combo market can therefore **never
exist without a bet on it**, and a failed placement rolls every new market
back. Per-spec validations:

- week exists and is not archived (locked weeks take no composes);
- stat ∈ the four; scope game ⇒ `game_number` on the week's schedule (defaults
  `{1,2}` pre-teams, the O/U sync convention), night ⇒ no game number;
- ≥2 **distinct** members, every member RSVP'd `'in'` for the week, all real
  players (the name-snapshot join proves it);
- the same combo may not appear twice on one ticket (specs dedup to one
  market; `place_house_bet` needs distinct markets per leg);
- extras may not be any of the ticket's own combo selections.

**Parlays**: this is the whole point of the slip shape — one ticket can parlay
a fresh combo with single lines AND with **other fresh combos** (parlay odds =
2^legs). Board combos (already-placed, public) also stage into the slip as
ordinary selections. Concurrency: one advisory xact lock per week serializes
composes (deadlock-free for multi-spec tickets); the partial unique index is
the backstop. Note: if any combo market dies (RSVP-out), the refund trigger
deletes the **whole** parlay bet and refunds it — standard market-death
semantics.

**Line seeding**: `combo_seed_line(member_ids[], stat, season, n_games)` —
`team_prop_seed_line` generalized from a roster scan to `unnest(member_ids)`.
**One half point total** (since `…234333_fix_combo_seed_line_single_half_point`,
2026-07-21; projection-anchored since `…190000_seed_lines_from_projection`,
2026-07-23): engine on, the line = Σ per-member `floor(projected mean ×
n_games)` + 0.5 (a no-history member contributes the prior-informed mean, not
0); engine off, the legacy Σ per-member `floor(avg × n_games)` + 0.5 — each
member contributes their solo whole-number base (their displayed line minus
its half point), and the combo adds a single half point, so the combined line
always equals the sum of the solo lines the board shows, minus
the extra halves. (The original math floored the SUMMED raw averages —
`floor(Σavg × n) + 0.5` — letting per-member fractions accumulate and
overstate the line; owner-reported and fixed.) Granted to `authenticated`
(STABLE, read-only) so combo mode's stat pills preview the server number
(display-only; the RPC re-seeds at placement). The line freezes at market
birth (a combo always carries a bet, and no sync ever reseeds combos) —
combos composed before the fix keep their old lines.

**Feed**: at most ONE `sportsbook_combo_composed` card per bet (the
`activity_feed_unique_bet_event` index is (bet, event_type)), published only
when the ticket minted ≥1 new market — payload = the first created combo +
`combo_count`. Bet-linked via `sportsbook_bet_id`, so an auto-void cascade
removes the card with the bet. Dedup-only tickets publish nothing (beyond
`place_house_bet`'s own big-ticket/parlay priority events).

## Anti-tank

`prevent_self_tank` third branch: back-`under` / lay-`over` on a combo whose
`member_ids` contains the bettor → RAISE. Backing the over on a combo
containing yourself is allowed (incentive-aligned, like self-over on a player
prop). The board's under-hidden UI policy applies to combos
(`isSelectionHiddenInUI`) — since the value-first board offers ONLY overs, no
board tap can bet against a subject and the screen's client pre-check is
gone; the trigger is authoritative.

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

**Admin cancel prunes orphans**: `cancel_bet`'s post-delete sweep deletes a
now-betless COMBO market outright (any status; cascade removes selections, the
refund trigger no-ops, the bet-linked feed card already cascaded with the
bet) — cancelling the only bet on a combo removes the line from the board,
preserving the compose=bet invariant. A combo still carrying other bets is
untouched; non-combo markets keep the reopen-settled behavior
(`…200000_cancel_bet_prunes_orphan_combos`).

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

- `db/economy.ts`: `betMarkets.listActiveComboByWeek` (the `previewComboLine`/`previewComboLadder` client wrappers were dropped — `useLinePreview` → `priceComboLine` is the live preview path; the RPCs remain server-side)
  (rpc `combo_seed_line`), `betMarkets.comboMemberAverages` (rpc
  `combo_member_averages` — per-player per-game avg + counted games for a stat,
  same sources as the seed math; display-only), `bets.composeCombo(weekId,
  specs[], stake, extras?, items…)` (rpc `compose_combo_bet`),
  `betMarkets.setComboStatusByWeekGame` (game-start toggle; night combos ride
  game 1), `'combo'` in `reopenOUForWeek`.
- `usePinsinoData`: `LineView.comboMemberIds/comboMemberNames`;
  `normalizeMarket` labels a combo by its joined `member_names` (no N-name
  fetch — that's why compose snapshots names); `marketGroup` routes null-game
  combos to WEEKLY (the board's Weekly scope); `betLineSuffix` renders
  "OVER 12.5 STRIKES" on placed-bet surfaces; `rsvpInPlayers`
  (RSVP'd-in id+name) is combo mode's member pool.
- **The slip is the placement surface** (`BetSlip` + `BetSlipProvider`):
  combo mode does NOT place — a combo stat pill's body tap stages a `SlipCombo`
  **spec** (canonical key = stat|scope|members, so re-staging toggles) via
  `stageCombo`. Combos render in the slip as their own ticket cards (COMBO
  header) or as tagged parlay-ticket legs, count as pick units for the
  Singles/Parlay mode, and parlay freely with regular picks and other combos
  (parlay odds = the true product of leg odds). `placeSlip` routes any
  combo-bearing entry through `bets.composeCombo` (parlay → one call with all
  specs carrying `quoted_odds` + the regular picks as line-shaped
  `extraPicks`; a singles-mode combo → one call with its lone spec), pick-only
  entries through `bets.placeAtLines`, and specials through `bets.place`.
  `ODDS_MOVED` rejections drive the odds-moved confirm + bounded retry. Item
  toggles pass through when the slip is one bet.
- `SportsbookScreen` — **group subjects, no combo mode** (2026-07-23,
  dissolving the ⚰️ COMBO chip + `comboMode` flag of earlier the same day,
  which dissolved the ⚰️ full-board pivot + `BuilderBar` of 2026-07-21, which
  itself replaced the ⚰️ `ComboComposerSheet`): the board's subject is 1..N
  players (`groupMembers: string[]`, empty = solo, never length 1). The
  heading's **＋ chip** (dim-and-toast under 2 RSVP'd) opens `AddPlayersModal`
  (a centered `CenterModal` popup; ⚰️ `AddPlayersSheet`/`BottomSheet` 2026-07-23)
  — one row per RSVP'd-in player with avg/forecast context + `+`/`✓` chips;
  toggles edit the group live (the first add seeds [current subject,
  newcomer] — a single-player bet is a combo of one). With 2+ members the
  heading becomes removable member chips (✕; shrinking to one dissolves back
  to that player's solo board), the SAME `BookProjectionCard` shows the
  group's summed rows for all four stats (one standardized `SEASON AVG vs
  FORECAST` presentation — no group-specific header/caption), and the SAME
  mounted `SubjectLinesCard` (⚰️ `ComboLineRow` folded into it — a subject
  change is a props update, no remount/flash) renders one value-first pill
  per combinable stat, the screen owning four static
  `useLinePreview({kind:'combo'})` → `betMarkets.priceComboLine` quotes;
  values anchor instantly on the client-computed seed (`clientSeedFor`, the
  server's own Σ floor(proj × games) + 0.5 formula over the prefetched
  `poolStats`) until the quote lands (per-stat `comboValues` reset on
  combo-identity change).
  Pill-body tap stages/unstages straight into the ordinary slip bar (staged
  fill, `stageCombo` key toggle); the value tap opens the shared
  `LineEntrySheet`, and an accepted edit re-stages a staged combo live. Combo
  scope follows the board's scope filter (Weekly → night, Game N → that game;
  mid-build switches re-anchor + re-quote); an in-progress scope makes the
  card inert.
  **Average context (2026-07-23, reworked again with the group-subject
  dissolution)**: `poolStats` prefetches `combo_member_averages` +
  `odds_engine_member_projections` for all four stats × the whole RSVP pool
  **with the live board** (not on any group action — the first add renders
  synchronously; member toggles are client-side re-sums) — **season-scoped
  with an explicit fallback chain** the RPC reports in its `source` column and
  the UI labels honestly: season → lifetime (→ league, total_pins only; no
  data at all → `NO STAT HISTORY`), shown per member as **four scope-scaled
  season averages** (`PINS · CLEAN · STRIKES · SPARES`; `*` + footnote = the
  fallback; ⚰️ the FORECAST value + ▲/▼, dropped for space) on the
  `AddPlayersModal` rows.
  Display-only — the seed/pricing math keeps
  its own windows (frame-stat seeds are lifetime), so the shown average can
  legitimately differ from the line the book anchors. The summed `groupRows`
  feed both the group projection card and the combo `LineEntrySheet`
  `contextNote` ("Group Average X · Forecast Y") — one data path, making
  visible WHY adding members compresses the fair odds (the seed =
  Σ floor(projected mean×games) + 0.5 sits at the summed mean while spread
  grows only √N).
  Placed combos still flow through the `LineView → SubjectLinesCard` seam
  with zero row-component changes; BetDetail copy-bet works unchanged
  (`getByIds` is market-type-agnostic).
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
invariants, shuffled-dedup, 9 validation negatives (incl. the same combo twice
on one ticket), anti-tank (self blocked / non-member allowed), multi-combo
parlay (two fresh specs → one bet, 2 markets, ×4, one compose card with
`combo_count` 2), combo+regular-line parlay (×4), RSVP-out erasure
(market+bets+ledger+feed gone, balances restored, no resurrection), both-clock
settlement values (strikes Σ=5, spares Σ=3, clean_frames Σ=8, total_pins
Σ=270), pending-exempt → void_missing delete-refund, idempotent re-settle. Run
the suite before AND after any migration touching these RPCs.
