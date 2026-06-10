-- ============================================================================
-- Fix: settle_betting_for_week regressed in 20260608140200_moneyline_settlement.
-- ============================================================================
-- The moneyline migration recreated settle_betting_for_week from an OLD body and,
-- while adding moneyline settlement, accidentally dropped FOUR steps that the
-- then-live definition (20260607230000_feed_importance_to_app) had:
--   1. week_id = p_week_id on the score_credit INSERT  ← reported UI bug: the
--      week's pincome rows landed with week_id = NULL, so the Pinsino ledger
--      bucketed them under "BONUSES" (weekNumber === null) instead of "WEEK N".
--   2. PERFORM process_weekly_loans(p_week_id)          (loan garnishment/interest)
--   3. PERFORM settle_pvp_for_week(p_week_id)           (PvP auto-settlement)
--   4. The sportsbook_weekly_house_result Activity Feed event.
--
-- This migration recreates settle_betting_for_week as the union of the
-- feed-importance body (steps 1–4 restored) AND the moneyline settlement loop,
-- then backfills week_id on any score_credit rows already minted without it
-- (the already-archived weeks), so their pincome regroups under the right week.
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
  v_house_net   integer;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week. Stamp week_id so the entry
  -- groups under the correct week in the per-player ledger.
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

  -- Settle every non-settled moneyline market whose game has scores.
  FOR v_mkt IN
    SELECT id, subject_game_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'moneyline' AND status <> 'settled'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.scores
      WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
    ) THEN
      PERFORM public.settle_moneyline_market_internal(v_mkt.id);
    ELSE
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    END IF;
  END LOOP;

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  SELECT COALESCE(SUM(amount), 0) INTO v_house_net
    FROM public.pin_ledger
    WHERE is_house = true AND week_id = p_week_id
      AND type IN ('bet_stake','bet_payout','bet_refund');

  -- Idempotency: no source FK exists, so guard on (season, week, event_type).
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Backfill: score_credit rows minted without week_id while the regression was
-- live (parse "Week N Game G: SCORE pins"). Same logic as the original
-- 20260605120219 backfill; only touches rows still NULL.
-- ----------------------------------------------------------------------------
UPDATE public.pin_ledger pl
SET week_id = w.id
FROM public.weeks w
WHERE pl.type = 'score_credit'
  AND pl.week_id IS NULL
  AND w.season_id = pl.season_id
  AND w.week_number = (regexp_match(pl.description, '^Week (\d+) '))[1]::integer;
