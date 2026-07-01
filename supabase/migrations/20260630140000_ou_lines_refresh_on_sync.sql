-- Fix: existing Over/Under player-score markets kept a stale line forever.
--
-- sync_over_under_markets_for_week only ever set a line when it INSERTED a new
-- market; for a still-eligible player the existing market survived the prune and
-- its line was never recomputed. So markets created before the season→lifetime→
-- league ladder landed (migration 20260630130000) stayed pinned at the old
-- 130.5 league default, and even regenerating teams didn't refresh them.
--
-- This migration:
--   1. Makes the sync REFRESH the line on every existing OPEN market that has no
--      bets yet, so re-syncs (team generation, slot/game triggers) self-heal.
--      Markets with any bet are frozen to protect existing bettors.
--   2. Sources every line — inserted or refreshed — from public.pvp_player_line,
--      so O/U and PvP lines share one implementation of the ladder and can never
--      drift.
--   3. Backfills all currently-open, un-bet O/U lines in live weeks so the fix is
--      visible immediately without waiting for the next sync.

-- ---------------------------------------------------------------------------
-- sync_over_under_markets_for_week: refresh existing lines + insert missing
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

  -- --- Refresh: recompute the line on every OPEN market that has no bets yet,
  -- so re-syncs pick up the current season→lifetime→league ladder. Markets with
  -- any bet on any selection are frozen (line untouched) to protect bettors.
  -- pvp_player_line already returns FLOOR(avg) + 0.5 — use it verbatim.
  UPDATE public.bet_selections bs
     SET line = public.pvp_player_line(m.subject_player_id, v_season_id)
   FROM public.bet_markets m
   WHERE bs.market_id = m.id
     AND m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status = 'open'
     AND m.subject_player_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.bet_legs bl
       JOIN public.bet_selections s2 ON s2.id = bl.selection_id
       WHERE s2.market_id = m.id
     );

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
    -- Season → lifetime → league ladder, shared with PvP lines.
    v_line := public.pvp_player_line(v_rec.player_id, v_season_id);

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

-- ---------------------------------------------------------------------------
-- One-time backfill: refresh every currently-open, un-bet O/U line in a live
-- (non-archived) week so the ladder is visible immediately.
-- ---------------------------------------------------------------------------
UPDATE public.bet_selections bs
   SET line = public.pvp_player_line(m.subject_player_id, w.season_id)
  FROM public.bet_markets m
  JOIN public.weeks w ON w.id = m.week_id
 WHERE bs.market_id = m.id
   AND m.market_type = 'over_under'
   AND m.status = 'open'
   AND w.is_archived = false
   AND m.subject_player_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.bet_legs bl
     JOIN public.bet_selections s2 ON s2.id = bl.selection_id
     WHERE s2.market_id = m.id
   );
