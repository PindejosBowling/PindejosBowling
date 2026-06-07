-- ============================================================================
-- Wire PvP settlement into the weekly settlement (design §7.3 / spec §5).
-- ============================================================================
-- CREATE OR REPLACE of settle_betting_for_week reusing the current body verbatim
-- (from 20260606191028_settle_betting_for_week_loans.sql) and appending two PvP
-- calls as the last statements. This runs expire + PvP settlement in the same
-- transaction as the score_credit mint — no intermediate player window.
-- AdminArchiveModal already calls settle_betting_for_week — no app change needed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_mkt         record;
  v_score       integer;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE season_id = v_season_id AND type = 'score_credit'
      AND description LIKE 'Week ' || v_week_number || ' %'
  ) THEN
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    SELECT ts.player_id, v_season_id, p_week_id, s.score, 'score_credit',
           'Week ' || v_week_number || ' Game ' || g.game_number || ': ' || s.score || ' pins'
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id IS NOT NULL
      AND ts.is_fill = false
      AND s.score IS NOT NULL;
  END IF;

  -- Settle every open/closed (non-settled) over_under market in the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    SELECT s.score INTO v_score
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id = v_mkt.subject_player_id
      AND ts.is_fill = false
      AND g.game_number = v_mkt.game_number
      AND s.score IS NOT NULL
    LIMIT 1;

    IF v_score IS NULL THEN
      -- No score -> close without a result (bets stay pending for manual handling).
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) TO authenticated;
