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
  spare, matching `lanetalk_seed_lines`). **The league prior FADES out of the
  mean** (`…130032_fade_league_prior_mean`, grilled 2026-07-23): the prior's
  pseudo-count on the mean is `max(0, prior_weight_games − own_official_games)`
  — a rookie runway (default 6 games), NOT permanent skepticism. Rationale:
  recency decay caps a player's evidence weight at `1/(1−0.5^(1/half_life))
  ≈ 9.2` games-worth, so a fixed pseudo-count held ≥ ~40% of every estimate
  forever, systematically underpricing top players' overs and overpricing
  underperformers' — an asymmetry the owner rejected ("reward outperformance
  relative to your own skill set"). Established players (≥ `prior_weight_games`
  official games) now price purely off their recency-weighted own history.
  **VARIANCE keeps the full-weight league blend + floors — deliberately**
  (`variance_floor_score` 225 pins², `variance_floor_count` 0.75): variance
  blending has no directional favorite, and with fair uncapped tails a noisy
  own-history variance would misprice long-tail quotes with real House
  liability. No history → pure league prior (near-evens, wide variance —
  cold start unchanged). Sandbagging (tank your line, back your own over) was
  grilled and **accepted as a risk, no guard** — real league nights are
  publicly costly to tank and big self-bets hit the Activity Feed; revisit
  only if observed.
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
  their posted odds **verbatim**; unposted lines price fresh at the **FAIR
  zero-vig odds — no ceiling** (migrations `…231500_widen_value_line_bands`
  + `…234500_fair_tail_odds` + `…20260723001500_min_offered_odds`). The
  band's HIGH edge is the stat's physical cap — counts 9.5/game (night
  10·g−0.5), score O/U **220 pins/game** (game 220.5, night 220·g+0.5,
  combos 220/game/member) — and long-tail lines pay their true model price
  (×dozens to ×millions — the normal tail; mind the House liability on
  lifetime games). The LOW edge is the **offer floor**: the smallest line
  paying `odds_min` (**×1.20**, custom_odds_min resolves first) — below it
  quotes return NULL, the minter rejects, and ladders don't post rungs
  (seed anchor exempt). Prices are never clamped — the floor gates
  AVAILABILITY only. `odds_max`/`custom_odds_max` + `price_pair`'s `p_force`
  are **INERT**. Engine off → only posted lines quote and the band collapses
  onto the seed. Shared internals:
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

## Player projection display (2026-07-23, `…150000_odds_engine_player_projection`)

`odds_engine_player_projection(p_player_id, p_season_id)` (STABLE,
authenticated) returns one row per stat (`score`, `clean_frames`, `strikes`,
`spares`): `projected` = the engine's PER-GAME mean **rounded to 0.1**
(deliberate owner decision to surface the mean — the posted seed lines already
telegraph the center; VARIANCE and the quote band stay server-side, the
never-expose posture otherwise unchanged), plus `season_avg`/`avg_source`/
`avg_games` via `combo_member_averages`' fallback chain (`score` maps to its
`total_pins` branch). Engine disabled → `projected` NULL on every row
(averages still return). Display-only — no pricing path reads it. App:
`betMarkets.playerProjection` → the board's `BookProjectionCard` strip
(under the player select, per-player cached, scope-scaled × games for
Weekly) showing "book projection vs season avg" with a ▲/▼ delta.

## Correlated parlays — joint pricing (2026-07-23, `…014500_correlated_parlay_pricing` + `…040000_parlay_quote_implied_joint`)

Parlays paid `Π(leg odds)` even for same-player legs ("over 219.5 pins G1" ×
"over 4.5 clean frames G1" — the first implies the second), an unbounded +EV
exploit once tails went fair. Now, in `place_house_bet` (every placement path
funnels through it):

- **Clusters**: legs sharing a subject player with overlapping scope (same
  game, or night↔game — night contains every game; combo `params.member_ids`
  count). Cross-cluster stays independent → product.
- **2-leg cluster**: repriced off the joint bivariate normal. Covariance is
  closed-form under the engine's independence assumptions: Σ over shared
  (player, game) cells of `ρ(stat_a, stat_b)·σa·σb`; league stat-pair ρ lives
  in **`odds_engine_stat_corr`** (empirically seeded from official imports —
  live score↔clean_frames came out 0.947 — admin-tunable, `total_pins`
  canonicalizes to `score`). `odds_engine_bvn_cdf` = Φ₂ via Simpson on the
  tetrachoric integral, Fréchet-clamped. The pair's orthant thresholds are
  **QUOTE-implied** (`p̂ = 1/quoted`, `ẑ = odds_engine_norm_ppf(p̂)`; the
  model's `(line−μ)/σ` is only the fallback for a missing quote; ρ stays
  model-derived) — so the Fréchet bound guarantees joint ≥ max(quoted legs)
  even when a leg's quote sits below model fair (legacy `odds_max`-clamped
  seed rungs, frozen ladders, grid rounding). Model-derived thresholds caused
  the 2026-07-23 impossible-odds bug: cf 14.5 ×93.55 alone DROPPED to ×90.08
  parlayed with tp 283.5 (posted ×8.000, fair ×8.29 — the discount survived
  the product at ρ≈0.95). The remaining pre-fair-tails clamped ladders were
  swept the same day by `…043000_reprice_stale_ladders` (one-time
  `resync_week_markets` over open weeks — sync is trigger-coupled and nothing
  had fired since the policy rewrite). The ratio joint/product is folded
  into the STORED `bet_legs.odds_at_placement` (geometric √f per leg — every
  scaled leg stays > 1), so settlement's product recompute, Winner's Crutch
  leg drops, and unsettle/resettle need no changes. Anti-correlated pairs
  (strikes↔spares, ρ<0) get a fair BOOST — symmetric.
- **≥3-leg cluster**: rejected with `CORRELATED_LEGS|<player_id>` (exact ≥3-dim
  orthants need numeric integration; the slip forces singles early via the
  same cluster rule client-side in `BetSlip.maxCorrelatedCluster`).
- **Preview**: `parlay_price(week, picks, combos)` (authenticated) returns the
  joint `{odds, correlated, factors}` (or `{blocked_player_id}`); `BetSlip`
  debounces it to replace the client product on the parlay ticket (fallback:
  product while in flight) and shows each leg's CONTRIBUTING odds (quoted ×
  its factor, picks-then-combos alignment) on the leg rows so the ticket
  badge visibly equals their product. Placement reprices authoritatively.
- **Exemptions**: specials (`p_custom_line_id`, admin-priced bundles); engine
  off → legacy product (probe-combo-lines' even-money math relies on this);
  moneyline/team_prop legs are inert subjectless legs.
- Fns: `odds_engine_parlay_market_factors` (market-shaped wrapper; takes the
  legs' quoted odds as `p_odds`) → `odds_engine_parlay_factors_internal`
  (cluster + factor engine, jsonb leg descriptors incl. `quoted`) →
  `odds_engine_bvn_cdf` / `odds_engine_norm_ppf` / `odds_engine_stat_rho`.

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
ticket), and the correlated-parlay vectors (independence control, haircut +
preview parity, ≥3-cluster contract, combo↔pick clustering, M7 quote-implied
joint floor: a leg deliberately quoted below fair must still parlay ≥ the
best single). Run the full suite before AND after any push touching these
functions; regenerate `supabase/schema.sql` + `database.types.ts` after
pushing.

## Tuning / debugging recipes

- **Book feels too jumpy/slow**: adjust `half_life_games` (higher = calmer).
  `prior_weight_games` is now the ROOKIE RUNWAY length (how many official
  games until the league prior leaves the mean) plus the variance blend's
  pseudo-count — it no longer applies permanent league-average pull to
  established players' means.
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
