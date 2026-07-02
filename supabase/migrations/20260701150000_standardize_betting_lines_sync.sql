-- Standardize betting-line generation across groupings (1 of 2: sync).
--
-- The board's line matrix grew inconsistently as market types shipped over time.
-- This migration makes every grouping carry the full stat range the DB supports:
--
--   Player, per game : Score O/U + Strikes + Spares + Clean Frames (NEW)
--   Player, night    : Clean Frames + Strikes (NEW) + Spares (NEW); First-Ball
--                      Avg RETIRED as a bettable line (existing bet-carrying FBA
--                      markets survive and settle; unbet ones prune on resync)
--   Team, per game   : WIN + Total Pins + Clean Frames + Strikes + Spares (as-is)
--   Team, night (NEW): Total Pins + Clean Frames + Strikes + Spares
--
-- Night team markets are the first team_props with NO game anchor:
-- game_number NULL + subject_game_id NULL, scope='night', team identified by
-- params.team_id as before. Clock: total_pins → 'archive' (settled at archive
-- from the week's score sheet), frame stats → 'lanetalk' (settled at Confirm).
-- The companion migration (…_standardize_betting_lines_settlement) adds both
-- settlement paths — the two MUST land in the same push or archives abort on
-- the first pending night total_pins bet.
--
-- No backfill call: resync_week_markets already runs both syncs on every
-- rsvp/scores/team_slots/games event and both are idempotent, so the current
-- week picks up the new matrix on its next roster event.

-- ---------------------------------------------------------------------------
-- lanetalk_seed_lines: expose RAW per-game averages (strikes/spares) so night
-- lines can scale the unfloored mean by the week's game count (scaling the
-- already-floored per-game line would compound the +0.5 offset). first_ball_avg
-- is retired — the column is dropped. Return type changes → DROP then CREATE.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.lanetalk_seed_lines(uuid);

