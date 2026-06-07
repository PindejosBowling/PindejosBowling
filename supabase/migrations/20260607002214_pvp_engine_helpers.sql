-- ============================================================================
-- PvP Challenge Contracts — engine helper functions.
-- ============================================================================
-- Two deterministic/stable helpers used by the PvP RPCs. Both SECURITY DEFINER
-- with pinned search_path and fully-qualified objects.
-- ============================================================================


-- ============================================================================
-- 1. pvp_rake — deterministic rake calculation (design §4.4).
-- ============================================================================
-- Single source of truth: 5% of the total pot, floor-rounded.
-- Every RPC computes rake through this function.
CREATE OR REPLACE FUNCTION public.pvp_rake(p_total_pot int)
RETURNS int
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT floor(p_total_pot * 0.05)::int;
$$;

REVOKE EXECUTE ON FUNCTION public.pvp_rake(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pvp_rake(int) TO authenticated;


-- ============================================================================
-- 2. pvp_player_line — Line Duel snapshot value (design §11.1).
-- ============================================================================
-- Reuses the sportsbook formula from sync_over_under_markets_for_week
-- (20260605005644_ou_target_model_rpcs.sql): floor(player's season avg of
-- archived scores) + 0.5; falls back to floor(league avg) + 0.5 when the
-- player has no archived scores yet.
--
-- NOTE: this formula is duplicated from sync_over_under_markets_for_week so
-- PvP lines stay consistent with the sportsbook. If that function is ever
-- refactored to expose a shared helper, point both here.
CREATE OR REPLACE FUNCTION public.pvp_player_line(p_player_id uuid, p_season_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_avg        numeric;
  v_league_avg numeric;
BEGIN
  -- Player's mean of current-season archived scores.
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.season_id = p_season_id
    AND w.is_archived = true
    AND ts.player_id = p_player_id
    AND s.score IS NOT NULL;

  IF v_avg IS NOT NULL THEN
    RETURN floor(v_avg) + 0.5;
  END IF;

  -- Fallback: league average (mean of all players' per-player season averages).
  SELECT COALESCE(AVG(pa.avg_score), 130) INTO v_league_avg
  FROM (
    SELECT AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = p_season_id
      AND w.is_archived = true
      AND ts.player_id IS NOT NULL
      AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa;

  RETURN floor(v_league_avg) + 0.5;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pvp_player_line(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pvp_player_line(uuid, uuid) TO authenticated;
