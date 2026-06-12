-- LaneTalk consumers read the stat columns (TODO_DB_PERFORMANCE §1, Migration B).
--
-- lanetalk_seed_lines, settle_lanetalk_props_for_week (per-game + night
-- branches), and sync_lanetalk_prop_markets_for_week's prune predicate stop
-- parsing payload JSONB and read the columns added by Migration A.
-- settle/sync GENERATED from the live catalog with targeted replacements;
-- seed_lines rewritten (small body). Stat math unchanged — verified by
-- diffing per-player lanetalk_seed_lines output before/after, a column-vs-
-- function mismatch query, and the probe suite.

CREATE OR REPLACE FUNCTION public.lanetalk_seed_lines(p_player_id uuid)
 RETURNS TABLE(strikes_line numeric, spares_line numeric, clean_frames_per_game numeric, first_ball_avg_line numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    LEAST(9.5, GREATEST(0.5, floor(avg(i.strikes)) + 0.5))       AS strikes_line,
    LEAST(9.5, GREATEST(0.5, floor(avg(i.spares)) + 0.5))        AS spares_line,
    avg(i.strikes + i.spares)                                    AS clean_frames_per_game,
    round(sum(i.first_ball_avg * i.frames) / sum(i.frames), 1)   AS first_ball_avg_line
  FROM public.lanetalk_game_imports i
  WHERE i.player_id = p_player_id
    AND i.classification = 'official'
    AND i.frames > 0
  HAVING count(*) > 0;
$function$;

CREATE OR REPLACE FUNCTION public.settle_lanetalk_props_for_week(p_week_id uuid, p_void_missing boolean DEFAULT false)
 RETURNS TABLE(settled integer, voided integer, left_pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt        record;
  v_stat       text;
  v_value      numeric;
  v_official_n integer;
  v_scored_n   integer;
  v_settled    integer := 0;
  v_voided     integer := 0;
  v_pending    integer := 0;
BEGIN
  PERFORM public.assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_mkt IN
    SELECT id, subject_player_id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id
      AND market_type = 'prop'
      AND params ->> 'source' = 'lanetalk'
      AND status IN ('open', 'closed')
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_stat NOT IN ('strikes', 'spares', 'clean_frames', 'clean_pct', 'first_ball_avg') THEN
      RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
    END IF;

    IF (v_mkt.params ->> 'scope') = 'game' THEN
      -- Per-game: the player's official import for this exact game.
      SELECT CASE v_stat
               WHEN 'strikes'        THEN st.strikes::numeric
               WHEN 'spares'         THEN st.spares::numeric
               WHEN 'clean_frames'   THEN (st.strikes + st.spares)::numeric
               WHEN 'clean_pct'      THEN st.clean_pct
               WHEN 'first_ball_avg' THEN st.first_ball_avg
             END
        INTO v_value
      FROM public.lanetalk_game_imports i
      CROSS JOIN LATERAL (
        SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg
      ) st
      WHERE i.week_id = p_week_id
        AND i.player_id = v_mkt.subject_player_id
        AND i.game_number = v_mkt.game_number
        AND i.classification = 'official'
      LIMIT 1;
    ELSE
      -- Night: only settle off a COMPLETE night — official imports must cover
      -- every game the player has a recorded score for.
      SELECT count(*) INTO v_official_n
      FROM public.lanetalk_game_imports i
      WHERE i.week_id = p_week_id
        AND i.player_id = v_mkt.subject_player_id
        AND i.classification = 'official';

      SELECT count(*) INTO v_scored_n
      FROM public.scores s
      JOIN public.games g       ON g.id = s.game_id
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;

      IF v_official_n > 0 AND v_official_n >= v_scored_n THEN
        -- Frame-level aggregate across the night (totals, not per-game means).
        SELECT CASE v_stat
                 WHEN 'strikes'        THEN SUM(st.strikes)::numeric
                 WHEN 'spares'         THEN SUM(st.spares)::numeric
                 WHEN 'clean_frames'   THEN (SUM(st.strikes) + SUM(st.spares))::numeric
                 WHEN 'clean_pct'      THEN SUM(st.clean_pct * st.frames) / NULLIF(SUM(st.frames), 0)
                 WHEN 'first_ball_avg' THEN SUM(st.first_ball_avg * st.frames) / NULLIF(SUM(st.frames), 0)
               END
          INTO v_value
        FROM public.lanetalk_game_imports i
        CROSS JOIN LATERAL (
          SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg, i.frames
        ) st
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.classification = 'official'
          AND st.frames > 0;
      END IF;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      -- Delete-refund rail: refund_bets_before_market_delete refunds every
      -- touched bet whole (incl. parlays spanning other markets).
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_settled, v_voided, v_pending;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_lanetalk_prop_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id    uuid;
  v_has_teams    boolean;
  v_has_games    boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_rec          record;
  v_market_id    uuid;
  v_clean_line   numeric;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;
  SELECT EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) INTO v_has_games;

  -- Target games: the schedule once it exists; before teams, existing prop
  -- market numbers, defaulting to {1, 2} (same policy as the O/U sync).
  IF v_has_games THEN
    SELECT ARRAY(
      SELECT DISTINCT g.game_number FROM public.games g
        JOIN public.teams t ON t.id = g.team_a_id
       WHERE t.week_id = p_week_id
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT game_number FROM public.bet_markets
       WHERE week_id = p_week_id AND market_type = 'prop'
         AND params ->> 'source' = 'lanetalk' AND game_number IS NOT NULL
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);

  -- --- Prune: refund + remove every open/closed lanetalk prop whose subject ---
  -- lost eligibility (ladder ∩ official history), whose game number left the
  -- schedule, or whose stat key left the catalog (clean_pct → clean_frames).
  -- Night markets (game_number NULL) follow the subject's standing in ANY
  -- target game. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'prop'
     AND m.params ->> 'source' = 'lanetalk'
     AND m.status IN ('open', 'closed')
     AND (
       m.params ->> 'stat' NOT IN ('strikes', 'spares', 'clean_frames', 'first_ball_avg')
       -- no official import history → no line
       OR NOT EXISTS (
         SELECT 1 FROM public.lanetalk_game_imports i
         WHERE i.player_id = m.subject_player_id
           AND i.classification = 'official'
           AND i.frames > 0)
       OR (m.game_number IS NOT NULL AND m.game_number <> ALL (v_target_games))
       OR (m.game_number IS NOT NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             JOIN public.games g       ON g.id = s.game_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id
               AND g.game_number = m.game_number))
       OR (m.game_number IS NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_games AND v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
     );

  -- --- Create missing per-game markets (strikes + spares) -------------------
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name,
           sl.strikes_line, sl.spares_line
    FROM (
      -- games exist → participation rows are the authority, per game
      SELECT DISTINCT ts.player_id, g.game_number
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      -- teams but no games yet (mid-team-gen) → slots × target
      SELECT ts.player_id, gt.game_number
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      -- no teams → RSVP × target
      SELECT r.player_id, gt.game_number
      FROM public.rsvp r
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    -- zero seed rows = no official history → no markets for this player
    JOIN LATERAL public.lanetalk_seed_lines(ep.player_id) sl ON true
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_rec.strikes_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_rec.strikes_line, 1);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_rec.spares_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_rec.spares_line, 1);
    END IF;
  END LOOP;

  -- --- Create missing night markets (clean frames + first-ball avg) ---------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name,
           sl.clean_frames_per_game, sl.first_ball_avg_line
    FROM (
      SELECT DISTINCT ts.player_id
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      SELECT ts.player_id
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      SELECT r.player_id
      FROM public.rsvp r
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    JOIN LATERAL public.lanetalk_seed_lines(ep.player_id) sl ON true
  LOOP
    -- Night clean line: per-game average scaled to this week's schedule, on a
    -- half so it can't push, clamped inside the possible range.
    v_clean_line := LEAST(10 * v_n_games - 0.5,
                    GREATEST(0.5, floor(v_rec.clean_frames_per_game * v_n_games) + 0.5));

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_clean_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_clean_line, 1);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'first_ball_avg'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' First-Ball Avg — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'first_ball_avg', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_rec.first_ball_avg_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_rec.first_ball_avg_line, 1);
    END IF;
  END LOOP;

  -- --- Reprice: unbet open/closed markets whose seeded line drifted ---------
  -- (new imports since creation). Never moves a line under a placed bet.
  UPDATE public.bet_selections s
     SET line = d.line
    FROM public.bet_markets m
    CROSS JOIN LATERAL public.lanetalk_seed_lines(m.subject_player_id) sl
    CROSS JOIN LATERAL (
      SELECT CASE m.params ->> 'stat'
               WHEN 'strikes'        THEN sl.strikes_line
               WHEN 'spares'         THEN sl.spares_line
               WHEN 'clean_frames'   THEN LEAST(10 * v_n_games - 0.5,
                                        GREATEST(0.5, floor(sl.clean_frames_per_game * v_n_games) + 0.5))
               WHEN 'first_ball_avg' THEN sl.first_ball_avg_line
             END AS line
    ) d
   WHERE s.market_id = m.id
     AND m.week_id = p_week_id
     AND m.market_type = 'prop'
     AND m.params ->> 'source' = 'lanetalk'
     AND m.status IN ('open', 'closed')
     AND d.line IS NOT NULL
     AND s.line IS DISTINCT FROM d.line
     AND NOT EXISTS (
       SELECT 1 FROM public.bet_legs l
       JOIN public.bet_selections s2 ON s2.id = l.selection_id
       WHERE s2.market_id = m.id);
END;
$function$;

