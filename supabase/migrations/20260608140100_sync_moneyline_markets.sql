-- ============================================================================
-- Moneyline betting · 2/3 — sync_moneyline_markets_for_week (create, server-side).
-- ============================================================================
-- Mirrors sync_over_under_markets_for_week, but moneylines derive from the GAME
-- SCHEDULE (matchups), not RSVP — so this is wired to team generation, not RSVP
-- toggles. Idempotent: creates one even-money (2.000) moneyline market per games
-- row that lacks one, with two selections keyed by team id (label "Team N").
-- Create-only: removing a game cascades its market via subject_game_id (refund of
-- bets on a removed matchup is out of scope for v1).
CREATE OR REPLACE FUNCTION public.sync_moneyline_markets_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id uuid;
  v_market_id uuid;
  v_rec       record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- One moneyline market per scheduled matchup (games row) that has none yet.
  FOR v_rec IN
    SELECT g.id AS game_id, g.game_number,
           g.team_a_id, g.team_b_id,
           ta.team_number AS team_a_number,
           tb.team_number AS team_b_number
    FROM public.games g
    JOIN public.teams ta ON ta.id = g.team_a_id
    JOIN public.teams tb ON tb.id = g.team_b_id
    WHERE ta.week_id = p_week_id
      AND g.team_a_id IS NOT NULL AND g.team_b_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_markets m
        WHERE m.market_type = 'moneyline' AND m.subject_game_id = g.id
      )
  LOOP
    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_game_id, status)
      VALUES ('moneyline',
              'Team ' || v_rec.team_a_number || ' vs Team ' || v_rec.team_b_number || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.game_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, v_rec.team_a_id::text, 'Team ' || v_rec.team_a_number, 2.000, NULL, 0),
      (v_market_id, v_rec.team_b_id::text, 'Team ' || v_rec.team_b_number, 2.000, NULL, 1);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_moneyline_markets_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_moneyline_markets_for_week(uuid) TO authenticated;
