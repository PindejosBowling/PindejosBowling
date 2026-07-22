-- ─────────────────────────────────────────────────────────────────────────────
-- Value-first lines follow-up: the SEED line always quotes.
--
-- odds_engine_mint_ladder always mints the seed rung, clamping its odds into
-- [odds_min, odds_max] instead of dropping it (p_force = true). The preview
-- path must mirror that: a FRESH combo (no market yet) whose seed prices
-- outside the unforced band — e.g. a member set with zero history for the
-- chosen stat, seed 0.5 vs a prior-shrunk mean well above it — was returning
-- odds NULL for the exact line compose would happily mint. Re-price the seed
-- forced when the unforced quote comes back empty, so the BuilderBar's anchor
-- value is always quotable at the same clamped price compose will post; the
-- selectable band is widened to contain the seed for the same reason.
-- ─────────────────────────────────────────────────────────────────────────────

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
    IF v_odds IS NULL AND p_line = p_seed_line THEN
      -- Unposted seed (fresh combo): mirror the minter — force, clamp.
      SELECT pp.over_odds, pp.under_odds INTO v_odds, v_under
        FROM public.odds_engine_price_pair(p_mean, p_variance, p_n_games, p_line,
                                           p_odds_min, p_odds_max, true) pp;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'line', p_line,
    'odds', v_odds,
    'posted', p_posted_odds IS NOT NULL,
    'seed_line', p_seed_line, 'seed_odds', p_seed_odds,
    'min_line', v_min_line, 'max_line', v_max_line);
END;
$function$;
