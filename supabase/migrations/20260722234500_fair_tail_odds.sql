-- ─────────────────────────────────────────────────────────────────────────────
-- Fair long-tail odds: remove the odds-feasibility clamp entirely.
--
-- Availability is decided ONLY by the acceptable line range (the physical
-- caps from odds_engine_market_distribution: counts 9.5/game, pins 220/game).
-- Every half-point inside that range now prices at the FAIR zero-vig odds for
-- the model — no more ×8 ceiling on long-tail lines and no odds_min lift
-- (a 9-strikes flier pays its true ×dozens, and near-certain lines price at
-- ~×1.05, the smallest storable 0.05-grid step: bet_selections CHECK
-- odds > 1.0). odds_min/odds_max/custom_odds_min/custom_odds_max in
-- odds_engine_config and price_pair's p_force are now INERT (kept for
-- signature/schema compatibility). Ladder generation consequently posts its
-- full rung spread (unpriceable-rung skipping is gone).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── odds_engine_price_pair ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.odds_engine_price_pair(p_mean numeric, p_variance numeric, p_n_games integer, p_line numeric, p_odds_min numeric, p_odds_max numeric, p_force boolean, OUT over_odds numeric, OUT under_odds numeric)
 RETURNS record
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

  -- No odds-feasibility clamp: every line prices FAIR (zero-vig), rounded to
  -- the 0.05 grid; 1.05 is the smallest storable grid step (bet_selections
  -- CHECK odds > 1.0). Availability is the CALLER's business (its acceptable
  -- line range) — never this function's. p_odds_min / p_odds_max / p_force
  -- are retained for signature compatibility and ignored.
  over_odds  := GREATEST(1.05, round(v_over  * 20) / 20);
  under_odds := GREATEST(1.05, round(v_under * 20) / 20);
END;
$function$
;

-- ── odds_engine_quote_internal ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.odds_engine_quote_internal(p_line numeric, p_seed_line numeric, p_seed_odds numeric, p_posted_odds numeric, p_enabled boolean, p_mean numeric, p_variance numeric, p_n_games integer, p_range_lo numeric, p_range_hi numeric, p_odds_min numeric, p_odds_max numeric)
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

  -- No odds-feasibility clamp: the acceptable band IS the caller's range
  -- (the stat's physical caps) and every half-point inside it prices fair.
  v_min_line := p_range_lo;
  v_max_line := p_range_hi;
  IF v_min_line > v_max_line THEN
    v_min_line := p_seed_line;
    v_max_line := p_seed_line;
  END IF;
  -- The seed is always offered (the minter forces it), so the selectable band
  -- must contain it even when the raw odds band doesn't.
  v_min_line := LEAST(v_min_line, p_seed_line);
  v_max_line := GREATEST(v_max_line, p_seed_line);

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
$function$
;

-- ── bet_mint_rung_internal ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bet_mint_rung_internal(p_market_id uuid, p_line numeric, p_quoted_odds numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt      public.bet_markets;
  v_line     numeric;
  v_cfg      public.odds_engine_config;
  v_d        record;
  v_sel      record;
  v_over     numeric;
  v_under    numeric;
BEGIN
  IF p_quoted_odds IS NULL OR p_quoted_odds <= 1.0 THEN
    RAISE EXCEPTION 'A quoted price is required to take a line';
  END IF;

  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_mkt.status <> 'open' THEN
    RAISE EXCEPTION 'A selected market is not open';
  END IF;

  IF p_line IS NULL OR p_line <> floor(p_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', p_line;
  END IF;
  -- Canonical numeric text: '4.50'::numeric and '4.5'::numeric must build the
  -- SAME 'over:<line>' key the ladder minter builds (its lines come out of
  -- seed + j × spacing arithmetic, minimal scale).
  v_line := trim_scale(p_line);

  SELECT * INTO v_d FROM public.odds_engine_market_distribution(p_market_id);
  v_cfg := public.odds_engine_get_config(v_d.season_id);

  -- Posted rung → the book's standing offer wins; the quote just has to
  -- agree with it within tolerance.
  SELECT s.id, s.odds INTO v_sel
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;
  IF v_sel.id IS NOT NULL THEN
    IF abs(v_sel.odds - p_quoted_odds) > v_cfg.quote_tolerance THEN
      RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_sel.odds;
    END IF;
    RETURN v_sel.id;
  END IF;

  -- Fresh mint: price inside the custom band; out-of-band lines are simply
  -- not offered. Engine off → nothing beyond the posted pair is offered.
  IF NOT v_cfg.is_enabled THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  IF v_line < v_d.range_lo OR v_line > v_d.range_hi THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
    FROM public.odds_engine_price_pair(v_d.mean, v_d.variance, v_d.n_games, v_line,
                                       COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
                                       COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max),
                                       false) pp;
  IF v_over IS NULL THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  IF abs(v_over - p_quoted_odds) > v_cfg.quote_tolerance THEN
    RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_over;
  END IF;

  -- Mint the PAIR at the fresh price. sort_order 100 + 2·line keeps custom
  -- rungs stable, collision-free (half-point lines step in whole units of
  -- 2·line), and after the generated ladder's 0..13; the client orders by
  -- line anyway.
  INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side)
    VALUES
      (p_market_id, 'over:'  || v_line, 'Over',  v_over,  v_line, 100 + (v_line * 2)::integer, 'over'),
      (p_market_id, 'under:' || v_line, 'Under', v_under, v_line, 101 + (v_line * 2)::integer, 'under')
    ON CONFLICT (market_id, key) DO NOTHING;

  -- Re-read: on a concurrent mint the unique constraint arbitrates and the
  -- winner's posted price stands — tolerance-check it like any posted rung.
  SELECT s.id, s.odds INTO v_sel
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;
  IF v_sel.id IS NULL THEN
    RAISE EXCEPTION 'Could not mint the requested line';
  END IF;
  IF abs(v_sel.odds - p_quoted_odds) > v_cfg.quote_tolerance THEN
    RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_sel.odds;
  END IF;
  RETURN v_sel.id;
END;
$function$
;

