-- LaneTalk stat-prop SYNC — server-side line generation, coupled to the roster.
--
-- Replaces the manual admin "Generate Stat Lines" flow: stat-prop markets now
-- ride the SAME eligibility machinery as the score O/U lines. The new
-- sync_lanetalk_prop_markets_for_week is called from resync_week_markets, so
-- the existing statement-level coupling triggers on rsvp / team_slots / games /
-- scores re-run it after any roster mutation — RSVP in → lines appear; RSVP
-- out → lines pruned (bets refunded by the market-delete trigger). No client
-- path can strand a stat line.
--
-- Rules (as built in the app layer this replaces):
--   • Eligibility = the O/U ladder (per-game participation rows when games
--     exist, else slots, else RSVP 'in', × target games) **∩ players with ≥1
--     official LaneTalk import** (frames > 0). No league-average or default
--     fallback — no imports, no lines.
--   • Markets: strikes + spares O/U per (player, game); clean % + first-ball
--     avg O/U per player for the night (game_number NULL).
--   • Seeding (lanetalk_seed_lines): per-game count means for strikes/spares
--     (floor(avg)+0.5 clamped [0.5, 9.5]); frame-weighted clean %
--     (floor(avg/5)*5+2.5) and first-ball avg (round(avg,1)).
--   • Re-runs REPRICE unbet open/closed markets whose seeded line drifted
--     (new imports); a line never moves under a placed bet.
--   • Idempotent; settled/void markets are never touched.
--
-- Security: both functions SECURITY DEFINER with pinned search_path, mirroring
-- sync_over_under_markets_for_week (EXECUTE: authenticated; called by the
-- resync triggers server-side regardless).

-- ----------------------------------------------------------------------------
-- 1. lanetalk_seed_lines — a player's four seeded lines from their official
--    import history. Returns ZERO rows for a player with no usable official
--    games (the "no imports, no lines" signal).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lanetalk_seed_lines(p_player_id uuid)
 RETURNS TABLE(strikes_line numeric, spares_line numeric, clean_pct_line numeric, first_ball_avg_line numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    LEAST(9.5, GREATEST(0.5, floor(avg(st.strikes)) + 0.5))      AS strikes_line,
    LEAST(9.5, GREATEST(0.5, floor(avg(st.spares)) + 0.5))       AS spares_line,
    floor((sum(st.clean_pct * f.n) / sum(f.n)) / 5) * 5 + 2.5    AS clean_pct_line,
    round(sum(st.first_ball_avg * f.n) / sum(f.n), 1)            AS first_ball_avg_line
  FROM public.lanetalk_game_imports i
  CROSS JOIN LATERAL (
    SELECT jsonb_array_length(COALESCE(i.payload -> 'frames', '[]'::jsonb)) AS n
  ) f
  CROSS JOIN LATERAL public.lanetalk_game_stats(i.payload) st
  WHERE i.player_id = p_player_id
    AND i.classification = 'official'
    AND f.n > 0
  HAVING count(*) > 0;
$function$
;

-- ----------------------------------------------------------------------------
-- 2. sync_lanetalk_prop_markets_for_week — create/prune/reprice, mirroring
--    sync_over_under_markets_for_week's structure (ladder, target games,
--    prune-then-create), specialized to lanetalk prop markets.
-- ----------------------------------------------------------------------------
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
  v_rec          record;
  v_market_id    uuid;
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

  -- --- Prune: refund + remove every open/closed lanetalk prop whose subject ---
  -- lost eligibility (ladder ∩ official history) or whose game number left the
  -- schedule. Night markets (game_number NULL) follow the subject's standing in
  -- ANY target game. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'prop'
     AND m.params ->> 'source' = 'lanetalk'
     AND m.status IN ('open', 'closed')
     AND (
       -- no official import history → no line
       NOT EXISTS (
         SELECT 1 FROM public.lanetalk_game_imports i
         WHERE i.player_id = m.subject_player_id
           AND i.classification = 'official'
           AND jsonb_array_length(COALESCE(i.payload -> 'frames', '[]'::jsonb)) > 0)
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

  -- --- Create missing night markets (clean % + first-ball avg) --------------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name,
           sl.clean_pct_line, sl.first_ball_avg_line
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
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_pct'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean % — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_pct', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_rec.clean_pct_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_rec.clean_pct_line, 1);
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
               WHEN 'clean_pct'      THEN sl.clean_pct_line
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
$function$
;

-- ----------------------------------------------------------------------------
-- 3. resync_week_markets — add the prop sync to the coupling path. The
--    statement-level triggers on rsvp / team_slots / games / scores already
--    funnel through here, so stat lines now follow RSVPs automatically.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resync_week_markets(p_week_id uuid, p_moneyline boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_week_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = p_week_id AND w.is_archived = false) THEN
    RETURN;
  END IF;
  PERFORM public.sync_over_under_markets_for_week(p_week_id);
  PERFORM public.sync_lanetalk_prop_markets_for_week(p_week_id);
  IF p_moneyline THEN
    PERFORM public.sync_moneyline_markets_for_week(p_week_id);
  END IF;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.sync_lanetalk_prop_markets_for_week(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_lanetalk_prop_markets_for_week(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.lanetalk_seed_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lanetalk_seed_lines(uuid) TO authenticated;
