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

`combo_price_line(member_ids, stat, season, n_games[, week_id, game_number, line])`
quotes ANY half-point line for a member set (see Value-first lines below) —
an existing open market's posted rungs echo verbatim and its seed anchors;
unposted lines price fresh. `compose_combo_bet` specs take an optional
`"line"` (NULL = seed) and, since value-first, `"quoted_odds"` — a quoted
unposted line mints on demand on BOTH the fresh and dedup paths; without a
quote the legacy posted-rungs-only behavior holds. `v_combos_out` carries
`odds`. (⚰️ `combo_preview_ladder` is deprecated — kept one release for
deployed clients.)

## Value-first lines (2026-07-22, same day)

The bettor picks the **VALUE they intend to beat**; the odds attach to the
value. Any half-point line is quotable and bettable — the minted ladder is
invisible infrastructure (the seed anchors the editor; posted rungs are the
book's standing offers).

- **Preview** (client-granted, STABLE, never expose mean/variance):
  `market_price_line(market_id, line?)` for any priceable market and
  `combo_price_line(member_ids, stat, season, n_games, week?, game?, line?)`
  for a member set being composed. Return
  `{line, odds, posted, seed_line, seed_odds, min_line, max_line}` — `odds`
  null = "line unavailable". Posted rungs (incl. a frozen market's) echo
  their posted odds **verbatim**; unposted lines price fresh inside the
  **custom band** (`custom_odds_min/max`, NULL → `odds_min/max`). Band edges
  come from `odds_engine_norm_ppf` (Acklam inverse CDF) in closed form,
  snapped inward to half-points; an unposted SEED (fresh combo) force-prices
  clamped, mirroring the minter. Engine off → only posted lines quote and the
  band collapses onto the seed. Shared internals:
  `odds_engine_market_distribution(market_id)` (one market → the generators'
  exact mean/variance/n/range) + `odds_engine_quote_internal`.
- **Placement = mint-on-demand**: `place_bet_at_lines(picks jsonb, stake,
  items…)` takes line-shaped picks `{market_id, line, quoted_odds}`;
  `bet_mint_rung_internal` re-prices each line authoritatively — posted rung
  → reuse (quote tolerance-checked); absent → mint the over/under **pair** at
  the fresh zero-vig price (client odds are never stored; unders stay
  UI-hidden but must exist for settlement + PvP counterparty derivation).
  Keys `over:<line>`/`under:<line>` via `trim_scale` (matches the ladder
  minter's text form); `sort_order = 100 + 2·line` (after the ladder's 0..13;
  client sorts by line). Race-safe: `ON CONFLICT (market_id, key) DO NOTHING`
  + re-read. Then the untouched `place_house_bet` core — atomic, so **no
  betless custom rung can persist** (failed placement rolls the mint back).
- **Quote drift**: `quote_tolerance` (config, default 0.10 ≥ the 0.05 odds
  rounding step). A drifted quote rejects with the machine-parseable
  `ODDS_MOVED|<market_id>|<quoted>|<fresh>`; the app patches the staged price
  and asks "odds moved — place at the new price?" (bounded retries).
- **Combos**: `compose_combo_bet` specs carry optional `quoted_odds` — with
  it an unposted chosen line MINTS (fresh AND dedup paths); without it,
  legacy posted-rungs-only behavior (deployed-client compatible). New
  `p_extra_picks` lets regular line-shaped legs ride the same ticket (one
  bet). `combo_preview_ladder` is deprecated (kept one release for deployed
  clients).
- **Accepted quirk**: a custom rung minted on a bet-frozen market prices off
  the CURRENT model while its posted neighbors keep frozen odds — the book
  is honest; the band still bounds it.

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
  Side-aware seams: `selectionBetsAgainstSubject`, `isSelectionHiddenInUI`
  (`fmtOdds` lives in `utils/bets.ts`).
- **Board** (`LineRow.renderPill` → `LinePill`): value-first pills —
  `value CONDITION … ×odds`; tap-the-number opens the **`LineEntrySheet`**
  (BottomSheet), which shows the quoted min–max band and re-prices the typed
  half-point live (its own `useLinePreview` → `betMarkets.priceMarketLine`,
  250ms debounce); Accept returns `(value, quote)` and the screen's
  per-market `quoteCache` keeps the custom value priced on the board —
  display only, placement re-prices. Pill-body tap stages the displayed
  value; an accepted edit re-stages a staged pick (`updateSlipPick`). The
  ⚰️ rung-chip strip, the old `LineValueSheet`, and the inline `LineStepper`
  are retired.
- **Combos** (`BuilderBar`): the same `LineEntrySheet` (combo source) priced by
  `useLinePreview({kind:'combo'})` → `betMarkets.priceComboLine`; the quote's
  `seed_line` anchors; Add stages the chosen `line` + quoted `odds`.
- **Slip** (`BetSlipProvider.placeSlip`): regular picks are line-shaped →
  `bets.placeAtLines`; combo entries → `bets.composeCombo` (specs with
  `quoted_odds`, parlayed picks as `extraPicks`); specials keep `bets.place`.
  `ODDS_MOVED` rejections drive the odds-moved confirm + bounded retry.
  Parlay odds are the true product of leg odds.

## Verification

`probe-odds-engine.sql` (registered in `run-all-probes.sh`): CDF accuracy,
zero-vig identity, clamp/forced-clamp, monotonicity, ladder shape + seed-key
invariants, disabled-legacy shape, cold-start = prior, recency direction
(same history, opposite order → different means), side backfill, per-rung
grading incl. push, PvP same-rung counterparty, generation shape, id
stability across no-op resync, bet-freeze, combo alt-rung compose + preview
pass-through + dedup rung mismatch — plus the value-first vectors: ppf
round-trip, `market_price_line` posted echo / fresh-price parity /
half-point + out-of-band + settled rejections / engine-off degradation,
`combo_price_line` fresh + posted + unposted-on-existing, mint-on-demand
placement (pair mint at the fresh price with convention keys, rung reuse,
`ODDS_MOVED` contract with nothing minted, rollback leaves no orphan rung,
custom-rung settlement, combo quoted-mint dedup, combo + extra-pick one-bet
ticket). Run the full suite before AND after any push touching these
functions; regenerate `supabase/schema.sql` + `database.types.ts` after
pushing.

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
