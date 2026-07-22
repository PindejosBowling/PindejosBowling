-- ─────────────────────────────────────────────────────────────────────────────
-- Value-first lines (1 of 2): on-demand pricing for ANY half-point line.
--
-- The board's value-first entry ("type the number you want to beat") needs the
-- server to price arbitrary lines live — the client never holds a player's
-- mean/variance. Adds:
--   • odds_engine_config knobs: custom_odds_min/max (the typed-line sanity
--     band; NULL = fall back to odds_min/odds_max, i.e. the alt-rung mint
--     criterion) and quote_tolerance (how far a client-quoted price may drift
--     from the fresh server price before placement rejects — used in 2 of 2).
--   • odds_engine_norm_ppf — inverse normal CDF (Acklam), so the priceable
--     band's edge lines come out in closed form for the UI's steppers.
--   • odds_engine_market_distribution — internal: one market_id → the
--     (mean, variance, n_games, range) the generators would price it with.
--   • market_price_line(market_id, line) — client-facing preview: posted rungs
--     echo their posted odds verbatim (frozen ladders are never re-quoted);
--     unposted half-point lines price fresh inside the custom band; returns
--     {line, odds, posted, seed_line, min_line, max_line} and NEVER the
--     underlying distribution.
--   • combo_price_line(...) — the same for a combo member set, extending the
--     combo_preview_ladder dedup semantics (posted rungs win on an existing
--     market; unposted lines now price fresh — the mint happens at compose).
--
-- No placement changes here (2 of 2); nothing calls these RPCs yet.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Config knobs ────────────────────────────────────────────────────────────
ALTER TABLE public.odds_engine_config
  ADD COLUMN custom_odds_min numeric,
  ADD COLUMN custom_odds_max numeric,
  ADD COLUMN quote_tolerance numeric NOT NULL DEFAULT 0.10,
  ADD CONSTRAINT odds_engine_config_custom_clamp_check
    CHECK (custom_odds_min IS NULL OR custom_odds_max IS NULL
           OR (custom_odds_min > 1.0 AND custom_odds_max > custom_odds_min)),
  -- Posted odds round to 0.05 steps — a tolerance below that would flap on
  -- legitimate quotes at the rounding boundary.
  ADD CONSTRAINT odds_engine_config_quote_tolerance_check
    CHECK (quote_tolerance >= 0.05);

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
    v_cfg.quote_tolerance      := 0.10;
  END IF;
  RETURN v_cfg;
END;
$function$;

-- 2. Inverse normal CDF ──────────────────────────────────────────────────────
-- Φ⁻¹(p) via Acklam's rational approximation (|ε| < 1.15e-9) — the closed-form
-- companion to odds_engine_norm_cdf, used to turn the odds band into line
-- bounds: line = μ + Φ⁻¹(1 − p_over)·σ.
CREATE OR REPLACE FUNCTION public.odds_engine_norm_ppf(p double precision)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  q double precision;
  r double precision;
BEGIN
  IF p <= 0 OR p >= 1 THEN
    RAISE EXCEPTION 'norm_ppf requires p in (0, 1), got %', p;
  END IF;

  IF p < 0.02425 THEN
    q := sqrt(-2 * ln(p));
    RETURN (((((-7.784894002430293e-03 * q - 3.223964580411365e-01) * q
               - 2.400758277161838e+00) * q - 2.549732539343734e+00) * q
               + 4.374664141464968e+00) * q + 2.938163982698783e+00)
         / ((((7.784695709041462e-03 * q + 3.224671290700398e-01) * q
               + 2.445134137142996e+00) * q + 3.754408661907416e+00) * q + 1.0);
  ELSIF p > 1 - 0.02425 THEN
    q := sqrt(-2 * ln(1 - p));
    RETURN -((((((-7.784894002430293e-03 * q - 3.223964580411365e-01) * q
               - 2.400758277161838e+00) * q - 2.549732539343734e+00) * q
               + 4.374664141464968e+00) * q + 2.938163982698783e+00)
         / ((((7.784695709041462e-03 * q + 3.224671290700398e-01) * q
               + 2.445134137142996e+00) * q + 3.754408661907416e+00) * q + 1.0));
  ELSE
    q := p - 0.5;
    r := q * q;
    RETURN (((((-3.969683028665376e+01 * r + 2.209460984245205e+02) * r
               - 2.759285104469687e+02) * r + 1.383577518672690e+02) * r
               - 3.066479806614716e+01) * r + 2.506628277459239e+00) * q
         / (((((-5.447609879822406e+01 * r + 1.615858368580409e+02) * r
               - 1.556989798598866e+02) * r + 6.680131188771972e+01) * r
               - 1.328068155288572e+01) * r + 1.0);
  END IF;
