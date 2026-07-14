-- Settle-lifecycle probe (see context/db-verification.md) — exercises the PR3/PR4
-- advance/settle split directly (not via the archive_week shim).
--
-- Fixture (same shape as probe-archive-roundtrip): 2 players seeded with
-- balance, a team_prop total_pins market that WINS at settle (real 150 + fill
-- 130 = 280 > line 260.5), and a scoreless O/U bet the backstop force-voids.
--
-- Vectors:
--   A advance_week            → N locked, N+1 created, settled_at NULL,
--                               bowled_at UNCHANGED, ledger == pre-advance.
--   B settle_week(force)      → team_prop won, scoreless voided, House P/L event
--                               present (house_net = -50), settled_at set.
--   C settle_week again       → idempotent: ledger + House P/L unchanged.
--   D unsettle_week           → money reversed (ledger == pre-advance), week
--                               STILL locked (is_archived, settled_at NULL),
--                               House P/L event gone, bet back to pending.
--   E settle_week (re-derive) → identical to B.
--   F unarchive_week (settled)→ both phases reversed, N+1 gone, fill → NULL,
--                               ledger EXACTLY pre-advance, bowled_at PRESERVED.
--   G advance then unarchive (advanced-unsettled) → zero money delta, N+1 gone.
-- Always aborts via the final RAISE.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid; v_week_no int;
  v_mkt uuid; v_sel uuid; v_bet uuid;
  v_run uuid; v_run2 uuid;
  v_t1 uuid; v_t2 uuid; v_slot1 uuid; v_slot2 uuid; v_slot_fill uuid; v_game uuid;
  v_fill_payload jsonb;
  v_mkt_tp uuid; v_sel_tp_over uuid; v_bet_tp uuid;
  v_bowled date;
  c_seed constant int := 1000;
  v_pre_sum bigint;  v_pre_n bigint;
  v_set_sum bigint;  v_set_n bigint;
  v_got bigint; v_got_n bigint;
  v_res jsonb; v_house int;
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
  SELECT id, week_number, bowled_at INTO v_week, v_week_no, v_bowled FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  -- Seed balance (score_credit for the week → also trips the settle mint guard,
  -- so settlement mints no new pincome and ledger deltas are bet money only).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  INSERT INTO public.teams (week_id, team_number) VALUES (v_week, 998) RETURNING id INTO v_t1;
  INSERT INTO public.teams (week_id, team_number) VALUES (v_week, 999) RETURNING id INTO v_t2;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t1, 1, v_p1) RETURNING id INTO v_slot1;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t2, 1, v_p2) RETURNING id INTO v_slot2;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t1, 2, NULL) RETURNING id INTO v_slot_fill;
  INSERT INTO public.games (game_number, team_a_id, team_b_id) VALUES (1, v_t1, v_t2) RETURNING id INTO v_game;
  UPDATE public.scores SET score = 150 WHERE team_slot_id = v_slot1 AND game_id = v_game;
  UPDATE public.scores SET score = 120 WHERE team_slot_id = v_slot2 AND game_id = v_game;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_slot_id', s.team_slot_id, 'game_id', s.game_id, 'score', 130)), '[]'::jsonb)
    INTO v_fill_payload
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
   WHERE t.week_id = v_week AND ts.is_fill AND s.score IS NULL;

  SELECT id INTO v_mkt_tp FROM public.bet_markets
    WHERE market_type = 'team_prop' AND subject_game_id = v_game
      AND params ->> 'team_id' = v_t1::text AND params ->> 'stat' = 'total_pins';
  IF v_mkt_tp IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: team_prop market not created by the resync trigger';
  END IF;
  UPDATE public.bet_selections SET line = 260.5 WHERE market_id = v_mkt_tp;
  SELECT id INTO v_sel_tp_over FROM public.bet_selections WHERE market_id = v_mkt_tp AND key = 'over';

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE lifecycle market', v_week, 1, 'open') RETURNING id INTO v_mkt;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_sel;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'under', 'Under', 2.000, 100.5);

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_sel], 50) INTO v_bet;
  SELECT public.place_house_bet(ARRAY[v_sel_tp_over], 50) INTO v_bet_tp;

  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_pre_sum, v_pre_n
    FROM public.pin_ledger WHERE season_id = v_season;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);

  ---------------------------------------------------------------- A. advance
  SELECT public.advance_week(v_week, true, v_fill_payload) INTO v_run;
  IF NOT (SELECT is_archived FROM public.weeks WHERE id = v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: week not locked by advance';
  END IF;
  IF (SELECT settled_at FROM public.weeks WHERE id = v_week) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: settled_at set by advance (should be NULL)';
  END IF;
  IF (SELECT bowled_at FROM public.weeks WHERE id = v_week) IS DISTINCT FROM v_bowled THEN
    RAISE EXCEPTION 'PROBE_FAIL: advance changed bowled_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE season_id = v_season AND week_number = v_week_no + 1) THEN
    RAISE EXCEPTION 'PROBE_FAIL: next week not created by advance';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'pending' THEN
    RAISE EXCEPTION 'PROBE_FAIL: advance settled a bet (should be no money)';
  END IF;
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_pre_sum OR v_got_n <> v_pre_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: advance moved money (sum %/%, rows %/%)', v_got, v_pre_sum, v_got_n, v_pre_n;
  END IF;

  ---------------------------------------------------------------- B. settle
  v_res := public.settle_week(v_week, false, true);
  IF (SELECT settled_at FROM public.weeks WHERE id = v_week) IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: settled_at not set by settle';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'won'
     OR (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_tp) <> 280 THEN
    RAISE EXCEPTION 'PROBE_FAIL: team_prop not won at 280 by settle';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet) <> 'void' THEN
    RAISE EXCEPTION 'PROBE_FAIL: scoreless bet not voided by settle';
  END IF;
  v_house := (v_res ->> 'house_net')::int;
  IF v_house <> -50 THEN
    RAISE EXCEPTION 'PROBE_FAIL: house_net = % (expected -50)', v_house;
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
        WHERE week_id = v_week AND event_type = 'sportsbook_weekly_house_result') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: House P/L event not published by settle';
  END IF;
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_set_sum, v_set_n
    FROM public.pin_ledger WHERE season_id = v_season;

  ---------------------------------------------------------- C. re-settle idem
  PERFORM public.settle_week(v_week, false, true);
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_set_sum OR v_got_n <> v_set_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: re-settle not idempotent (sum %/%, rows %/%)', v_got, v_set_sum, v_got_n, v_set_n;
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
        WHERE week_id = v_week AND event_type = 'sportsbook_weekly_house_result') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: re-settle duplicated the House P/L event';
  END IF;

  ---------------------------------------------------------------- D. unsettle
  PERFORM public.unsettle_week(v_week);
  IF NOT (SELECT is_archived FROM public.weeks WHERE id = v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: unsettle unlocked the week (should stay advanced)';
  END IF;
  IF (SELECT settled_at FROM public.weeks WHERE id = v_week) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: settled_at not cleared by unsettle';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'pending' THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet not restored to pending by unsettle';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
        WHERE week_id = v_week AND event_type = 'sportsbook_weekly_house_result') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: House P/L event not deleted by unsettle';
  END IF;
  -- Fill stays materialized (week still locked).
  IF (SELECT score FROM public.scores WHERE team_slot_id = v_slot_fill AND game_id = v_game) IS DISTINCT FROM 130 THEN
    RAISE EXCEPTION 'PROBE_FAIL: unsettle reverted the fill score (should stay 130 while locked)';
  END IF;
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_pre_sum OR v_got_n <> v_pre_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: unsettle did not restore money (sum %/%, rows %/%)', v_got, v_pre_sum, v_got_n, v_pre_n;
  END IF;

  ------------------------------------------------------------ E. re-derive
  PERFORM public.settle_week(v_week, false, true);
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_set_sum OR v_got_n <> v_set_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: re-derive not identical to first settle (sum %/%, rows %/%)', v_got, v_set_sum, v_got_n, v_set_n;
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: re-derive did not re-win the team_prop bet';
  END IF;

  --------------------------------------------------- F. unarchive (settled)
  PERFORM public.unarchive_week(v_week, true);
  IF (SELECT is_archived FROM public.weeks WHERE id = v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: week still archived after unarchive';
  END IF;
  IF (SELECT bowled_at FROM public.weeks WHERE id = v_week) IS DISTINCT FROM v_bowled THEN
    RAISE EXCEPTION 'PROBE_FAIL: unarchive nulled/changed bowled_at (must be preserved)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.weeks WHERE season_id = v_season AND week_number = v_week_no + 1) THEN
    RAISE EXCEPTION 'PROBE_FAIL: next week not destroyed by unarchive';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'pending'
     OR (SELECT status FROM public.bets WHERE id = v_bet) <> 'pending' THEN
    RAISE EXCEPTION 'PROBE_FAIL: bets not restored to pending by unarchive';
  END IF;
  IF (SELECT score FROM public.scores WHERE team_slot_id = v_slot_fill AND game_id = v_game) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: fill score not reverted to NULL by unarchive';
  END IF;
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_pre_sum OR v_got_n <> v_pre_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: unarchive did not restore ledger (sum %/%, rows %/%)', v_got, v_pre_sum, v_got_n, v_pre_n;
  END IF;
  IF (SELECT status FROM public.week_archive_runs WHERE id = v_run) <> 'reversed' THEN
    RAISE EXCEPTION 'PROBE_FAIL: archive run not marked reversed';
  END IF;

  ---------------------------------- G. unarchive an ADVANCED-unsettled week
  SELECT public.advance_week(v_week, true, v_fill_payload) INTO v_run2;
  IF (SELECT settled_at FROM public.weeks WHERE id = v_week) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: re-advance set settled_at';
  END IF;
  PERFORM public.unarchive_week(v_week, true);
  IF (SELECT is_archived FROM public.weeks WHERE id = v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: advanced-unsettled week still archived after unarchive';
  END IF;
  IF EXISTS (SELECT 1 FROM public.weeks WHERE season_id = v_season AND week_number = v_week_no + 1) THEN
    RAISE EXCEPTION 'PROBE_FAIL: next week not destroyed by advanced-unsettled unarchive';
  END IF;
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_pre_sum OR v_got_n <> v_pre_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: advanced-unsettled unarchive moved money (sum %/%, rows %/%)', v_got, v_pre_sum, v_got_n, v_pre_n;
  END IF;

  RAISE EXCEPTION 'PROBE_RESULT %', jsonb_build_object(
    'lifecycle', 'ok',
    'pre_sum', v_pre_sum, 'settled_sum', v_set_sum,
    'house_net', -50,
    'advance_no_money', true, 'settle_idempotent', true,
    'unsettle_reversed', true, 're_derive_identical', true,
    'unarchive_settled_clean', true, 'unarchive_advanced_zero_delta', true);
END $$;
