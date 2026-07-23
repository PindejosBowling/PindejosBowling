-- combo_member_averages — per-member per-game averages for the combine-mode UI.
--
-- WHY: combo seed lines are Σ floor(member avg × games) + 0.5, and the fair
-- odds compress as members are added (the line drifts below the summed mean
-- while the spread grows only √N). The member-pick screen showed only each
-- player's posted solo line, so bettors couldn't see where a chosen combo
-- line sat relative to the group's actual production. This read-only fn
-- exposes the SAME averages the seed math consumes (never the engine's
-- shrunk mean/variance — those stay server-side) so the app can render
-- "AVG" context per member and a live group average in the BuilderBar.
--
-- Sources mirror combo_seed_line exactly:
--   frame stats  → lanetalk_game_imports, classification='official', frames>0
--   total_pins   → player_raw_avg_score(player, season) (archived official
--                  scores; season → lifetime → league-average fallback chain)
-- `games` is the player's own counted-game denominator (0 = the avg shown is
-- a fallback, not their history).

CREATE OR REPLACE FUNCTION public.combo_member_averages(
  p_player_ids uuid[],
  p_stat       text,
  p_season_id  uuid
)
RETURNS TABLE(player_id uuid, avg_per_game numeric, games integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    RETURN QUERY
    SELECT mem.pid, st.avg_stat, st.n
    FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem
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
    ) st;

  ELSIF p_stat = 'total_pins' THEN
    RETURN QUERY
    SELECT mem.pid,
           public.player_raw_avg_score(mem.pid, p_season_id),
           (SELECT count(*)::integer
            FROM public.scores s
            JOIN public.team_slots ts ON ts.id = s.team_slot_id
            JOIN public.teams t       ON t.id = ts.team_id
            JOIN public.weeks w       ON w.id = t.week_id
            WHERE w.is_archived = true AND ts.player_id = mem.pid AND s.score > 0)
    FROM (SELECT DISTINCT m AS pid FROM unnest(p_player_ids) m) mem;

  ELSE
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;
END;
$$;

-- Granted to authenticated so the combine-mode member list can show averages
-- (display-only context; nothing prices or places off the client's copy).
REVOKE EXECUTE ON FUNCTION public.combo_member_averages(uuid[], text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.combo_member_averages(uuid[], text, uuid) TO authenticated;
