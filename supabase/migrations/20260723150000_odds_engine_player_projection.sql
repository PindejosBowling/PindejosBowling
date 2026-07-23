-- odds_engine_player_projection — the book's per-stat expectation for one
-- player, side by side with their current-season average.
--
-- Owner request: the Sportsbook board should show "what the player averages"
-- against "what the book expects this week" — projected pins, clean frames,
-- strikes, and spares. The projection is the engine's per-game MEAN
-- (odds_engine_player_stat — recency-weighted, fading prior), deliberately
-- surfaced as a product decision: the posted seed lines already telegraph the
-- center, so publishing the rounded mean gives up nothing the board doesn't.
-- VARIANCE stays server-side (the quote-band posture is unchanged).
--
-- Per stat the row carries the projection plus the season average resolved
-- through combo_member_averages' explicit fallback chain (season → lifetime
-- → league for pins), with `avg_source`/`avg_games` so the UI can label
-- honestly. Engine disabled (global or season override) → `projected` NULL
-- for every row — the book has no model opinion to show, averages still
-- return.
--
-- Stats: 'score' (per-game pins; averaged via the 'total_pins' chain),
-- 'clean_frames', 'strikes', 'spares'. All values are PER GAME — the client
-- scales to night scope (× games) exactly like the combo average display.
--
-- Read-only display context; no pricing path reads this function.

CREATE FUNCTION public.odds_engine_player_projection(
  p_player_id uuid,
  p_season_id uuid
)
RETURNS TABLE(stat text, projected numeric, season_avg numeric, avg_source text, avg_games integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT c.is_enabled INTO v_enabled
  FROM public.odds_engine_get_config(p_season_id) c;

  RETURN QUERY
  SELECT s.stat_key,
         CASE WHEN v_enabled THEN round(ps.mean, 1) END,
         round(a.avg_per_game, 1),
         a.source,
         COALESCE(a.games, 0)
  FROM (VALUES
          ('score',        'total_pins',   1),
          ('clean_frames', 'clean_frames', 2),
          ('strikes',      'strikes',      3),
          ('spares',       'spares',       4)
       ) AS s(stat_key, avg_stat, ord)
  CROSS JOIN LATERAL public.odds_engine_player_stat(p_player_id, p_season_id, s.stat_key) ps
  LEFT JOIN LATERAL public.combo_member_averages(ARRAY[p_player_id], s.avg_stat, p_season_id) a ON true
  ORDER BY s.ord;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.odds_engine_player_projection(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.odds_engine_player_projection(uuid, uuid) TO authenticated;
