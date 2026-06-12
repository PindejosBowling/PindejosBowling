-- Bets + bounty probe — self-contained, assertion-grade
-- (see context/db-verification.md).
--
-- Fixtures: 2 synthetic players seeded 1000 pins each, 2 synthetic open
-- over_under markets (odds 2.000). Live anchors: active season + open week.
--
-- Flow:
--   bounty #1 (house, reward 30 / stake 30): both players enter → hunter_win
--   bounty #2 (house): p2 enters → sponsor_win (house keeps stake)
--   bet #1: p1 stakes 50 on over @2.0, market settles over  → won (+50 net)
--   bet #2: p2 stakes 50 on over @2.0, market settles under → lost (−50 net)
--   sweep:  settle_betting_for_week(force) — the archive-time settlement path
-- Asserts per-player deltas, statuses, payouts, net-zero; raises PROBE_RESULT.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid;
  v_mkt1 uuid; v_sel1 uuid;
  v_mkt2 uuid; v_sel2 uuid;
  v_bet1 uuid; v_bet2 uuid;
  v_bounty1 uuid; v_bounty2 uuid;
  c_seed constant int := 1000;
  v_got int;
  v_result jsonb;
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000001'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000002');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'One', '+10000000001', v_u1) RETURNING id INTO v_p1;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'Two', '+10000000002', v_u2) RETURNING id INTO v_p2;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE market 1', v_week, 1, 'open') RETURNING id INTO v_mkt1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt1, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_sel1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt1, 'under', 'Under', 2.000, 100.5);
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE market 2', v_week, 2, 'open') RETURNING id INTO v_mkt2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt2, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_sel2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt2, 'under', 'Under', 2.000, 100.5);

  ------------------------------------------------------------------ bounties
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  SELECT public.create_house_bounty(v_week, 'Probe bounty 1', 'probe', 30, 30, 2, now() + interval '1 hour')
    INTO v_bounty1;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.enter_bounty_as_hunter(v_bounty1);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.enter_bounty_as_hunter(v_bounty1);

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_bounty(v_bounty1, 'hunter_win', 'probe settle 1');

  SELECT public.create_house_bounty(v_week, 'Probe bounty 2', 'probe', 30, 30, 2, now() + interval '1 hour')
    INTO v_bounty2;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.enter_bounty_as_hunter(v_bounty2);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_bounty(v_bounty2, 'sponsor_win', 'probe settle 2');

  -- hunter_win pays stake+reward back (+30 net each); sponsor_win keeps p2's stake
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> 30 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 delta % after bounties (expected +30)', v_got;
  END IF;
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p2 AND created_at = now();
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 delta % after bounties (expected 0 = +30 won − 30 lost)', v_got;
  END IF;

  ------------------------------------------------------------------ bets
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_sel1], 50) INTO v_bet1;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_sel2], 50) INTO v_bet2;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_market(v_mkt1, 101.5);  -- over wins → bet1 won
  PERFORM public.settle_market(v_mkt2, 99.5);   -- under wins → bet2 lost

  IF (SELECT status FROM public.bets WHERE id = v_bet1) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet1 not won';
  END IF;
  IF (SELECT potential_payout FROM public.bets WHERE id = v_bet1) <> 100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet1 payout <> 100 (50 @ 2.000)';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet2) <> 'lost' THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet2 not lost';
  END IF;

  ------------------------------------------------------------------ sweep
  PERFORM public.settle_betting_for_week(v_week, true);

  -- score_credit mint idempotency: a second sweep must mint nothing
  DECLARE v_mints int;
  BEGIN
    SELECT count(*) INTO v_mints FROM public.pin_ledger
      WHERE week_id = v_week AND type = 'score_credit';
    PERFORM public.settle_betting_for_week(v_week, true);
    IF (SELECT count(*) FROM public.pin_ledger
        WHERE week_id = v_week AND type = 'score_credit') <> v_mints THEN
      RAISE EXCEPTION 'PROBE_FAIL: double sweep re-minted score credits';
    END IF;
  END;

  ------------------------------------------------------------------ assertions
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> 80 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 final delta % (expected +80 = +30 bounty +50 bet)', v_got;
  END IF;
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p2 AND created_at = now();
  IF v_got <> -50 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 final delta % (expected −50 = 0 bounty −50 bet)', v_got;
  END IF;

  -- double-entry: every transfer type in this tx nets to zero (the sweep's
  -- score_credit mint is the only sanctioned single-sided type)
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type <> 'score_credit';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: non-mint movements net to % (expected 0)', v_got;
  END IF;

  IF (SELECT count(*) FROM public.bounty_post WHERE created_at = now() AND status = 'settled') <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected both bounties settled';
  END IF;
  IF (SELECT count(*) FROM public.bounty_hunter_stakes WHERE created_at = now() AND status = 'won') <> 2
     OR (SELECT count(*) FROM public.bounty_hunter_stakes WHERE created_at = now() AND status = 'lost') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: hunter stake statuses wrong (expected 2 won + 1 lost)';
  END IF;
  IF (SELECT count(*) FROM public.bounty_payouts WHERE created_at = now()) <> 3 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected 3 bounty payout rows (2 hunter + 1 house reporting)';
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'fixture_pin_rows', (
      SELECT jsonb_agg(jsonb_build_object(
        'is_house', is_house, 'amount', amount, 'type', type, 'description', description,
        'bet_ref', bet_id IS NOT NULL, 'bounty_ref', bounty_post_id IS NOT NULL)
        ORDER BY type, description, is_house, amount)
      FROM public.pin_ledger
      WHERE created_at = now() AND type <> 'score_credit'
        AND (player_id IN (v_p1, v_p2)
             OR bet_id IN (v_bet1, v_bet2)
             OR bounty_post_id IN (v_bounty1, v_bounty2)))
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
