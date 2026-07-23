-- combo_member_averages v2 — season-scoped averages with an explicit fallback tag.
--
-- Owner request: the combine-mode averages should be the player's CURRENT
-- SEASON average, falling back to lifetime only when they have no season data
-- yet. v1 mirrored the seed math's windows exactly (frame stats = lifetime
-- official imports), which made the "SEASON AVG" label a lie for frame stats.
--
-- v2 resolves each member through an explicit chain and REPORTS which rung
-- answered via a new `source` column, so the UI can label honestly:
--   frame stats  → season official imports (via weeks.season_id)
--                  → lifetime official imports → NULL ('season'/'lifetime')
--   total_pins   → season archived scores → lifetime archived scores
--                  → games-weighted league avg, default 130 ('season'/
--                  'lifetime'/'league') — player_raw_avg_score's chain,
--                  inlined so the rung is visible
-- `games` = the counted-game denominator of the rung that answered (0 for the
-- league fallback). Display-only context; the seed/pricing math is untouched
-- and still reads its own windows, so the shown average can legitimately
-- differ from what the book prices off.
--
-- Return type changes (new `source` column) → DROP + CREATE. The v1 fn
-- shipped earlier today and no released client calls it.

DROP FUNCTION IF EXISTS public.combo_member_averages(uuid[], text, uuid);

CREATE FUNCTION public.combo_member_averages(
  p_player_ids uuid[],
  p_stat       text,
  p_season_id  uuid
)
RETURNS TABLE(player_id uuid, avg_per_game numeric, games integer, source text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_league_avg numeric;
BEGIN
  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    RETURN QUERY
    SELECT mem.pid,
           CASE WHEN ssn.n > 0 THEN ssn.avg_stat
                WHEN life.n > 0 THEN life.avg_stat END,
           CASE WHEN ssn.n > 0 THEN ssn.n
                WHEN life.n > 0 THEN life.n
                ELSE 0 END,
           CASE WHEN ssn.n > 0 THEN 'season'
                WHEN life.n > 0 THEN 'lifetime' END
    FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat,
             count(*)::integer AS n
      FROM public.lanetalk_game_imports i
      JOIN public.weeks w ON w.id = i.week_id
      WHERE i.player_id = mem.pid
        AND i.classification = 'official' AND i.frames > 0
        AND w.season_id = p_season_id
    ) ssn
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat,
             count(*)::integer AS n
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = mem.pid
        AND i.classification = 'official' AND i.frames > 0
    ) life;

  ELSIF p_stat = 'total_pins' THEN
    -- player_raw_avg_score's league rung, computed once for the batch.
    SELECT COALESCE(avg(s.score), 130) INTO v_league_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.is_archived = true AND ts.player_id IS NOT NULL AND s.score > 0;

    RETURN QUERY
    SELECT mem.pid,
           CASE WHEN ssn.n > 0 THEN ssn.avg_score
                WHEN life.n > 0 THEN life.avg_score
                ELSE v_league_avg END,
           CASE WHEN ssn.n > 0 THEN ssn.n
                WHEN life.n > 0 THEN life.n
                ELSE 0 END,
           CASE WHEN ssn.n > 0 THEN 'season'
                WHEN life.n > 0 THEN 'lifetime'
                ELSE 'league' END
    FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT avg(s.score) AS avg_score, count(*)::integer AS n
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.season_id = p_season_id AND w.is_archived = true
        AND ts.player_id = mem.pid AND s.score > 0
    ) ssn
    CROSS JOIN LATERAL (
      SELECT avg(s.score) AS avg_score, count(*)::integer AS n
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true AND ts.player_id = mem.pid AND s.score > 0
    ) life;

  ELSE
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;
END;
$$;

-- Granted to authenticated so the combine-mode member list can show averages
-- (display-only context; nothing prices or places off the client's copy).
REVOKE EXECUTE ON FUNCTION public.combo_member_averages(uuid[], text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.combo_member_averages(uuid[], text, uuid) TO authenticated;
