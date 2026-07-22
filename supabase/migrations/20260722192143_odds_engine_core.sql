-- ─────────────────────────────────────────────────────────────────────────────
-- OddsEngine core (1 of 3): fair-book probabilistic pricing foundation.
--
-- Adds:
--   • bet_selections.side ('over'/'under', NULL for moneyline team keys) so
--     alt-line ladders can carry many over/under pairs per market while every
--     consumer dispatches on side instead of the literal key text.
--   • odds_engine_config — knobs for the recency-weighted normal model
--     (half-life, prior weight, variance floors, odds clamps, rung geometry).
--     Seeded ENABLED (global row).
--   • odds_engine_* functions: normal CDF (Abramowitz–Stegun erf), league
--     priors, recency-weighted per-player (mean, variance), fair price pair,
--     and the ladder minter (single 2.000 pair when disabled = legacy shape).
--   • Side-aware rewrites of settle_market_internal, place_house_bet,
--     prevent_self_tank, and the PvP prop-duel counterparty derivation
--     (create/counter) — the old `key <> selection LIMIT 1` silently picks an
--     arbitrary rung once ladders exist; now it's same-rung-opposite-side.
--
-- Behavior-neutral for every existing market (all have exactly one
-- over/under pair whose side backfills from key). No generator changes here —
-- those land in odds_engine_generators (2 of 3).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. side column ─────────────────────────────────────────────────────────────
ALTER TABLE public.bet_selections
  ADD COLUMN side text CHECK (side IN ('over', 'under'));

UPDATE public.bet_selections SET side = key WHERE key IN ('over', 'under');

-- 2. odds_engine_config ──────────────────────────────────────────────────────
CREATE TABLE public.odds_engine_config (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  season_id            uuid,
  is_enabled           boolean NOT NULL DEFAULT true,
  -- Exponential recency decay: weight halves every N official games.
  half_life_games      numeric NOT NULL DEFAULT 6,
  -- Empirical-Bayes pseudo-count: league prior weighs like k games.
  prior_weight_games   numeric NOT NULL DEFAULT 6,
  -- Variance floors (score in pins², counts in frames²) — no player is ever
  -- modeled as more predictable than this.
  variance_floor_score numeric NOT NULL DEFAULT 225,
  variance_floor_count numeric NOT NULL DEFAULT 0.75,
  -- Posted-odds clamp; alt rungs pricing outside are not minted, the seed
  -- rung is clamped into bounds (its canonical 'over'/'under' keys must exist).
  odds_min             numeric NOT NULL DEFAULT 1.10,
  odds_max             numeric NOT NULL DEFAULT 8.00,
  -- Ladder geometry: up to seed ± rungs_per_side × spacing.
  rungs_per_side       integer NOT NULL DEFAULT 3,
  spacing_score        numeric NOT NULL DEFAULT 10,
  spacing_night_pins   numeric NOT NULL DEFAULT 20,
  spacing_count        numeric NOT NULL DEFAULT 1.0,
  updated_by           uuid,
  created_at           timestamp with time zone NOT NULL DEFAULT now(),
  updated_at           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT odds_engine_config_pkey PRIMARY KEY (id),
  CONSTRAINT odds_engine_config_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE,
  CONSTRAINT odds_engine_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.players(id) ON DELETE SET NULL,
  CONSTRAINT odds_engine_config_half_life_check CHECK (half_life_games > 0),
  CONSTRAINT odds_engine_config_prior_weight_check CHECK (prior_weight_games >= 0),
  CONSTRAINT odds_engine_config_variance_floors_check CHECK (variance_floor_score > 0 AND variance_floor_count > 0),
  CONSTRAINT odds_engine_config_odds_clamp_check CHECK (odds_min > 1.0 AND odds_max > odds_min),
  CONSTRAINT odds_engine_config_rungs_check CHECK (rungs_per_side BETWEEN 0 AND 6),
  CONSTRAINT odds_engine_config_spacing_check CHECK (spacing_score > 0 AND spacing_night_pins > 0 AND spacing_count > 0)
);

-- One global row (season_id NULL) + at most one override per season.
CREATE UNIQUE INDEX odds_engine_config_global_uniq ON public.odds_engine_config ((true)) WHERE (season_id IS NULL);
CREATE UNIQUE INDEX odds_engine_config_season_uniq ON public.odds_engine_config (season_id) WHERE (season_id IS NOT NULL);

ALTER TABLE public.odds_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage" ON public.odds_engine_config AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "authenticated can read" ON public.odds_engine_config AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- Engine live from day one (fair book, zero vig).
INSERT INTO public.odds_engine_config (season_id, is_enabled) VALUES (NULL, true);

