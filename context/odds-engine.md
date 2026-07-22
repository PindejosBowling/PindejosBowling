# OddsEngine — fair-book pricing + selectable line ladders

The sportsbook's pricing brain. Before 2026-07-22 every `bet_selections` row
was hardcoded `odds = 2.000` and all "pricing" was line placement at
`expectation + 0.5`. The OddsEngine replaces that with a **fair (zero-vig)
probabilistic book**: every posted rung carries `odds = 1 / P(outcome)` from a
per-player normal model, and each market posts a **ladder of selectable
alt-lines** the bettor steps through in place. Pins are a hard-reset seasonal
score — beating the book is the game, so the book posts an honest opinion and
players profit by knowing what the model doesn't.

Shipped enabled (config seed row). Three migrations: `odds_engine_core`,
`odds_engine_side_fill`, `odds_engine_generators`, `odds_engine_combos`
(2026-07-22). Probe: `supabase/verify/probe-odds-engine.sql`.

## The model

- **Estimation** (`odds_engine_player_stat(player, season, stat)`):
  per-game (mean, variance) from OFFICIAL history only, **recency-weighted**
  with exponential decay — weight `0.5^(rank / half_life_games)` over games
  newest-first (default half-life **6 games**; deliberately fast so the book
  chases form and players get chances to fade streaks). Sources: stat
  `'score'` → archived `scores` (lifetime, all seasons — skill persists across
  pin resets); `'strikes' | 'spares' | 'clean_frames'` → `lanetalk_game_imports`
  with `classification = 'official' AND frames > 0` (clean frame ≈ strike or
  spare, matching `lanetalk_seed_lines`). Estimates are **empirical-Bayes
  shrunk** toward league priors (`odds_engine_league_prior`) with pseudo-count
  `prior_weight_games` (default 6), and variance is floored
  (`variance_floor_score` 225 pins², `variance_floor_count` 0.75). No history
  → pure league prior (near-evens, wide variance).
- **Pricing** (`odds_engine_price_pair`): stat ~ Normal(mean, var); night
  scope scales both by n games; combos sum member means/variances
  (independence). `P(over)` via `odds_engine_norm_cdf` (Abramowitz–Stegun
  7.1.26 erf, IMMUTABLE); odds = `1/p` — **zero vig**, both sides fair
  complements. Posted odds round to the nearest 0.05, min 1.05 (the
  `odds > 1.0` CHECK).
- **Ladders** (`odds_engine_build_ladder` → `odds_engine_mint_ladder`):
  the legacy seed-line formulas are UNCHANGED and become the ladder's center —
  `pvp_player_line` (game score), floored night mean (night pins),
  `lanetalk_seed_lines` (stat props), `combo_seed_line` (combos). Up to
  `rungs_per_side` (3) rungs each way: counts step 1.0, game score 10, night
  pins 20 (`spacing_*` config). A rung is minted only if BOTH sides' raw fair
  odds land inside `[odds_min, odds_max]` ([1.10, 8.00]) and the line stays in
  the stat's possible range; the **seed rung is always minted** (odds clamped
  instead) because its canonical keys must exist.

## Selection identity: `side` + key scheme

`bet_selections.side` ('over'/'under', NULL for moneyline team-uuid keys) is
the dispatch column — **never dispatch on key text**. Seed rung keeps the
canonical keys `'over'` / `'under'` (PvP payloads, custom-line spec `pick`
resolution, combo seed lookups all keep working); alt rungs are keyed
`'over:<line>'` / `'under:<line>'`. A BEFORE INSERT trigger
(`bet_selections_fill_side`) derives side from the key for any legacy insert
path. Unders are minted for every rung but remain **UI-hidden** (the existing
social-dynamics policy, now `sel.side === 'under'` in
`isSelectionHiddenInUI`); PvP prop duels need them — the counterparty
derivation in `create_pvp_challenge`/`counter_pvp_challenge` is now
**same rung (line), opposite side** (the old `key <> selection LIMIT 1`
would pick an arbitrary rung).

## Sync / reprice semantics

