-- Archive round-trip probe (see context/db-verification.md).
--
-- Fixtures: 2 synthetic players, a synthetic open market, and a pending bet
-- that has NO score — so archive_week(force) must void+refund it, and
-- unarchive_week must surgically reverse that.
--
-- Flow: capture season ledger state → archive_week(force) → assert lock,
-- void/refund, next-week creation → unarchive_week(force) → assert the week
-- reopened, the bet is pending again, and the season ledger is EXACTLY as
-- captured (sum + row count). Always aborts via the final RAISE.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid; v_week_no int;
  v_mkt uuid; v_sel uuid;
  v_bet uuid;
  v_run uuid;
  c_seed constant int := 1000;
  v_pre_sum bigint; v_pre_n bigint;
  v_got bigint; v_got_n bigint;
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
  SELECT id, week_number INTO v_week, v_week_no FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE roundtrip market', v_week, 1, 'open') RETURNING id INTO v_mkt;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_sel;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'under', 'Under', 2.000, 100.5);

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_sel], 50) INTO v_bet;

  ------------------------------------------------------------------ capture
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_pre_sum, v_pre_n
    FROM public.pin_ledger WHERE season_id = v_season;

  ------------------------------------------------------------------ archive
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  SELECT public.archive_week(v_week, true) INTO v_run;

  IF NOT (SELECT is_archived FROM public.weeks WHERE id = v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: week not archived';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet) <> 'void' THEN
    RAISE EXCEPTION 'PROBE_FAIL: scoreless pending bet not voided by force archive';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE bet_id = v_bet;
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: voided bet ledger nets to % (expected 0 after refund)', v_got;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks
                 WHERE season_id = v_season AND week_number = v_week_no + 1) THEN
    RAISE EXCEPTION 'PROBE_FAIL: next week not created by archive';
  END IF;

  ------------------------------------------------------------------ unarchive
  PERFORM public.unarchive_week(v_week, true);

  IF (SELECT is_archived FROM public.weeks WHERE id = v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: week still archived after unarchive';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet) <> 'pending' THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet not restored to pending (got %)',
      (SELECT status FROM public.bets WHERE id = v_bet);
  END IF;

  -- the surgical reversal: season ledger exactly as captured
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_pre_sum OR v_got_n <> v_pre_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: ledger not restored — sum %/% rows %/% (got/expected)',
      v_got, v_pre_sum, v_got_n, v_pre_n;
  END IF;

  IF (SELECT status FROM public.week_archive_runs WHERE id = v_run) <> 'reversed' THEN
    RAISE EXCEPTION 'PROBE_FAIL: archive run not marked reversed';
  END IF;

  RAISE EXCEPTION 'PROBE_RESULT %', jsonb_build_object(
    'roundtrip', 'ok', 'ledger_sum', v_pre_sum, 'ledger_rows', v_pre_n,
    'bet_voided_then_restored', true);
END $$;