CREATE FUNCTION public.lanetalk_seed_lines(p_player_id uuid)
 RETURNS TABLE(strikes_line numeric, spares_line numeric,
               strikes_per_game numeric, spares_per_game numeric,
               clean_frames_per_game numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    LEAST(9.5, GREATEST(0.5, floor(avg(i.strikes)) + 0.5)) AS strikes_line,
    LEAST(9.5, GREATEST(0.5, floor(avg(i.spares)) + 0.5))  AS spares_line,
    avg(i.strikes)                                         AS strikes_per_game,
    avg(i.spares)                                          AS spares_per_game,
    avg(i.strikes + i.spares)                              AS clean_frames_per_game
  FROM public.lanetalk_game_imports i
  WHERE i.player_id = p_player_id
    AND i.classification = 'official'
    AND i.frames > 0
  HAVING count(*) > 0;
$function$
;

-- ---------------------------------------------------------------------------
-- Player prop sync: full stat range at both scopes.
--   Per game : strikes + spares + clean_frames (clean_frames NEW at game scope)
--   Night    : clean_frames + strikes + spares (strikes/spares NEW; FBA removed)
-- Prune change: the stat-catalog clause now deletes ONLY betless markets, so
-- retiring first_ball_avg never refunds a live bet — bet-carrying FBA markets
-- ride to Confirm and settle normally (the settle RPC keeps FBA support).
-- Reprice keys on stat × (game_number IS NOT NULL) and returns NULL for FBA,
-- freezing legacy FBA lines where they stand.
-- ---------------------------------------------------------------------------
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
  v_line         numeric;
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
  -- lost eligibility (ladder ∩ official history) or whose game number left the
  -- schedule. A stat leaving the catalog (first_ball_avg retirement) prunes
  -- ONLY betless markets — a market carrying bets keeps its stat settleable.
  -- Night markets (game_number NULL) follow the subject's standing in ANY
  -- target game. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'prop'
     AND m.params ->> 'source' = 'lanetalk'
     AND m.status IN ('open', 'closed')
     AND (
       (m.params ->> 'stat' NOT IN ('strikes', 'spares', 'clean_frames')
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l
          JOIN public.bet_selections s ON s.id = l.selection_id
          WHERE s.market_id = m.id))
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

  -- --- Create missing per-game markets (strikes + spares + clean frames) ----
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name,
           sl.strikes_line, sl.spares_line, sl.clean_frames_per_game
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

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      -- Per-game clean line: floor+0.5 on the per-game average, clamped inside
      -- the possible range (10 frames a game).
      v_line := LEAST(9.5, GREATEST(0.5, floor(v_rec.clean_frames_per_game) + 0.5));
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);
    END IF;
  END LOOP;

  -- --- Create missing night markets (clean frames + strikes + spares) -------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name,
           sl.strikes_per_game, sl.spares_per_game, sl.clean_frames_per_game
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
    -- Night lines: per-game average scaled to this week's schedule, floored
    -- ONCE to a half so it can't push, clamped inside the possible range
    -- (10 frames a game — the money definitions count FRAMES, so 10·n is the
    -- true ceiling for strikes, spares, and clean frames alike).
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.clean_frames_per_game * v_n_games) + 0.5));
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.strikes_per_game * v_n_games) + 0.5));
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.spares_per_game * v_n_games) + 0.5));
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);
    END IF;
  END LOOP;

  -- --- Reprice: unbet open/closed markets whose seeded line drifted ---------
  -- (new imports since creation). Never moves a line under a placed bet.
  -- Keyed on stat × scope (game_number is the structural scope marker);
  -- first_ball_avg resolves NULL → skipped, so legacy FBA lines stay frozen.
  UPDATE public.bet_selections s
     SET line = d.line
    FROM public.bet_markets m
    CROSS JOIN LATERAL public.lanetalk_seed_lines(m.subject_player_id) sl
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN m.params ->> 'stat' = 'strikes' AND m.game_number IS NOT NULL
                 THEN sl.strikes_line
               WHEN m.params ->> 'stat' = 'strikes'
                 THEN LEAST(10 * v_n_games - 0.5,
                      GREATEST(0.5, floor(sl.strikes_per_game * v_n_games) + 0.5))
               WHEN m.params ->> 'stat' = 'spares' AND m.game_number IS NOT NULL
                 THEN sl.spares_line
               WHEN m.params ->> 'stat' = 'spares'
                 THEN LEAST(10 * v_n_games - 0.5,
                      GREATEST(0.5, floor(sl.spares_per_game * v_n_games) + 0.5))
               WHEN m.params ->> 'stat' = 'clean_frames' AND m.game_number IS NOT NULL
                 THEN LEAST(9.5, GREATEST(0.5, floor(sl.clean_frames_per_game) + 0.5))
               WHEN m.params ->> 'stat' = 'clean_frames'
                 THEN LEAST(10 * v_n_games - 0.5,
                      GREATEST(0.5, floor(sl.clean_frames_per_game * v_n_games) + 0.5))
               ELSE NULL
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

-- ---------------------------------------------------------------------------
-- team_prop_seed_line: n_games-aware. Night lines scale the RAW roster sum by
-- the week's game count before the single floor (default 1 keeps every
-- existing per-game call site byte-identical). Adding a DEFAULT via CREATE OR
-- REPLACE would create a second ambiguous overload → DROP then CREATE.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.team_prop_seed_line(uuid, text, uuid);

