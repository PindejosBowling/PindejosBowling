-- Align the two sportsbook average-consuming DB functions with the app's
-- canonical player-average policy (mirror of app/src/utils/averages.ts) AND give
-- each player a per-player fallback ladder for their betting line:
--
--   Policy (shared with the app):
--     * A game counts only if it was actually bowled — score > 0. Un-bowled
--       games (0 / null) are excluded from every average. (Was: `IS NOT NULL`,
--       which let a legitimate-but-absent 0 count.)
--     * The league average is GAMES-WEIGHTED — Σscore / Σgames across bowled
--       rows — not the unweighted mean of per-player averages.
--
--   Per-player line fallback ladder (NEW):
--     1. Season-specific average — the player's mean in the CURRENT season, if
--        they have bowled any games this season.
--     2. Lifetime average — the player's mean across ALL archived seasons, used
--        when they have no games yet this season (e.g. week 1, or a returning
--        player). Previously this step was skipped and the line jumped straight
--        to the league average, ignoring the player's own history.
--     3. League average — games-weighted, all-time — only for a player with no
--        archived games anywhere; final COALESCE guards to 130.
--
-- Only the average math + fallback changes; market/line creation, eligibility
-- pruning, and the FLOOR(avg) + 0.5 line snap are preserved verbatim.

-- ---------------------------------------------------------------------------
-- pvp_player_line: season → lifetime → league ladder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pvp_player_line(p_player_id uuid, p_season_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_avg        numeric;
  v_league_avg numeric;
BEGIN
  -- 1. Season-specific: player's mean of THIS season's archived bowled scores.
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.season_id = p_season_id
    AND w.is_archived = true
    AND ts.player_id = p_player_id
    AND s.score > 0;

  IF v_avg IS NOT NULL THEN
    RETURN floor(v_avg) + 0.5;
  END IF;

  -- 2. Lifetime: player's mean across ALL archived seasons.
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true
    AND ts.player_id = p_player_id
    AND s.score > 0;

  IF v_avg IS NOT NULL THEN
    RETURN floor(v_avg) + 0.5;
  END IF;

  -- 3. Fallback: games-weighted, all-time league average (Σscore / Σgames).
  -- player_id IS NOT NULL excludes fill slots (fills carry a null player).
  SELECT COALESCE(AVG(s.score), 130) INTO v_league_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true
    AND ts.player_id IS NOT NULL
    AND s.score > 0;

  RETURN floor(v_league_avg) + 0.5;
END;
$function$
;

-- ---------------------------------------------------------------------------
-- sync_over_under_markets_for_week: per-player O/U lines, same ladder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(p_week_id uuid, p_extra_games integer[] DEFAULT '{}'::integer[])
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
  v_league_avg   numeric;
  v_avg          numeric;
  v_line         numeric;
  v_market_id    uuid;
  v_rec          record;
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

  -- Target games: once a schedule exists the games table is authoritative
  -- (∪ p_extra_games for a just-inserted game in the same client flow).
  -- Before teams: existing market numbers ∪ extras, defaulting to {1, 2}.
  IF v_has_games THEN
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT g.game_number AS x FROM public.games g
          JOIN public.teams t ON t.id = g.team_a_id
         WHERE t.week_id = p_week_id
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT game_number AS x FROM public.bet_markets
          WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;

  -- --- Prune: refund + remove every O/U market whose subject is no longer ---
  -- eligible (per the ladder above) or whose game number is no longer
  -- scheduled. The BEFORE DELETE trigger (refund_bets_before_market_delete)
  -- refunds every touched bet whole (ledger pair + bet row), including parlays
  -- spanning other markets. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status IN ('open', 'closed')
     AND (
       m.game_number <> ALL (v_target_games)
       OR (v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             JOIN public.games g       ON g.id = s.game_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id
               AND g.game_number = m.game_number))
       OR (NOT v_has_games AND v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
     );

  -- --- Games-weighted, all-time league average (Σscore / Σgames across bowled
  -- rows) — the final fallback for a player with no archived games anywhere.
  -- player_id IS NOT NULL excludes fill slots (fills carry a null player).
  SELECT COALESCE(AVG(s.score), 130) INTO v_league_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true
    AND ts.player_id IS NOT NULL AND s.score > 0;

  -- --- Create missing markets for eligible (player, game) pairs ---------------
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name
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
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = ep.game_number AND m.subject_player_id = ep.player_id
    )
  LOOP
    -- 1. Season-specific average for this player.
    SELECT AVG(s.score) INTO v_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id = v_rec.player_id AND s.score > 0;

    -- 2. Lifetime fallback: player's mean across all archived seasons.
    IF v_avg IS NULL THEN
      SELECT AVG(s.score) INTO v_avg
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.is_archived = true
        AND ts.player_id = v_rec.player_id AND s.score > 0;
    END IF;

    -- 3. League average is the final COALESCE fallback.
    v_line := FLOOR(COALESCE(v_avg, v_league_avg)) + 0.5;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);
  END LOOP;
END;
$function$
;
