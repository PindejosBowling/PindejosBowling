-- ─────────────────────────────────────────────────────────────────────────────
-- Fade the league prior out of the MEAN (grilled 2026-07-23).
--
-- The asymmetry: the empirical-Bayes blend gave the league prior a PERMANENT
-- pseudo-count of `prior_weight_games` (6) phantom games, while recency decay
-- caps a player's own evidence weight at 1/(1−0.5^(1/half_life)) ≈ 9.2 — so
-- the prior held ≥ ~40% of EVERY estimate forever. That drags good players'
-- means down and weak players' up: the book systematically underpriced top
-- players' overs (+EV to back) and overpriced underperformers' (−EV),
-- incentivizing betting only on the top of the league. Owner wants prices
-- centered on each player's OWN expectation ("reward outperformance relative
-- to your own skill set").
--
-- The fix: the prior's weight on the MEAN is now max(0, prior_weight_games −
-- own_official_games) — a rookie runway, not permanent skepticism. At 0 games
-- the estimate is still the pure league prior (cold start unchanged); by
-- `prior_weight_games` games the mean is purely the player's recency-weighted
-- own history.
--
-- Deliberately NOT changed (grilled decisions — do not "fix" these):
--   • VARIANCE keeps the full-weight league blend + floors. Variance blending
--     has no directional favorite, and with fair uncapped tails a noisy
--     own-history variance would misprice long-tail quotes with real House
--     liability.
--   • Window stays lifetime + half-life recency (no season scoping).
--   • No sandbagging guard (backing your own over after tanking is accepted
--     risk: real league nights are publicly costly to tank, big self-bets hit
--     the Activity Feed).
--
-- Plus a one-time resync (the reprice_stale_ladders pattern): sync is
-- trigger-coupled and nothing fires on a policy change, so betless markets on
-- unarchived weeks re-ladder at the new means now. Bet-frozen ladders keep
-- their odds (probe-asserted invariant).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.odds_engine_player_stat(p_player_id uuid, p_season_id uuid, p_stat text, OUT mean numeric, OUT variance numeric, OUT w_total numeric)
 RETURNS record
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
  v_n      integer;  -- raw (undecayed) count of the player's official games
  v_fade   numeric;  -- the prior's remaining pseudo-count on the mean
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
      SELECT SUM(wt) AS w, SUM(wt * v) / NULLIF(SUM(wt), 0) AS m, COUNT(*)::integer AS n FROM weighted
    )
    SELECT a.w, a.m, a.n,
           (SELECT SUM(wt * (v - a.m) ^ 2) / NULLIF(a.w, 0) FROM weighted)
      INTO w_total, v_mean_w, v_n, v_var_w
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
      SELECT SUM(wt) AS w, SUM(wt * v) / NULLIF(SUM(wt), 0) AS m, COUNT(*)::integer AS n FROM weighted
    )
    SELECT a.w, a.m, a.n,
           (SELECT SUM(wt * (v - a.m) ^ 2) / NULLIF(a.w, 0) FROM weighted)
      INTO w_total, v_mean_w, v_n, v_var_w
    FROM agg a;

  ELSE
    RAISE EXCEPTION 'Unknown odds engine stat %', p_stat;
  END IF;

  w_total := COALESCE(w_total, 0);
  v_n     := COALESCE(v_n, 0);
  SELECT lp.mean, lp.variance INTO v_pm, v_pv FROM public.odds_engine_league_prior(p_season_id, p_stat) lp;

  IF w_total = 0 THEN
    mean     := v_pm;
    variance := GREATEST(v_floor, v_pv);
  ELSE
    -- MEAN: the prior fades with experience — max(0, prior_weight − n games).
    -- Established players (n ≥ prior_weight_games) price purely off their own
    -- recency-weighted history.
    v_fade := GREATEST(0, v_cfg.prior_weight_games - v_n);
    mean   := (w_total * v_mean_w + v_fade * v_pm) / (w_total + v_fade);
    -- VARIANCE: full-weight league blend, unchanged (tail-liability guard).
    variance := GREATEST(v_floor,
                  (w_total * COALESCE(v_var_w, 0) + v_cfg.prior_weight_games * v_pv)
                  / (w_total + v_cfg.prior_weight_games));
  END IF;
END;
$function$
;

-- One-time reprice: betless markets on every unarchived week re-ladder at the
-- faded-prior means (seed rungs keep canonical keys; bet-frozen markets stay).
DO $$
DECLARE w record;
BEGIN
  FOR w IN SELECT id FROM public.weeks WHERE is_archived = false LOOP
    PERFORM public.resync_week_markets(w.id);
  END LOOP;
END $$;