CREATE FUNCTION public.team_prop_seed_line(p_team_id uuid, p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_roster integer;
  v_sum    numeric;
BEGIN
  SELECT count(*) INTO v_roster
  FROM public.team_slots ts
  WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
  IF v_roster = 0 THEN v_roster := 1; END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    SELECT COALESCE(SUM(pl.avg_stat), 0) INTO v_sum
    FROM public.team_slots ts
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = ts.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl
    WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
    -- Half-point, floored once; clamp to [0.5, 10 frames/game × games × roster − 0.5].
    RETURN LEAST(10 * p_n_games * v_roster - 0.5,
                 GREATEST(0.5, floor(COALESCE(v_sum, 0) * p_n_games) + 0.5));

  ELSIF p_stat = 'total_pins' THEN
    SELECT COALESCE(SUM(public.player_raw_avg_score(ts.player_id, p_season_id)), 0) INTO v_sum
    FROM public.team_slots ts
    WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
    RETURN GREATEST(0.5, floor(COALESCE(v_sum, 0) * p_n_games) + 0.5);

  ELSE
    RAISE EXCEPTION 'Unknown team_prop stat %', p_stat;
  END IF;
END;
$function$
;

-- ---------------------------------------------------------------------------
-- Team prop sync: adds NIGHT team markets — one per (team × stat) across the
-- whole night (game_number NULL, subject_game_id NULL). Prune is restructured
-- to be NULL-safe: the game-anchored clauses only apply to game-scope markets;
-- night markets prune when their team leaves the week or the schedule empties
-- (they have no games-FK cascade to die by).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_team_prop_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id uuid;
  v_n_games   integer;
  v_rec       record;
  v_stat      text;
  v_clock     text;
  v_line      numeric;
  v_market_id uuid;
  v_label     text;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  SELECT count(DISTINCT g.game_number) INTO v_n_games
  FROM public.games g
  JOIN public.teams t ON t.id = g.team_a_id
  WHERE t.week_id = p_week_id;

  -- Prune open/closed team_props whose anchor died or whose stat left the
  -- catalog. Game-scope: game/team-pairing gone (game deletion already
  -- cascades + refunds; this also covers team reassignment). Night-scope: the
  -- team left the week, or the week's schedule emptied. Settled/void immutable.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'team_prop'
     AND m.status IN ('open', 'closed')
     AND (
       (m.params ->> 'stat') NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins')
       OR (m.subject_game_id IS NOT NULL AND (
             NOT EXISTS (SELECT 1 FROM public.games g WHERE g.id = m.subject_game_id)
             OR NOT EXISTS (
                  SELECT 1 FROM public.games g
                  WHERE g.id = m.subject_game_id
                    AND (m.params ->> 'team_id')::uuid IN (g.team_a_id, g.team_b_id))))
       OR (m.subject_game_id IS NULL AND (
             v_n_games = 0
             OR NOT EXISTS (
                  SELECT 1 FROM public.teams t
                  WHERE t.id = (m.params ->> 'team_id')::uuid
                    AND t.week_id = p_week_id)))
     );

  -- Create: one market per (game, team∈{a,b}, stat) not already present.
  FOR v_rec IN
    SELECT g.id AS game_id, g.game_number, t.id AS team_id, t.team_number
    FROM public.games g
    JOIN public.teams ta ON ta.id = g.team_a_id AND ta.week_id = p_week_id
    JOIN public.teams t  ON t.id IN (g.team_a_id, g.team_b_id)
    WHERE g.team_a_id IS NOT NULL AND g.team_b_id IS NOT NULL
  LOOP
    FOREACH v_stat IN ARRAY ARRAY['clean_frames', 'strikes', 'spares', 'total_pins'] LOOP
      IF EXISTS (
        SELECT 1 FROM public.bet_markets m
        WHERE m.market_type = 'team_prop'
          AND m.subject_game_id = v_rec.game_id
          AND m.params ->> 'team_id' = v_rec.team_id::text
          AND m.params ->> 'stat' = v_stat
      ) THEN
        CONTINUE;
      END IF;

      v_clock := CASE WHEN v_stat = 'total_pins' THEN 'archive' ELSE 'lanetalk' END;
      v_label := CASE v_stat
                   WHEN 'clean_frames' THEN 'Clean Frames'
                   WHEN 'strikes'      THEN 'Strikes'
                   WHEN 'spares'       THEN 'Spares'
                   ELSE 'Total Pins' END;
      v_line := public.team_prop_seed_line(v_rec.team_id, v_stat, v_season_id);

      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_game_id, params, status)
        VALUES ('team_prop',
                'Team ' || v_rec.team_number || ' ' || v_label || ' — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.game_id,
                jsonb_build_object(
                  'family', 'team_aggregate',
                  'stat', v_stat,
                  'scope', 'game',
                  'team_id', v_rec.team_id::text,
                  'team_number', v_rec.team_number,
                  'clock', v_clock),
                'open')
        RETURNING id INTO v_market_id;

      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);
    END LOOP;
  END LOOP;

  -- Create: one NIGHT market per (team × stat) not already present — the same
  -- stats aggregated across every game of the night. Only once a schedule
  -- exists (night lines scale by the game count).
  IF v_n_games > 0 THEN
    FOR v_rec IN
      SELECT DISTINCT t.id AS team_id, t.team_number
      FROM public.games g
      JOIN public.teams ta ON ta.id = g.team_a_id AND ta.week_id = p_week_id
      JOIN public.teams t  ON t.id IN (g.team_a_id, g.team_b_id)
      WHERE g.team_a_id IS NOT NULL AND g.team_b_id IS NOT NULL
    LOOP
      FOREACH v_stat IN ARRAY ARRAY['clean_frames', 'strikes', 'spares', 'total_pins'] LOOP
        IF EXISTS (
          SELECT 1 FROM public.bet_markets m
          WHERE m.market_type = 'team_prop'
            AND m.week_id = p_week_id
            AND m.subject_game_id IS NULL
            AND m.params ->> 'team_id' = v_rec.team_id::text
            AND m.params ->> 'stat' = v_stat
        ) THEN
          CONTINUE;
        END IF;

        v_clock := CASE WHEN v_stat = 'total_pins' THEN 'archive' ELSE 'lanetalk' END;
        v_label := CASE v_stat
                     WHEN 'clean_frames' THEN 'Clean Frames'
                     WHEN 'strikes'      THEN 'Strikes'
                     WHEN 'spares'       THEN 'Spares'
                     ELSE 'Total Pins' END;
        v_line := public.team_prop_seed_line(v_rec.team_id, v_stat, v_season_id, v_n_games);

        INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_game_id, params, status)
          VALUES ('team_prop',
                  'Team ' || v_rec.team_number || ' ' || v_label || ' — Night',
                  p_week_id, NULL, NULL,
                  jsonb_build_object(
                    'family', 'team_aggregate',
                    'stat', v_stat,
                    'scope', 'night',
                    'team_id', v_rec.team_id::text,
                    'team_number', v_rec.team_number,
                    'clock', v_clock),
                  'open')
          RETURNING id INTO v_market_id;

        INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
          (v_market_id, 'over',  'Over',  2.000, v_line, 0),
          (v_market_id, 'under', 'Under', 2.000, v_line, 1);
      END LOOP;
    END LOOP;
  END IF;

  -- Reseed: refresh the line on every open team_prop market that has NO bets yet
  -- (self-heals stale lines after roster/import changes). Never touches a market
  -- carrying a placed bet. Night markets reseed at the night scale.
  UPDATE public.bet_selections s
     SET line = public.team_prop_seed_line(
                  (m.params ->> 'team_id')::uuid, m.params ->> 'stat', v_season_id,
                  CASE WHEN m.subject_game_id IS NULL THEN GREATEST(v_n_games, 1) ELSE 1 END)
    FROM public.bet_markets m
   WHERE s.market_id = m.id
     AND m.week_id = p_week_id
     AND m.market_type = 'team_prop'
     AND m.status = 'open'
     AND NOT EXISTS (
       SELECT 1 FROM public.bet_legs l
       JOIN public.bet_selections s2 ON s2.id = l.selection_id
       WHERE s2.market_id = m.id
     );
END;
$function$
;
