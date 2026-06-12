-- Rollback-probe for the bets + bounty flows (CONSOLIDATION §2 batch D + §4).
--
--   bounty #1: house bounty → 2 hunters enter → settle hunter_win (payout pairs)
--   bounty #2: house bounty → 1 hunter  → settle sponsor_win (house keeps stakes)
--   bet #1: placed on open O/U market, settled as WON (payout pair)
--   bet #2: placed on second open market, settled as LOST (no ledger)
--   sweep:  settle_betting_for_week(force) — score-credit mint, loans tick,
--           PvP sweep, force-void of remaining pending bets, house P&L event
-- Captures normalized rows; raises to abort — nothing persists.
--
-- NOTE: deliberately does NOT capture the granular bounty ref columns
-- (bounty_hunter_stake_id / settlement / payout) — §4 removes them by design;
-- the capture proves amounts/types/descriptions/pairs are unchanged.
--
-- Inputs: player1 c985c0ad…/c811c7df…, player2 3bf2c262…/fef642dc…,
--         week b78cfe24…, season fe73b724….
DO $$
DECLARE
  v_week constant uuid := 'b78cfe24-f931-45d1-81ab-65fad9c7135d';
  v_mkt1 uuid; v_sel1 uuid; v_line1 numeric;
  v_mkt2 uuid; v_sel2 uuid; v_line2 numeric;
  v_bet1 uuid; v_bet2 uuid;
  v_bounty1 uuid; v_bounty2 uuid;
  v_result jsonb;
BEGIN
  -- Two open O/U markets, deterministically chosen.
  SELECT m.id, s.id, s.line INTO v_mkt1, v_sel1, v_line1
    FROM public.bet_markets m JOIN public.bet_selections s ON s.market_id = m.id AND s.key = 'over'
    WHERE m.week_id = v_week AND m.market_type = 'over_under' AND m.status = 'open'
    ORDER BY m.created_at, m.id LIMIT 1;
  SELECT m.id, s.id, s.line INTO v_mkt2, v_sel2, v_line2
    FROM public.bet_markets m JOIN public.bet_selections s ON s.market_id = m.id AND s.key = 'over'
    WHERE m.week_id = v_week AND m.market_type = 'over_under' AND m.status = 'open'
    ORDER BY m.created_at, m.id OFFSET 1 LIMIT 1;
  IF v_mkt1 IS NULL OR v_mkt2 IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: need two open over_under markets in week %', v_week;
  END IF;

  -- Bounty #1: hunter_win.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  SELECT public.create_house_bounty(v_week, 'Probe bounty 1', 'probe', 30, 30, 2, now() + interval '1 hour')
    INTO v_bounty1;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"player"}}', true);
  PERFORM public.enter_bounty_as_hunter(v_bounty1);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"fef642dc-49ad-445c-b2ad-a2a6b8108283","role":"authenticated","app_metadata":{"role":"player"}}', true);
  PERFORM public.enter_bounty_as_hunter(v_bounty1);

  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.settle_bounty(v_bounty1, 'hunter_win', 'probe settle 1');

  -- Bounty #2: sponsor_win (House keeps stakes; reporting-only payout row).
  SELECT public.create_house_bounty(v_week, 'Probe bounty 2', 'probe', 30, 30, 2, now() + interval '1 hour')
    INTO v_bounty2;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"fef642dc-49ad-445c-b2ad-a2a6b8108283","role":"authenticated","app_metadata":{"role":"player"}}', true);
  PERFORM public.enter_bounty_as_hunter(v_bounty2);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.settle_bounty(v_bounty2, 'sponsor_win', 'probe settle 2');

  -- Bets: one winner, one loser.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"player"}}', true);
  SELECT public.place_house_bet(ARRAY[v_sel1], 50) INTO v_bet1;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"fef642dc-49ad-445c-b2ad-a2a6b8108283","role":"authenticated","app_metadata":{"role":"player"}}', true);
  SELECT public.place_house_bet(ARRAY[v_sel2], 50) INTO v_bet2;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.settle_market(v_mkt1, v_line1 + 1);
  PERFORM public.settle_market(v_mkt2, v_line2 - 1);

  -- The archive-time settlement sweep, force mode.
  PERFORM public.settle_betting_for_week(v_week, true);

  SELECT jsonb_build_object(
    'pin_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', player_id, 'season_id', season_id, 'week_id', week_id,
        'is_house', is_house, 'amount', amount, 'type', type, 'description', description,
        'bet_ref', bet_id IS NOT NULL, 'bounty_ref', bounty_post_id IS NOT NULL,
        'loan_ref', loan_ledger_id IS NOT NULL, 'pvp_ref', pvp_ledger_id IS NOT NULL)
        ORDER BY type, description, is_house, amount, player_id)
      FROM public.pin_ledger WHERE created_at = now() AND type <> 'score_credit'),
    'score_credit_agg', (
      SELECT jsonb_build_object('n', count(*), 'sum', COALESCE(SUM(amount), 0))
      FROM public.pin_ledger WHERE created_at = now() AND type = 'score_credit'),
    'bets', (
      SELECT jsonb_agg(jsonb_build_object('stake', stake, 'status', status, 'payout', potential_payout)
                       ORDER BY stake, status)
      FROM public.bets WHERE created_at = now()),
    'bounty_settlements', (
      SELECT jsonb_agg(jsonb_build_object(
        'outcome', settlement_outcome, 'total_pot', total_pot, 'house_seed', total_house_seed,
        'stakes', total_hunter_stakes, 'reward', total_protected_hunter_profit, 'winners', winner_count)
        ORDER BY settlement_outcome)
      FROM public.bounty_settlements WHERE created_at = now()),
    'bounty_payouts', (
      SELECT jsonb_agg(jsonb_build_object('is_house', is_house, 'amount', payout_amount, 'player_set', player_id IS NOT NULL)
                       ORDER BY payout_amount, is_house)
      FROM public.bounty_payouts WHERE created_at = now()),
    'hunter_stakes', (
      SELECT jsonb_agg(jsonb_build_object('stake', stake_amount, 'status', status, 'reward', protected_hunter_profit)
                       ORDER BY status, stake_amount)
      FROM public.bounty_hunter_stakes WHERE created_at = now()),
    'events', (
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'public_payload', public_payload)
                       ORDER BY event_type, public_payload::text)
      FROM public.activity_feed_events WHERE created_at = now())
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