-- 3. Config resolver ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.odds_engine_get_config(p_season_id uuid)
 RETURNS public.odds_engine_config
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg public.odds_engine_config;
BEGIN
  -- Season override wins over the global row; a missing table row degrades to
  -- typed defaults (engine enabled) so fixture seasons never crash pricing.
  SELECT * INTO v_cfg
    FROM public.odds_engine_config
    WHERE season_id = p_season_id OR season_id IS NULL
    ORDER BY season_id NULLS LAST
    LIMIT 1;
  IF v_cfg.id IS NULL THEN
    v_cfg.is_enabled           := true;
    v_cfg.half_life_games      := 6;
    v_cfg.prior_weight_games   := 6;
    v_cfg.variance_floor_score := 225;
    v_cfg.variance_floor_count := 0.75;
    v_cfg.odds_min             := 1.10;
    v_cfg.odds_max             := 8.00;
    v_cfg.rungs_per_side       := 3;
    v_cfg.spacing_score        := 10;
    v_cfg.spacing_night_pins   := 20;
    v_cfg.spacing_count        := 1.0;
  END IF;
  RETURN v_cfg;
END;
$function$;

-- 4. Normal CDF ──────────────────────────────────────────────────────────────
-- Φ(z) via erf, Abramowitz–Stegun 7.1.26 (|ε| ≤ 1.5e-7) with sign symmetry.
CREATE OR REPLACE FUNCTION public.odds_engine_norm_cdf(z double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN z >= 0 THEN 0.5 * (1.0 + e.erf) ELSE 0.5 * (1.0 - e.erf) END
  FROM (
    SELECT 1.0 - (((((1.061405429 * t.t - 1.453152027) * t.t + 1.421413741) * t.t
                    - 0.284496736) * t.t + 0.254829592) * t.t) * exp(-t.x * t.x) AS erf
    FROM (
      SELECT c.x, 1.0 / (1.0 + 0.3275911 * c.x) AS t
      FROM (SELECT abs(z) / sqrt(2.0) AS x) c
    ) t
  ) e;
$function$;

-- 5. League priors ───────────────────────────────────────────────────────────
-- Population mean/variance the per-player estimates shrink toward. 'score' in
-- pins per game (this season's archive → lifetime → (130, 225)); counts in
-- events per game over ALL official LaneTalk imports (clean frame ≈ strike or
-- spare, matching lanetalk_seed_lines).
CREATE OR REPLACE FUNCTION public.odds_engine_league_prior(p_season_id uuid, p_stat text, OUT mean numeric, OUT variance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_stat = 'score' THEN
    SELECT AVG(s.score), var_pop(s.score) INTO mean, variance
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = p_season_id AND w.is_archived = true
      AND ts.player_id IS NOT NULL AND s.score > 0;

    IF mean IS NULL THEN
      SELECT AVG(s.score), var_pop(s.score) INTO mean, variance
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true AND ts.player_id IS NOT NULL AND s.score > 0;
    END IF;

    mean     := COALESCE(mean, 130);
    variance := COALESCE(NULLIF(variance, 0), 225);

  ELSIF p_stat IN ('strikes', 'spares', 'clean_frames') THEN
    SELECT AVG(v), var_pop(v) INTO mean, variance
    FROM (
      SELECT CASE p_stat
               WHEN 'strikes' THEN i.strikes
               WHEN 'spares'  THEN i.spares
               ELSE i.strikes + i.spares
             END AS v
      FROM public.lanetalk_game_imports i
      WHERE i.classification = 'official' AND i.frames > 0
    ) g;

    mean     := COALESCE(mean, CASE p_stat WHEN 'clean_frames' THEN 4 ELSE 2 END);
    variance := COALESCE(NULLIF(variance, 0), 2);

  ELSE
    RAISE EXCEPTION 'Unknown odds engine stat %', p_stat;
  END IF;
END;
$function$;

-- 6. Recency-weighted per-player estimate ────────────────────────────────────
-- Official games only, newest first, weight 0.5^(rank / half_life); weighted
-- mean/variance shrunk toward the league prior with pseudo-count k; variance
-- floored. w_total = 0 (no history) → pure league prior.
CREATE OR REPLACE FUNCTION public.odds_engine_player_stat(p_player_id uuid, p_season_id uuid, p_stat text, OUT mean numeric, OUT variance numeric, OUT w_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg    public.odds_engine_config;
  v_mean_w numeric;
  v_var_w  numeric;
  v_floor  numeric;
  v_pm     numeric;
  v_pv     numeric;
BEGIN
  v_cfg := public.odds_engine_get_config(p_season_id);
  v_floor := CASE WHEN p_stat = 'score' THEN v_cfg.variance_floor_score ELSE v_cfg.variance_floor_count END;

  IF p_stat = 'score' THEN
    -- Archived bowled scores, lifetime (skill persists across seasonal pin
    -- resets), newest night first.
    WITH ordered AS (
      SELECT s.score::numeric AS v,
             row_number() OVER (ORDER BY w.bowled_at DESC NULLS LAST, w.created_at DESC, s.created_at DESC) - 1 AS rk
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true AND ts.player_id = p_player_id AND s.score > 0
    ), weighted AS (
      SELECT v, power(0.5, rk / v_cfg.half_life_games) AS wt FROM ordered
    ), agg AS (
      SELECT SUM(wt) AS w, SUM(wt * v) / NULLIF(SUM(wt), 0) AS m FROM weighted
    )
    SELECT a.w, a.m,
           (SELECT SUM(wt * (v - a.m) ^ 2) / NULLIF(a.w, 0) FROM weighted)
      INTO w_total, v_mean_w, v_var_w
    FROM agg a;

  ELSIF p_stat IN ('strikes', 'spares', 'clean_frames') THEN
    WITH ordered AS (
      SELECT (CASE p_stat
                WHEN 'strikes' THEN i.strikes
                WHEN 'spares'  THEN i.spares
                ELSE i.strikes + i.spares
              END)::numeric AS v,
             row_number() OVER (ORDER BY i.played_at DESC NULLS LAST, i.created_at DESC) - 1 AS rk
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = p_player_id AND i.classification = 'official' AND i.frames > 0
    ), weighted AS (
      SELECT v, power(0.5, rk / v_cfg.half_life_games) AS wt FROM ordered
    ), agg AS (
      SELECT SUM(wt) AS w, SUM(wt * v) / NULLIF(SUM(wt), 0) AS m FROM weighted
    )
    SELECT a.w, a.m,
           (SELECT SUM(wt * (v - a.m) ^ 2) / NULLIF(a.w, 0) FROM weighted)
      INTO w_total, v_mean_w, v_var_w
    FROM agg a;

  ELSE
    RAISE EXCEPTION 'Unknown odds engine stat %', p_stat;
  END IF;

  w_total := COALESCE(w_total, 0);
  SELECT lp.mean, lp.variance INTO v_pm, v_pv FROM public.odds_engine_league_prior(p_season_id, p_stat) lp;

  IF w_total = 0 THEN
    mean     := v_pm;
    variance := GREATEST(v_floor, v_pv);
  ELSE
    mean     := (w_total * v_mean_w + v_cfg.prior_weight_games * v_pm) / (w_total + v_cfg.prior_weight_games);
    variance := GREATEST(v_floor,
                  (w_total * COALESCE(v_var_w, 0) + v_cfg.prior_weight_games * v_pv)
                  / (w_total + v_cfg.prior_weight_games));
  END IF;
END;
$function$;

-- 7. Fair price pair ─────────────────────────────────────────────────────────
-- Zero-vig over/under odds for one rung of a Normal(mean, variance) stat over
-- p_n_games (night = n×mean, n×variance). NULL pair when either side's raw
-- fair odds falls outside [odds_min, odds_max] and p_force is false; p_force
-- (the seed rung) clamps into bounds instead — its canonical keys must exist.
-- Posted odds round to the nearest 0.05, never below 1.05 (odds CHECK > 1.0).
CREATE OR REPLACE FUNCTION public.odds_engine_price_pair(p_mean numeric, p_variance numeric, p_n_games integer, p_line numeric, p_odds_min numeric, p_odds_max numeric, p_force boolean, OUT over_odds numeric, OUT under_odds numeric)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_mean  numeric := p_mean * GREATEST(p_n_games, 1);
  v_var   numeric := p_variance * GREATEST(p_n_games, 1);
  v_p     double precision;
  v_over  numeric;
  v_under numeric;
BEGIN
  v_p := 1.0 - public.odds_engine_norm_cdf(((p_line - v_mean) / sqrt(v_var))::double precision);
  v_p := LEAST(1.0 - 1e-9, GREATEST(1e-9, v_p));
  v_over  := 1.0 / v_p;
  v_under := 1.0 / (1.0 - v_p);

  IF NOT p_force AND (v_over  < p_odds_min OR v_over  > p_odds_max
                   OR v_under < p_odds_min OR v_under > p_odds_max) THEN
    over_odds  := NULL;
    under_odds := NULL;
    RETURN;
  END IF;

  over_odds  := GREATEST(1.05, round(LEAST(p_odds_max, GREATEST(p_odds_min, v_over))  * 20) / 20);
  under_odds := GREATEST(1.05, round(LEAST(p_odds_max, GREATEST(p_odds_min, v_under)) * 20) / 20);
END;
$function$;

-- 8. Ladder minter ───────────────────────────────────────────────────────────
-- Inserts the full selection set for one market: seed rung (canonical
-- 'over'/'under' keys, always minted, odds clamped) ± up to rungs_per_side
-- rungs at p_spacing (keys 'over:<line>'/'under:<line>'), skipping rungs
-- outside [p_range_lo, p_range_hi] or whose fair odds leave the clamp.
-- Engine disabled (or no distribution supplied) → the exact legacy shape:
-- one 2.000 over/under pair at the seed line.
CREATE OR REPLACE FUNCTION public.odds_engine_mint_ladder(p_market_id uuid, p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg   public.odds_engine_config;
  v_line  numeric;
  v_over  numeric;
  v_under numeric;
  j       integer;
BEGIN
  v_cfg := public.odds_engine_get_config(p_season_id);

  IF NOT v_cfg.is_enabled OR p_mean IS NULL OR p_variance IS NULL THEN
    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side) VALUES
      (p_market_id, 'over',  'Over',  2.000, p_seed_line, 0, 'over'),
      (p_market_id, 'under', 'Under', 2.000, p_seed_line, 1, 'under');
    RETURN;
  END IF;

  FOR j IN -v_cfg.rungs_per_side .. v_cfg.rungs_per_side LOOP
    v_line := p_seed_line + j * p_spacing;
    IF v_line < p_range_lo OR v_line > p_range_hi THEN
      CONTINUE;
    END IF;

    SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
      FROM public.odds_engine_price_pair(p_mean, p_variance, p_n_games, v_line,
                                         v_cfg.odds_min, v_cfg.odds_max, j = 0) pp;
    IF v_over IS NULL THEN
      CONTINUE;  -- rung priced outside the clamp: not minted
    END IF;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side) VALUES
      (p_market_id,
       CASE WHEN j = 0 THEN 'over' ELSE 'over:' || v_line END,
       'Over', v_over, v_line, (j + v_cfg.rungs_per_side) * 2, 'over'),
      (p_market_id,
       CASE WHEN j = 0 THEN 'under' ELSE 'under:' || v_line END,
       'Under', v_under, v_line, (j + v_cfg.rungs_per_side) * 2 + 1, 'under');
  END LOOP;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. settle_market_internal — grade by side, per-selection line
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_market_internal(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market public.bet_markets;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type NOT IN ('over_under', 'prop', 'team_prop', 'combo') THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under/prop/team_prop/combo markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;

  -- Selection results (side-aware — ladders carry many over/under pairs,
  -- each graded against its OWN line): over wins above the line, under below;
  -- half-point lines never push, but equality is handled as push for completeness.
  UPDATE public.bet_selections s
    SET result = CASE
      WHEN s.side = 'over'  THEN CASE WHEN p_result_value > s.line THEN 'won'
                                     WHEN p_result_value < s.line THEN 'lost' ELSE 'push' END
      WHEN s.side = 'under' THEN CASE WHEN p_result_value < s.line THEN 'won'
                                     WHEN p_result_value > s.line THEN 'lost' ELSE 'push' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  UPDATE public.bet_markets
    SET result_value = p_result_value, status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$function$
;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. place_house_bet — anti-tank dispatches on side
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer, p_custom_line_id uuid DEFAULT NULL::uuid, p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_balance   integer;
  v_odds      numeric := 1;
  v_payout    integer;
  v_bet_id    uuid;
  v_sel       record;
  v_n         integer;
  v_line      public.custom_lines%ROWTYPE;
  v_boost_pct numeric := NULL;
  v_total_payout integer;
BEGIN
  v_player_id := public.current_player_id();

  IF p_selection_ids IS NULL OR array_length(p_selection_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  -- Custom line ("Special") tag: snapshot its display identity onto the bet.
  -- The selections themselves are client-resolved (same trust as the parlay
  -- slip); the line must simply exist and be live.
  IF p_custom_line_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.custom_lines WHERE id = p_custom_line_id;
    IF v_line.id IS NULL OR NOT v_line.is_active THEN
      RAISE EXCEPTION 'This special is no longer available';
    END IF;
  END IF;

  -- Validate every selection, gather odds, resolve + assert a single season AND
  -- a single week, and enforce anti-tanking. Each selection must belong to a
  -- distinct open market.
  v_n := 0;
  FOR v_sel IN
    SELECT s.id AS selection_id, s.key, s.side, s.odds, s.line,
           m.id AS market_id, m.status, m.subject_player_id, m.week_id
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = ANY (p_selection_ids)
  LOOP
    v_n := v_n + 1;
    IF v_sel.status <> 'open' THEN
      RAISE EXCEPTION 'A selected market is not open';
    END IF;

    DECLARE
      v_mseason   uuid;
      v_marchived boolean;
    BEGIN
      SELECT season_id, is_archived INTO v_mseason, v_marchived
        FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      -- A locked week (advanced or fully archived) takes no new stakes even if a
      -- prop market is still 'open' pending its next-day settlement clock.
      IF v_marchived THEN
        RAISE EXCEPTION 'This week is locked — no new bets can be placed';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Single-week invariant: bets.week_id is single-valued, so every leg must
    -- share the first leg's week.
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    ELSIF v_week_id <> v_sel.week_id THEN
      RAISE EXCEPTION 'All selections must be in the same week';
    END IF;

    -- Anti-tank (trigger is the backstop): no backing 'under' on your own market.
    IF v_sel.subject_player_id = v_player_id AND v_sel.side = 'under' THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own line';
    END IF;

    v_odds := v_odds * v_sel.odds;
  END LOOP;

  IF v_n <> array_length(p_selection_ids, 1) THEN
    RAISE EXCEPTION 'One or more selections not found';
  END IF;

  v_payout := FLOOR(p_stake * v_odds);

  v_balance := public.pin_balance(v_player_id, v_season_id);
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  -- Safety Ticket: validate the catalog contract, then consume the atomic item
  -- in one guarded UPDATE (owner + unconsumed + current season — rowcount 0
  -- means one of those failed). Spent at placement, win or lose; deliberately
  -- NO is_active check (retirement stops grants, never confiscates).
  IF p_insurance_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_insurance_item_id
         AND c.effect_type = 'bet_insurance'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not attachable bet insurance';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_insurance_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Safety Ticket is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Winner's Crutch: same consume posture as the Safety Ticket, but its own
  -- effect_type and a parlay floor — a crutch on a single can never help (cancel
  -- the only leg = nothing survives). Spent at placement, win or lose.
  IF p_crutch_item_id IS NOT NULL THEN
    IF v_n < 2 THEN
      RAISE EXCEPTION 'A Winner''s Crutch can only be attached to a parlay (2 or more legs)';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_crutch_item_id
         AND c.effect_type = 'parlay_crutch'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Winner''s Crutch';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_crutch_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Winner''s Crutch is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Energy Drink: same consume posture; its own effect_type, no leg floor (a
  -- boost helps any winning bet, single or parlay). Spent at placement, win or
  -- lose; the bonus is paid at settlement on a win. Its boost_pct is snapshotted
  -- onto the bet below so display + settlement share one locked-at-placement value.
  IF p_boost_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_boost_item_id
         AND c.effect_type = 'odds_boost'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Energy Drink';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_boost_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Energy Drink is not usable (already spent, wrong season, or not yours)';
    END IF;

    -- Lock the flavor's boost magnitude onto the bet (defaults to 1.0 if a row
    -- somehow omits it).
    SELECT COALESCE((c.effect_params ->> 'boost_pct')::numeric, 1.0) INTO v_boost_pct
      FROM public.player_inventory_items i
      JOIN public.item_catalog c ON c.id = i.catalog_item_id
     WHERE i.id = p_boost_item_id;
  END IF;

  INSERT INTO public.bets (player_id, season_id, week_id, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category,
                           insurance_item_id, crutch_item_id, boost_item_id, boost_pct)
    VALUES (v_player_id, v_season_id, v_week_id, p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category,
            p_insurance_item_id, p_crutch_item_id, p_boost_item_id, v_boost_pct)
    RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, s.id, 'back', s.odds, s.line
    FROM public.bet_selections s
    WHERE s.id = ANY (p_selection_ids);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  PERFORM public.pin_ledger_double_entry(
    v_player_id, v_season_id, v_week_id,
    -p_stake, 'bet_stake', 'Bet placed', NULL, v_bet_id);

  -- Max possible payout INCLUSIVE of an attached boost — mirrors the settlement
  -- bonus formula (floor(payout × boost_pct) on top of the total payout).
  v_total_payout := v_payout
    + CASE WHEN v_boost_pct IS NOT NULL THEN FLOOR(v_payout * v_boost_pct)::integer ELSE 0 END;

  -- Activity Feed: post at most ONE placement event by priority (§3, §10.3).
  -- v_balance here is the pre-bet balance; v_n is the leg count; v_payout is the
  -- total potential payout (the "to win" figure surfaced on the feed card).
  IF p_stake >= GREATEST(250, FLOOR(0.10 * v_balance)) THEN
    -- Big ticket.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_big_ticket_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.big_ticket_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$
;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. prevent_self_tank — trigger backstop dispatches on side
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_self_tank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_bettor      uuid;
  v_subject     uuid;
  v_side        text;
  v_market_type text;
  v_params      jsonb;
BEGIN
  SELECT player_id INTO v_bettor FROM public.bets WHERE id = NEW.bet_id;

  SELECT m.subject_player_id, s.side, m.market_type, m.params
    INTO v_subject, v_side, v_market_type, v_params
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = NEW.selection_id;

  -- Player markets: no backing the under (or laying the over) on your OWN line.
  IF v_subject IS NOT NULL AND v_subject = v_bettor THEN
    IF (NEW.side = 'back' AND v_side = 'under')
       OR (NEW.side = 'lay' AND v_side = 'over') THEN
      RAISE EXCEPTION 'A player cannot bet against their own performance (anti-tanking)';
    END IF;
  END IF;

  -- Team markets: no backing the under (or laying the over) on a team the bettor
  -- is rostered on this week (betting your own team to do poorly).
  IF v_market_type = 'team_prop'
     AND ((NEW.side = 'back' AND v_side = 'under') OR (NEW.side = 'lay' AND v_side = 'over')) THEN
    IF EXISTS (
      SELECT 1 FROM public.team_slots ts
      WHERE ts.team_id = (v_params ->> 'team_id')::uuid
        AND ts.player_id = v_bettor
        AND ts.is_fill = false
    ) THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own team (anti-tanking)';
    END IF;
  END IF;

  -- Combo markets: no backing the under (or laying the over) on a combo whose
  -- member set contains the bettor. Backing your own over stays allowed.
  IF v_market_type = 'combo'
     AND ((NEW.side = 'back' AND v_side = 'under') OR (NEW.side = 'lay' AND v_side = 'over'))
     AND (v_params -> 'member_ids') ? v_bettor::text THEN
    RAISE EXCEPTION 'A player cannot bet against a combo containing themselves (anti-tanking)';
  END IF;

  RETURN NEW;
END;
$function$
;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. counter_pvp_challenge — prop-duel counterparty = same rung, opposite side
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.counter_pvp_challenge(p_challenge_id uuid, p_creator_stake integer, p_counterparty_stake integer, p_contract_type text, p_game_number integer, p_prop_market_id uuid, p_selection text, p_message text, p_creator_handicap integer, p_counterparty_handicap integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_id             uuid;
  v_challenge             public.pvp_challenges;
  v_offer                 record;
  v_next_offer_no         int;
  v_total_pot             int;
  v_counterparty_sel      text;
  v_subject_id            uuid;
  v_game_number           int;
  v_my_stake              int;
  v_resolved_cparty       uuid;
  v_creator_line          numeric;
  v_counterparty_line     numeric;
  v_creator_handicap      int := 0;
  v_counterparty_handicap int := 0;
BEGIN
  SELECT id INTO v_caller_id FROM public.players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('pending', 'countered') THEN
    RAISE EXCEPTION 'Challenge is not in a negotiable state';
  END IF;
  IF v_challenge.counterparty_player_id IS NOT NULL
     AND v_caller_id <> v_challenge.creator_player_id
     AND v_caller_id <> v_challenge.counterparty_player_id THEN
    RAISE EXCEPTION 'You are not a party to this challenge';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot counter your own offer — wait for the other party';
  END IF;

  -- Both stakes must clear the floor; balance-check only the caller's own side
  -- (creator side if the caller is the creator, otherwise the counterparty side).
  IF p_creator_stake IS NULL OR p_creator_stake < 10
     OR p_counterparty_stake IS NULL OR p_counterparty_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins per side';
  END IF;
  v_my_stake := CASE WHEN v_caller_id = v_challenge.creator_player_id
                     THEN p_creator_stake ELSE p_counterparty_stake END;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_caller_id AND season_id = v_challenge.season_id;
    IF v_balance < v_my_stake THEN
      RAISE EXCEPTION 'Insufficient balance for the requested stake';
    END IF;
  END;

  v_game_number := p_game_number;

  IF p_contract_type IN ('line_duel', 'head_to_head') THEN
    IF p_game_number IS NULL OR p_game_number < 1 THEN
      RAISE EXCEPTION 'game_number is required for line_duel and head_to_head';
    END IF;
    v_counterparty_sel := NULL;
    v_subject_id       := NULL;
  ELSIF p_contract_type = 'prop_duel' THEN
    IF p_prop_market_id IS NULL THEN
      RAISE EXCEPTION 'prop_market_id is required for prop_duel';
    END IF;
    IF p_selection IS NULL THEN
      RAISE EXCEPTION 'selection is required for prop_duel';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets WHERE id = p_prop_market_id AND status = 'open'
    ) THEN
      RAISE EXCEPTION 'Prop market not found or not open';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_selections WHERE market_id = p_prop_market_id AND key = p_selection
    ) THEN
      RAISE EXCEPTION 'selection is not a valid key for this market';
    END IF;
    SELECT s2.key INTO v_counterparty_sel
      FROM public.bet_selections s1
      JOIN public.bet_selections s2
        ON s2.market_id = s1.market_id
       AND s2.id <> s1.id
       AND s2.line IS NOT DISTINCT FROM s1.line
       AND (s1.side IS NULL OR s2.side IS DISTINCT FROM s1.side)
      WHERE s1.market_id = p_prop_market_id AND s1.key = p_selection
      LIMIT 1;
    SELECT subject_player_id INTO v_subject_id
      FROM public.bet_markets WHERE id = p_prop_market_id;
  ELSIF p_contract_type = 'custom' THEN
    -- Free-form: no game/market. Title/description remain as the creator set them.
    v_counterparty_sel := NULL;
    v_subject_id       := NULL;
    v_game_number      := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- Resolve who the counterparty is after this counter (an open board is taken by
  -- the caller), then (re)snapshot Line Duel lines for both current parties.
  v_resolved_cparty := CASE
    WHEN v_challenge.counterparty_player_id IS NULL AND v_caller_id <> v_challenge.creator_player_id
      THEN v_caller_id
    ELSE v_challenge.counterparty_player_id
  END;

  IF p_contract_type = 'line_duel' THEN
    v_creator_line := public.pvp_player_line(v_challenge.creator_player_id, v_challenge.season_id);
    IF v_resolved_cparty IS NOT NULL THEN
      v_counterparty_line := public.pvp_player_line(v_resolved_cparty, v_challenge.season_id);
    END IF;
  END IF;

  -- Head-to-Head handicaps are renegotiated like the stakes (role-fixed). Forced
  -- to 0 for every other type.
  IF p_contract_type = 'head_to_head' THEN
    v_creator_handicap      := COALESCE(p_creator_handicap, 0);
    v_counterparty_handicap := COALESCE(p_counterparty_handicap, 0);
  END IF;

  -- Winner takes the whole pot.
  v_total_pot := p_creator_stake + p_counterparty_stake;
  v_next_offer_no := v_offer.offer_no + 1;

  UPDATE public.pvp_challenge_offers SET superseded_at = now() WHERE id = v_offer.id;

  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    p_challenge_id, v_caller_id, v_next_offer_no, p_contract_type,
    p_creator_stake, p_counterparty_stake, v_game_number,
    p_prop_market_id, p_selection, v_counterparty_sel,
    p_message
  );

  UPDATE public.pvp_challenges SET
    status                 = 'countered',
    contract_type          = p_contract_type,
    creator_stake          = p_creator_stake,
    counterparty_stake     = p_counterparty_stake,
    total_pot              = v_total_pot,
    payout_amount          = v_total_pot,
    game_number            = v_game_number,
    creator_line           = v_creator_line,
    counterparty_line      = v_counterparty_line,
    creator_handicap       = v_creator_handicap,
    counterparty_handicap  = v_counterparty_handicap,
    prop_market_id         = p_prop_market_id,
    creator_selection      = CASE WHEN p_contract_type = 'prop_duel' THEN p_selection        ELSE NULL END,
    counterparty_selection = CASE WHEN p_contract_type = 'prop_duel' THEN v_counterparty_sel ELSE NULL END,
    subject_player_id      = v_subject_id,
    counterparty_player_id = v_resolved_cparty
  WHERE id = p_challenge_id;

  RETURN p_challenge_id;
END;
$function$
;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. create_pvp_challenge — same counterparty fix
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pvp_challenge(p_contract_type text, p_counterparty_player_id uuid, p_week_id uuid, p_game_number integer, p_creator_stake integer, p_counterparty_stake integer, p_prop_market_id uuid, p_creator_selection text, p_message text, p_custom_title text, p_custom_description text, p_creator_handicap integer, p_counterparty_handicap integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_creator_id            uuid;
  v_season_id             uuid;
  v_week                  record;
  v_total_pot             int;
  v_counterparty_sel      text;
  v_subject_player_id     uuid;
  v_game_number           int;
  v_challenge_id          uuid;
  v_market                record;
  v_creator_line          numeric;
  v_counterparty_line     numeric;
  v_creator_handicap      int := 0;
  v_counterparty_handicap int := 0;
BEGIN
  -- 1. Resolve caller.
  SELECT id INTO v_creator_id FROM public.players WHERE user_id = auth.uid();
  IF v_creator_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  -- 2. Resolve current season and validate week.
  SELECT id INTO v_season_id FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL OR v_week.season_id <> v_season_id THEN
    RAISE EXCEPTION 'Week not found in current season';
  END IF;
  IF v_week.is_archived THEN
    RAISE EXCEPTION 'Cannot create a contract for an archived week';
  END IF;

  -- 3. Validate stakes. Both sides must clear the 10-pin floor; only the creator's
  --    balance is checked here (the counterparty's is checked at accept time).
  IF p_creator_stake IS NULL OR p_creator_stake < 10
     OR p_counterparty_stake IS NULL OR p_counterparty_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins per side';
  END IF;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_creator_id AND season_id = v_season_id;
    IF v_balance < p_creator_stake THEN
      RAISE EXCEPTION 'Insufficient balance for the requested stake';
    END IF;
  END;

  -- 4. Validate counterparty and contract-type scope.
  IF p_counterparty_player_id IS NOT NULL THEN
    IF p_counterparty_player_id = v_creator_id THEN
      RAISE EXCEPTION 'Cannot challenge yourself';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_counterparty_player_id) THEN
      RAISE EXCEPTION 'Counterparty player not found';
    END IF;
  END IF;

  v_game_number := p_game_number;

  IF p_contract_type IN ('line_duel', 'head_to_head') THEN
    IF p_game_number IS NULL OR p_game_number < 1 THEN
      RAISE EXCEPTION 'game_number is required for line_duel and head_to_head';
    END IF;
  ELSIF p_contract_type = 'prop_duel' THEN
    IF p_prop_market_id IS NULL THEN
      RAISE EXCEPTION 'prop_market_id is required for prop_duel';
    END IF;
    SELECT * INTO v_market
      FROM public.bet_markets
      WHERE id = p_prop_market_id;
    IF v_market.id IS NULL THEN
      RAISE EXCEPTION 'Prop market not found';
    END IF;
    IF v_market.status <> 'open' THEN
      RAISE EXCEPTION 'Prop market is not open';
    END IF;
    IF p_creator_selection IS NULL THEN
      RAISE EXCEPTION 'creator_selection is required for prop_duel';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key = p_creator_selection
    ) THEN
      RAISE EXCEPTION 'creator_selection is not a valid key for this market';
    END IF;
    SELECT s2.key INTO v_counterparty_sel
      FROM public.bet_selections s1
      JOIN public.bet_selections s2
        ON s2.market_id = s1.market_id
       AND s2.id <> s1.id
       AND s2.line IS NOT DISTINCT FROM s1.line
       AND (s1.side IS NULL OR s2.side IS DISTINCT FROM s1.side)
      WHERE s1.market_id = p_prop_market_id AND s1.key = p_creator_selection
      LIMIT 1;
    IF v_counterparty_sel IS NULL THEN
      RAISE EXCEPTION 'Could not derive counterparty selection for prop_duel';
    END IF;
    v_subject_player_id := v_market.subject_player_id;
  ELSIF p_contract_type = 'custom' THEN
    -- Free-form, week-level: no game, no market. The win condition is the text.
    IF p_custom_title IS NULL OR length(trim(p_custom_title)) = 0
       OR p_custom_description IS NULL OR length(trim(p_custom_description)) = 0 THEN
      RAISE EXCEPTION 'Custom contracts require a title and a win-condition description';
    END IF;
    v_game_number := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- 4b. Snapshot Line Duel lines now so the terms are visible during negotiation.
  --     Creator's line is always known; the counterparty's is known only for a
  --     named opponent (open board fills it when a taker engages).
  IF p_contract_type = 'line_duel' THEN
    v_creator_line := public.pvp_player_line(v_creator_id, v_season_id);
    IF p_counterparty_player_id IS NOT NULL THEN
      v_counterparty_line := public.pvp_player_line(p_counterparty_player_id, v_season_id);
    END IF;
  END IF;

  -- 4c. Head-to-Head handicaps are creator-defined terms (signed pins, 0 = none),
  --     known for both sides up front even on an open board. Forced to 0 otherwise.
  IF p_contract_type = 'head_to_head' THEN
    v_creator_handicap      := COALESCE(p_creator_handicap, 0);
    v_counterparty_handicap := COALESCE(p_counterparty_handicap, 0);
  END IF;

  -- 5. Compute financials and insert challenge. Winner takes the whole pot.
  v_total_pot := p_creator_stake + p_counterparty_stake;

  INSERT INTO public.pvp_challenges (
    contract_type, status, creator_player_id, counterparty_player_id,
    season_id, week_id, game_number,
    creator_stake, counterparty_stake, total_pot, payout_amount,
    creator_line, counterparty_line,
    creator_handicap, counterparty_handicap,
    prop_market_id, creator_selection, counterparty_selection, subject_player_id,
    creator_message, custom_title, custom_description
  ) VALUES (
    p_contract_type, 'pending', v_creator_id, p_counterparty_player_id,
    v_season_id, p_week_id, v_game_number,
    p_creator_stake, p_counterparty_stake, v_total_pot, v_total_pot,
    v_creator_line, v_counterparty_line,
    v_creator_handicap, v_counterparty_handicap,
    p_prop_market_id, p_creator_selection, v_counterparty_sel, v_subject_player_id,
    p_message,
    CASE WHEN p_contract_type = 'custom' THEN trim(p_custom_title)       ELSE NULL END,
    CASE WHEN p_contract_type = 'custom' THEN trim(p_custom_description) ELSE NULL END
  ) RETURNING id INTO v_challenge_id;

  -- 6. Insert the original offer (offer_no = 1, snapshot of terms).
  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    v_challenge_id, v_creator_id, 1, p_contract_type,
    p_creator_stake, p_counterparty_stake, v_game_number,
    p_prop_market_id, p_creator_selection, v_counterparty_sel,
    p_message
  );

  RETURN v_challenge_id;
END;
$function$
;
