-- ============================================================================
-- Phase 2 · WS2 (addendum) — sync_over_under_markets_for_week + extra games.
-- ============================================================================
-- The RSVP path derives target games from the existing markets (default {1,2}).
-- Team generation additionally needs to create markets for any extra schedule
-- game number not yet present (game 3 when numTeams ∈ {3,5}) — the legacy
-- AdminGenerateTeamsModal game-3 behaviour. Rather than have the client write
-- markets/selections directly, the sync RPC takes an optional p_extra_games
-- array that is unioned into the target set, keeping all line creation server-side
-- and idempotent. RSVP calls it with one arg (default empty); team-gen passes the
-- schedule's distinct game numbers.
--
-- Replaces the one-arg version from 20260605005644 (dropped first so there is no
-- overload ambiguity when called with a single argument).
-- ============================================================================

DROP FUNCTION IF EXISTS public.sync_over_under_markets_for_week(uuid);

CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(
  p_week_id     uuid,
  p_extra_games integer[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id    uuid;
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

  -- Target games = distinct game_number of existing O/U markets ∪ p_extra_games,
  -- defaulting to {1,2} when there are neither.
  SELECT ARRAY(
    SELECT DISTINCT g FROM (
      SELECT game_number AS g FROM public.bet_markets
        WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL
      UNION
      SELECT UNNEST(COALESCE(p_extra_games, '{}'))
    ) u
  ) INTO v_target_games;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;

  -- --- Refund + remove markets for players no longer "in" --------------------
  DELETE FROM public.pin_ledger
    WHERE bet_id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.subject_player_id NOT IN (
          SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
        )
    );

  DELETE FROM public.bets
    WHERE id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.subject_player_id NOT IN (
          SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
        )
    );

  DELETE FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
      AND m.subject_player_id NOT IN (
        SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
      );

  -- --- League average (mean of per-player current-season archived averages) ---
  SELECT COALESCE(AVG(pa.avg_score), 130) INTO v_league_avg
  FROM (
    SELECT AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id IS NOT NULL AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa;

  -- --- Create missing markets for "in" players --------------------------------
  FOR v_rec IN
    SELECT ip.player_id, g.game_number, p.name
    FROM (SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in') ip
    CROSS JOIN UNNEST(v_target_games) AS g(game_number)
    JOIN public.players p ON p.id = ip.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = g.game_number AND m.subject_player_id = ip.player_id
    )
  LOOP
    SELECT AVG(s.score) INTO v_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id = v_rec.player_id AND s.score IS NOT NULL;

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
$$;

REVOKE EXECUTE ON FUNCTION public.sync_over_under_markets_for_week(uuid, integer[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_over_under_markets_for_week(uuid, integer[]) TO authenticated;
