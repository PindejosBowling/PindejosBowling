-- odds_engine_member_projections — batched book projections for combine mode.
--
-- Owner request: the combo member-picking list should show the same "book
-- expects" context the board's projection strip does, so a bettor can decide
-- WHICH players to combine with (a player whose projection sits above their
-- average is the book calling a hot week — their share of the combo line will
-- be priced richer than their average suggests).
--
-- The batch companion to odds_engine_player_projection (one player × four
-- stats): here it's N players × ONE stat, in the COMBO stat vocabulary
-- ('total_pins' maps to the engine's 'score'), mirroring
-- combo_member_averages' shape so the screen fetches both with the same
-- arguments. `projected` is the engine's PER-GAME mean rounded to 0.1 —
-- the same surface-the-mean product decision (variance stays server-side) —
-- and NULL for every row when the engine is disabled.
--
-- Read-only display context; no pricing path reads this function.

CREATE FUNCTION public.odds_engine_member_projections(
  p_player_ids uuid[],
  p_stat       text,
  p_season_id  uuid
)
RETURNS TABLE(player_id uuid, projected numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_enabled boolean;
  v_stat    text := CASE WHEN p_stat = 'total_pins' THEN 'score' ELSE p_stat END;
BEGIN
  SELECT c.is_enabled INTO v_enabled
  FROM public.odds_engine_get_config(p_season_id) c;

  RETURN QUERY
  SELECT mem.pid,
         CASE WHEN v_enabled THEN round(ps.mean, 1) END
  FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem
  CROSS JOIN LATERAL public.odds_engine_player_stat(mem.pid, p_season_id, v_stat) ps;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.odds_engine_member_projections(uuid[], text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.odds_engine_member_projections(uuid[], text, uuid) TO authenticated;