Generation stays trigger-coupled (`resync_week_markets` on rsvp/games/scores/
team_slots). Betless open markets (O/U) and betless open+closed markets
(LaneTalk props) **re-ladder** on sync — line AND odds drift with new history —
but only swap rows when the freshly built ladder differs
(`odds_engine_reladder_if_changed`), so selection ids stay stable across
no-op resyncs (staged-but-unplaced slips keep working). **Any bet freezes the
whole market's ladder** (the pre-existing invariant, probe-asserted); prune +
refund-on-market-death paths are unchanged.

## Combos

`combo_preview_ladder(member_ids, stat, season, n_games[, week_id, game_number])`
returns the priced over-rungs as jsonb `[{line, odds, is_seed}]` — and when an
open market already exists for the same `combo_key`, returns THAT market's
posted rungs verbatim (a second bettor can only take posted lines).
`compose_combo_bet` specs take an optional `"line"` (NULL = seed): new markets
mint the FULL ladder then bet the chosen rung's over; the dedup path requires
the chosen line to be posted (raises otherwise). `v_combos_out` now carries
`odds`.

## Config — `odds_engine_config`

Global row (`season_id NULL`) + optional per-season override
(`odds_engine_get_config` resolves season-first). Knobs: `is_enabled`,
`half_life_games`, `prior_weight_games`, `variance_floor_*`, `odds_min/max`,
`rungs_per_side`, `spacing_*`. **`is_enabled = false` reproduces pre-engine
behavior exactly** — a single 2.000 over/under pair at the seed line
(probe-combo-lines pins a season override off to keep its even-money math,
which doubles as the integration proof).

## App layer

- `SelectionView.side` (normalizeMarket; key-prefix fallback for cached rows).
  Side-aware seams: `selectionBetsAgainstSubject`, `isSelectionHiddenInUI`,
  `selectionButtonLabel` (now appends the rung's price: `"4.5+ STRIKES ×2.40"`;
  `fmtOdds` lives in `utils/bets.ts`).
- **Board** (`LineRow` → `LinePill`): each market gets its own FULL-WIDTH
  pill row (condition left, payout right). Laddered pills carry a ▾ toggle
  that expands the pill's own inline value selector — a horizontal strip of
  every posted value with its payout; tapping a value stages that outcome
  ("bet on the outcome you want; the odds derive from the selection").
  Tapping the pill body stages/unstages the displayed value. Armed combine
  mode hides the expander (taps seed the combo).
- **Combos** (`BuilderBar` + `useComboLinePreview`): the hook returns
  `{ladder, seedIndex, loading}` via `betMarkets.previewComboLadder`;
  tapping the BuilderBar's line block opens the same `LineValueSheet`
  (picking sets `comboRungIndex`; Add stages). The screen owns
  `comboRungIndex` (snaps to seed on combo-identity change); `SlipCombo`
  carries the chosen `line` + `odds`; `BetSlipProvider.toSpec` passes `line`
  to compose.
- **Slip**: parlay odds are the true product of leg odds (was `2^n`); combo
  ticket cards show the previewed rung price.

## Verification

`probe-odds-engine.sql` (registered in `run-all-probes.sh`): CDF accuracy,
zero-vig identity, clamp/forced-clamp, monotonicity, ladder shape + seed-key
invariants, disabled-legacy shape, cold-start = prior, recency direction
(same history, opposite order → different means), side backfill, per-rung
grading incl. push, PvP same-rung counterparty, generation shape, id
stability across no-op resync, bet-freeze, combo alt-rung compose + preview
pass-through + dedup rung mismatch. Run the full suite before AND after any
push touching these functions; regenerate `supabase/schema.sql` +
`database.types.ts` after pushing.

## Tuning / debugging recipes

- **Book feels too jumpy/slow**: adjust `half_life_games` (higher = calmer)
  or `prior_weight_games` (higher = more league-average).
- **Odds look wrong for one player**: `SELECT * FROM
  odds_engine_player_stat('<player>', '<season>', 'strikes')` and compare
  against their `lanetalk_game_imports` official rows; remember recreational
  imports NEVER count.
- **A rung is missing**: it priced outside `[odds_min, odds_max]` or left the
  stat's range — check `odds_engine_build_ladder(...)` output directly.
- **Kill switch**: `UPDATE odds_engine_config SET is_enabled = false` (global
  or per-season) via a migration; next resync re-mints betless markets as
  single 2.000 pairs. Placed bets are never touched either way
  (`odds_at_placement`/`line_at_placement` snapshots).