END;
$function$;

-- 3. Per-market distribution ─────────────────────────────────────────────────
-- One market_id → the exact (mean, variance, n_games, possible range) the
-- generators price that market with. Internal only: exposing mean/variance
-- would hand players the model.
CREATE OR REPLACE FUNCTION public.odds_engine_market_distribution(p_market_id uuid,
  OUT mean numeric, OUT variance numeric, OUT n_games integer,
  OUT range_lo numeric, OUT range_hi numeric, OUT season_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt        public.bet_markets;
  v_week_games integer;
  v_stat       text;
  v_scope      text;
  v_members    uuid[];
BEGIN
  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  SELECT w.season_id INTO season_id FROM public.weeks w WHERE w.id = v_mkt.week_id;

  -- Week schedule size (night scopes): the games table once it exists, else
  -- the pre-teams default of 2 — the same policy as every sync generator.
  SELECT COUNT(DISTINCT g.game_number) INTO v_week_games
    FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = v_mkt.week_id;
  IF v_week_games IS NULL OR v_week_games = 0 THEN
    v_week_games := 2;
  END IF;

  IF v_mkt.market_type = 'over_under' THEN
    SELECT ps.mean, ps.variance INTO mean, variance
      FROM public.odds_engine_player_stat(v_mkt.subject_player_id, season_id, 'score') ps;
    IF v_mkt.game_number IS NOT NULL THEN
      n_games := 1;            range_lo := 0.5; range_hi := 299.5;
    ELSE
      n_games := v_week_games; range_lo := 0.5; range_hi := 300 * v_week_games - 0.5;
    END IF;

  ELSIF v_mkt.market_type = 'prop' THEN
    v_stat := v_mkt.params ->> 'stat';
    IF v_stat IS NULL OR v_stat NOT IN ('strikes', 'spares', 'clean_frames') THEN
      RAISE EXCEPTION 'Market stat % is not priceable', COALESCE(v_stat, '(null)');
    END IF;
    SELECT ps.mean, ps.variance INTO mean, variance
      FROM public.odds_engine_player_stat(v_mkt.subject_player_id, season_id, v_stat) ps;
    IF v_mkt.game_number IS NOT NULL THEN
      n_games := 1;            range_lo := 0.5; range_hi := 9.5;
    ELSE
      n_games := v_week_games; range_lo := 0.5; range_hi := 10 * v_week_games - 0.5;
    END IF;

  ELSIF v_mkt.market_type = 'combo' THEN
    v_stat := v_mkt.params ->> 'stat';
    v_scope := v_mkt.params ->> 'scope';
    SELECT array_agg((m.value)::uuid) INTO v_members
      FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') m;
    IF v_members IS NULL OR v_stat IS NULL
       OR v_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
      RAISE EXCEPTION 'Combo market % has no priceable params', p_market_id;
    END IF;
    -- Members modeled independent: per-game means and variances add.
    SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
      INTO mean, variance
      FROM (SELECT DISTINCT m FROM unnest(v_members) m) mem
      CROSS JOIN LATERAL public.odds_engine_player_stat(
        mem.m, season_id,
        CASE WHEN v_stat = 'total_pins' THEN 'score' ELSE v_stat END) ps;
    n_games := CASE WHEN v_scope = 'game' THEN 1 ELSE v_week_games END;
    range_lo := 0.5;
    range_hi := CASE WHEN v_stat = 'total_pins'
                     THEN 300 * n_games * array_length(v_members, 1) - 0.5
                     ELSE 10 * n_games * array_length(v_members, 1) - 0.5 END;

  ELSE
    RAISE EXCEPTION 'Market type % is not priceable', v_mkt.market_type;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.odds_engine_market_distribution(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Shared quote assembly ───────────────────────────────────────────────────
-- Prices one half-point line against a distribution + band and builds the
-- client payload. Half-point band edges are snapped INWARD from the raw
-- (μ + Φ⁻¹·σ) bounds, then intersected with the stat's possible range; a
-- degenerate band collapses onto the seed line.
CREATE OR REPLACE FUNCTION public.odds_engine_quote_internal(
  p_line numeric, p_seed_line numeric, p_seed_odds numeric, p_posted_odds numeric,
  p_enabled boolean, p_mean numeric, p_variance numeric, p_n_games integer,
  p_range_lo numeric, p_range_hi numeric, p_odds_min numeric, p_odds_max numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_mu       numeric;
  v_sigma    numeric;
  v_p_lo     double precision;
  v_p_hi     double precision;
  v_min_line numeric;
  v_max_line numeric;
  v_odds     numeric;
  v_under    numeric;
BEGIN
  IF NOT p_enabled OR p_mean IS NULL OR p_variance IS NULL OR p_variance <= 0 THEN
    -- Engine off (or no distribution): only posted lines are priceable — the
    -- band collapses to the seed and unposted lines return odds NULL.
    RETURN jsonb_build_object(
      'line', p_line,
      'odds', COALESCE(p_posted_odds, CASE WHEN p_line = p_seed_line THEN p_seed_odds END),
      'posted', p_posted_odds IS NOT NULL OR p_line = p_seed_line,
      'seed_line', p_seed_line, 'seed_odds', p_seed_odds,
      'min_line', p_seed_line, 'max_line', p_seed_line);
  END IF;

  v_mu    := p_mean * GREATEST(p_n_games, 1);
  v_sigma := sqrt(p_variance * GREATEST(p_n_games, 1));

  -- Both sides of the zero-vig pair must land in [odds_min, odds_max]:
  -- p_over ∈ [max(1/o_max, 1 − 1/o_min), min(1 − 1/o_max, 1/o_min)].
  v_p_lo := GREATEST(1.0 / p_odds_max, 1.0 - 1.0 / p_odds_min);
  v_p_hi := LEAST(1.0 - 1.0 / p_odds_max, 1.0 / p_odds_min);

  -- p_over falls as the line rises: p_hi bounds the low edge, p_lo the high.
  v_min_line := ceil((v_mu + public.odds_engine_norm_ppf(1.0 - v_p_hi) * v_sigma)::numeric - 0.5) + 0.5;
  v_max_line := floor((v_mu + public.odds_engine_norm_ppf(1.0 - v_p_lo) * v_sigma)::numeric + 0.5) - 0.5;
  v_min_line := GREATEST(v_min_line, p_range_lo);
  v_max_line := LEAST(v_max_line, p_range_hi);
  IF v_min_line > v_max_line THEN
    v_min_line := p_seed_line;
    v_max_line := p_seed_line;
  END IF;

  IF p_posted_odds IS NOT NULL THEN
    -- Posted rungs are the book's standing offer — echoed verbatim, never
    -- re-quoted (a frozen market's rungs keep their frozen price).
    v_odds := p_posted_odds;
  ELSIF p_line < p_range_lo OR p_line > p_range_hi THEN
    v_odds := NULL;
  ELSE
    SELECT pp.over_odds, pp.under_odds INTO v_odds, v_under
      FROM public.odds_engine_price_pair(p_mean, p_variance, p_n_games, p_line,
                                         p_odds_min, p_odds_max, false) pp;
  END IF;

  RETURN jsonb_build_object(
    'line', p_line,
    'odds', v_odds,
    'posted', p_posted_odds IS NOT NULL,
    'seed_line', p_seed_line, 'seed_odds', p_seed_odds,
    'min_line', v_min_line, 'max_line', v_max_line);
END;
$function$;

REVOKE ALL ON FUNCTION public.odds_engine_quote_internal(numeric, numeric, numeric, numeric, boolean, numeric, numeric, integer, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- 5. market_price_line ───────────────────────────────────────────────────────
-- The single-market preview RPC behind the board's value editor. NULL line →
-- the seed rung (the pill's anchor). Returns only prices + band — never the
-- underlying mean/variance.
CREATE OR REPLACE FUNCTION public.market_price_line(p_market_id uuid, p_line numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt       public.bet_markets;
  v_seed_line numeric;
  v_seed_odds numeric;
  v_posted    numeric;
  v_line      numeric;
  v_cfg       public.odds_engine_config;
  v_d         record;
BEGIN
  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_mkt.market_type NOT IN ('over_under', 'prop', 'combo') THEN
    RAISE EXCEPTION 'Market type % is not priceable', v_mkt.market_type;
  END IF;
  -- Closed markets still preview (the client gates staging on status);
  -- settled/void ones have nothing left to quote.
  IF v_mkt.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market is no longer quotable';
  END IF;

  SELECT s.line, s.odds INTO v_seed_line, v_seed_odds
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.key = 'over';
  IF v_seed_line IS NULL THEN
    RAISE EXCEPTION 'Market has no seed selection';
  END IF;

  v_line := COALESCE(p_line, v_seed_line);
  IF v_line <> floor(v_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', v_line;
  END IF;

  SELECT s.odds INTO v_posted
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;

  SELECT * INTO v_d FROM public.odds_engine_market_distribution(p_market_id);
  v_cfg := public.odds_engine_get_config(v_d.season_id);

  RETURN public.odds_engine_quote_internal(
    v_line, v_seed_line, v_seed_odds, v_posted,
    v_cfg.is_enabled, v_d.mean, v_d.variance, v_d.n_games,
    v_d.range_lo, v_d.range_hi,
    COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
    COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.market_price_line(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.market_price_line(uuid, numeric) TO authenticated;

-- 6. combo_price_line ────────────────────────────────────────────────────────
-- Value-at-line preview for the combo BuilderBar. Same dedup posture as
-- combo_preview_ladder: an existing open market's posted rungs echo verbatim
-- and its seed anchors the editor; an UNPOSTED line on an existing market now
-- prices fresh (the rung is minted at compose time, 2 of 2). No market yet →
-- seed via combo_seed_line and price from the summed member distributions.
CREATE OR REPLACE FUNCTION public.combo_price_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1, p_week_id uuid DEFAULT NULL, p_game_number integer DEFAULT NULL, p_line numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_members      uuid[];
  v_member_texts text[];
  v_scope        text;
  v_combo_key    text;
  v_mkt          uuid;
  v_seed_line    numeric;
  v_seed_odds    numeric;
  v_posted       numeric;
  v_line         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_hi           numeric;
  v_cn           integer := GREATEST(COALESCE(p_n_games, 1), 1);
BEGIN
  IF p_stat IS NULL OR p_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
    RAISE EXCEPTION 'Unknown combo stat %', COALESCE(p_stat, '(null)');
  END IF;

  SELECT array_agg(m ORDER BY m) INTO v_members
    FROM (SELECT DISTINCT m FROM unnest(COALESCE(p_member_ids, '{}')) m) d;
  IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
    RAISE EXCEPTION 'A combo needs at least two distinct players';
  END IF;

  -- Existing open combo for the same key → its seed anchors the editor and
  -- its posted rungs echo verbatim.
  IF p_week_id IS NOT NULL THEN
    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    v_scope := CASE WHEN p_game_number IS NULL THEN 'night' ELSE 'game' END;
    v_combo_key := p_stat || '|' || v_scope || '|' || COALESCE(p_game_number::text, 'n')
                   || '|' || array_to_string(v_member_texts, ',');
    SELECT m.id INTO v_mkt
      FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'combo'
        AND m.status = 'open' AND m.params ->> 'combo_key' = v_combo_key;
  END IF;

  IF v_mkt IS NOT NULL THEN
    SELECT s.line, s.odds INTO v_seed_line, v_seed_odds
      FROM public.bet_selections s
      WHERE s.market_id = v_mkt AND s.key = 'over';
  ELSE
    v_seed_line := public.combo_seed_line(v_members, p_stat, p_season_id, v_cn);
  END IF;

  v_line := COALESCE(p_line, v_seed_line);
  IF v_line <> floor(v_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', v_line;
  END IF;

  IF v_mkt IS NOT NULL THEN
    SELECT s.odds INTO v_posted
      FROM public.bet_selections s
      WHERE s.market_id = v_mkt AND s.side = 'over' AND s.line = v_line;
  END IF;

  SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
    INTO v_mean, v_var
    FROM unnest(v_members) mem(m)
    CROSS JOIN LATERAL public.odds_engine_player_stat(
      mem.m, p_season_id,
      CASE WHEN p_stat = 'total_pins' THEN 'score' ELSE p_stat END) ps;

  v_cfg := public.odds_engine_get_config(p_season_id);
  v_hi := CASE WHEN p_stat = 'total_pins'
               THEN 300 * v_cn * array_length(v_members, 1) - 0.5
               ELSE 10 * v_cn * array_length(v_members, 1) - 0.5 END;

  RETURN public.odds_engine_quote_internal(
    v_line, v_seed_line, v_seed_odds, v_posted,
    v_cfg.is_enabled, v_mean, NULLIF(v_var, 0), v_cn,
    0.5, v_hi,
    COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
    COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.combo_price_line(uuid[], text, uuid, integer, uuid, integer, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.combo_price_line(uuid[], text, uuid, integer, uuid, integer, numeric) TO authenticated;
