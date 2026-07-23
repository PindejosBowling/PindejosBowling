-- ─────────────────────────────────────────────────────────────────────────────
-- Offer floor: the band's low edge is the first line paying ×1.20.
--
-- Fair pricing stays (…234500_fair_tail_odds unchanged: no ceiling, true
-- model odds), but lines whose fair multiplier falls below odds_min are no
-- longer OFFERED: the quote's min_line advertises the edge (the sheet's
-- "Acceptable:" range follows automatically), quotes below it return odds
-- NULL, and the minter rejects them at placement (closing the ~×1.05
-- near-certainty dribble at the RPC layer, not just the UI). odds_min is
-- repurposed from the retired feasibility clamp as this knob and set to
-- 1.20 (custom_odds_min still resolves first if ever set; odds_max stays
-- inert). Posted rungs keep echoing verbatim as the book's standing offers.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- The HIGH edge is the stat's physical cap; the LOW edge is the smallest
  -- half-point paying the configured minimum multiplier (odds_min → 1.20):
  -- p_over ≤ 1/odds_min ⇔ line ≥ μ + Φ⁻¹(1 − 1/odds_min)·σ. Prices stay
  -- FAIR everywhere inside the band — this is an offer floor, not a clamp.
  v_min_line := ceil((v_mu + public.odds_engine_norm_ppf(1.0 - 1.0 / p_odds_min) * v_sigma)::numeric - 0.5) + 0.5;
  v_min_line := GREATEST(v_min_line, p_range_lo);
  v_min_line := LEAST(v_min_line, p_range_hi);
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
  ELSIF p_line < v_min_line OR p_line > v_max_line THEN
    -- Below the offer floor / outside the physical caps: not offered (the
    -- seed-containment above keeps the seed itself quotable).
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
  -- The offer floor: the smallest line paying the configured minimum
  -- multiplier — the SAME edge odds_engine_quote_internal advertises as
  -- min_line (posted rungs above were already reused verbatim; the seed is
  -- always posted, so seed-containment needs no special case here).
  IF v_line < ceil((v_d.mean * GREATEST(v_d.n_games, 1)
                    + public.odds_engine_norm_ppf(1.0 - 1.0 / COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min))
                      * sqrt(v_d.variance * GREATEST(v_d.n_games, 1)))::numeric - 0.5) + 0.5 THEN
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

-- ── odds_engine_build_ladder ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.odds_engine_build_ladder(p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS TABLE(key text, label text, odds numeric, line numeric, sort_order integer, side text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    RETURN QUERY VALUES
      ('over',  'Over',  2.000::numeric, p_seed_line, 0, 'over'),
      ('under', 'Under', 2.000::numeric, p_seed_line, 1, 'under');
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
    IF v_over IS NULL OR (j <> 0 AND v_over < v_cfg.odds_min) THEN
      CONTINUE;  -- below the offer floor (odds_min): not posted; the seed
                 -- anchor always posts.
    END IF;

    RETURN QUERY VALUES
      (CASE WHEN j = 0 THEN 'over' ELSE 'over:' || v_line END,
       'Over', v_over, v_line, (j + v_cfg.rungs_per_side) * 2, 'over'),
      (CASE WHEN j = 0 THEN 'under' ELSE 'under:' || v_line END,
       'Under', v_under, v_line, (j + v_cfg.rungs_per_side) * 2 + 1, 'under');
  END LOOP;
END;
$function$
;

-- ── odds_engine_get_config ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.odds_engine_get_config(p_season_id uuid)
 RETURNS odds_engine_config
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
    v_cfg.odds_min             := 1.20;
    v_cfg.odds_max             := 8.00;
    v_cfg.rungs_per_side       := 3;
    v_cfg.spacing_score        := 10;
    v_cfg.spacing_night_pins   := 20;
    v_cfg.spacing_count        := 1.0;
    v_cfg.quote_tolerance      := 0.10;
  END IF;
  RETURN v_cfg;
END;
$function$
;

-- ── config: odds_min becomes the minimum offered multiplier ──────────────────
UPDATE public.odds_engine_config SET odds_min = 1.20;
ALTER TABLE public.odds_engine_config ALTER COLUMN odds_min SET DEFAULT 1.20;
