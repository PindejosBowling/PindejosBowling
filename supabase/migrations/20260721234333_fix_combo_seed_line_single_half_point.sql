-- Fix combo_seed_line overstating combined lines.
--
-- Individual lines are seeded as floor(avg) + 0.5 — the half point exists so
-- every bet resolves cleanly. The combo seed summed the members' RAW averages
-- and floored once (floor(Σ avg) + 0.5), letting each member's dropped
-- fraction accumulate into the combined line: with solo lines 4.5 and 4.5
-- (avgs 4.6 + 4.6) the combo seeded floor(9.2) + 0.5 = 9.5, overstating the
-- 4 + 4 + 0.5 = 8.5 a player expects from the displayed solo lines.
--
-- New math (owner spec 2026-07-21): sum each member's WHOLE-NUMBER base —
-- floor(their per-game avg × n_games), i.e. their solo line minus its half
-- point — then add ONE half point for the whole combo. The combined line now
-- always equals Σ(solo bases) + 0.5, consistent with the solo lines shown on
-- the combine-mode board.
--
-- Per-member flooring mirrors how individual lines are seeded (game scope:
-- floor(avg) + 0.5 in lanetalk_seed_lines; night scope: floor(avg × n) + 0.5
-- in the night O/U sync), so no reconciliation drift between scopes.
--
-- Existing open combo markets keep their already-seeded lines (compose = bet:
-- a line moves only when a NEW market is composed; dedup onto an existing
-- market keeps its original line by design).

CREATE OR REPLACE FUNCTION public.combo_seed_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n_members integer;
  v_sum       numeric;
BEGIN
  SELECT count(DISTINCT m) INTO v_n_members FROM unnest(p_member_ids) m;
  IF v_n_members = 0 THEN v_n_members := 1; END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    -- Per member: floor(per-game avg × games) = their solo whole-number base
    -- (no data → 0). Summed bases + ONE half point.
    SELECT COALESCE(SUM(floor(COALESCE(pl.avg_stat, 0) * p_n_games)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = mem.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl;
    -- Clamp to [0.5, 10 frames/game × games × members − 0.5].
    RETURN LEAST(10 * p_n_games * v_n_members - 0.5,
                 GREATEST(0.5, v_sum + 0.5));

  ELSIF p_stat = 'total_pins' THEN
    SELECT COALESCE(SUM(floor(public.player_raw_avg_score(mem.player_id, p_season_id) * p_n_games)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem;
    RETURN GREATEST(0.5, v_sum + 0.5);

  ELSE
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;
END;
$function$;
