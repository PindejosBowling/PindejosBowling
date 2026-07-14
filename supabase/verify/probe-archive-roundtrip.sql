-- Archive round-trip probe (see context/db-verification.md).
--
-- Fixtures: 2 synthetic players, a synthetic open market, and a pending bet
-- that has NO score — so archive_week(force) must void+refund it, and
-- unarchive_week must surgically reverse that. Plus a team_prop fixture: two
-- 1-man teams + a game with scores (the game INSERT fires the resync trigger →
-- team_prop markets) and a bet on T1's total_pins over that SETTLES WON at
-- archive (archive clock) — unarchive must restore market/selections/legs/bet
-- to their pre-archive images and delete the payout ledger rows.
--
-- Flow: capture season ledger state → archive_week(force) → assert lock,
-- void/refund, team_prop settlement, next-week creation → unarchive_week(force)
-- → assert the week reopened, both bets pending again, the team_prop market
-- unsettled, and the season ledger is EXACTLY as captured (sum + row count).
-- Always aborts via the final RAISE.
--
-- Fill materialization vectors: T1 carries an unscored fill slot whose value
-- (130) is passed via p_fill_scores. The team_prop line is pinned at 260.5 so
-- the over WINS ONLY IF the fill is included (150+130=280 > 260.5; 150 alone
-- loses) — proving settlement grades on the materialized score. Also asserts:
-- the fill mints no score_credit, the pre-image lands in the snapshot, the
-- fill reverts to NULL on unarchive, invalid/stale payloads RAISE, and an
-- archive with NO payload trips the coverage guard (outdated-client vector).
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid; v_week_no int;
  v_mkt uuid; v_sel uuid;
  v_bet uuid;
  v_run uuid;
  v_t1 uuid; v_t2 uuid; v_slot1 uuid; v_slot2 uuid; v_slot_fill uuid; v_game uuid;
  v_fill_payload jsonb;
  v_mkt_tp uuid; v_sel_tp_over uuid; v_bet_tp uuid;
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

  -- team_prop fixture: the game INSERT fires trg_resync_markets_games →
  -- sync_team_prop_markets_for_week creates the markets via the live coupling
  -- path. Scores exist (T1 Σ=150), so the total_pins market settles AT archive.
  INSERT INTO public.teams (week_id, team_number) VALUES (v_week, 998) RETURNING id INTO v_t1;
  INSERT INTO public.teams (week_id, team_number) VALUES (v_week, 999) RETURNING id INTO v_t2;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t1, 1, v_p1) RETURNING id INTO v_slot1;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t2, 1, v_p2) RETURNING id INTO v_slot2;
  -- Fill slot (player_id NULL → is_fill generated true) BEFORE the game insert
  -- so the participation seed trigger gives it a blank score row too.
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t1, 2, NULL) RETURNING id INTO v_slot_fill;
  INSERT INTO public.games (game_number, team_a_id, team_b_id) VALUES (1, v_t1, v_t2) RETURNING id INTO v_game;
  -- Score rows are auto-seeded blank at game creation — fill them in.
  -- The fill's row stays NULL: its value arrives via p_fill_scores at archive.
  UPDATE public.scores SET score = 150 WHERE team_slot_id = v_slot1 AND game_id = v_game;
  UPDATE public.scores SET score = 120 WHERE team_slot_id = v_slot2 AND game_id = v_game;
  -- Cover EVERY unscored fill row of the week (the live week may carry real
  -- fill slots beyond the fixture's) — the coverage guard rejects an archive
  -- that leaves any uncovered. All valued 130 for deterministic grading.
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
  -- Pin the line for deterministic grading (seeded line floats with live
  -- averages) — above T1's real score alone (150) but below real+fill (280),
  -- so the over only wins if the materialized fill counts.
  UPDATE public.bet_selections SET line = 260.5 WHERE market_id = v_mkt_tp;
  SELECT id INTO v_sel_tp_over FROM public.bet_selections
    WHERE market_id = v_mkt_tp AND key = 'over';

  -- The scoreless voidable market is hand-inserted AFTER the team fixture: the
  -- fixture's triggers resync the week's markets, and the O/U prune would
  -- delete-refund a subjectless market. Nothing resyncs after this point.
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE roundtrip market', v_week, 1, 'open') RETURNING id INTO v_mkt;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_sel;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'under', 'Under', 2.000, 100.5);

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_sel], 50) INTO v_bet;
  SELECT public.place_house_bet(ARRAY[v_sel_tp_over], 50) INTO v_bet_tp;

  ------------------------------------------------------------------ capture
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_pre_sum, v_pre_n
    FROM public.pin_ledger WHERE season_id = v_season;

  ------------------------------------------------------------------ archive
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);

  -- Negative vectors first (each rolls back in its own subtransaction):
  -- a payload targeting a non-fill slot must RAISE...
  BEGIN
    PERFORM public.archive_week(v_week, true, jsonb_build_array(jsonb_build_object(
      'team_slot_id', v_slot1, 'game_id', v_game, 'score', 130)));
    RAISE EXCEPTION 'PROBE_FAIL: non-fill payload row did not raise';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%fill-score payload%' THEN RAISE; END IF;
  END;
  -- ...as must a payload for a fill whose score is already stored (stale screen)...
  BEGIN
    UPDATE public.scores SET score = 99 WHERE team_slot_id = v_slot_fill AND game_id = v_game;
    PERFORM public.archive_week(v_week, true, v_fill_payload);
    RAISE EXCEPTION 'PROBE_FAIL: already-scored fill payload did not raise';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%fill-score payload%' THEN RAISE; END IF;
  END;
  -- ...and an archive that omits the payload entirely (outdated client) must
  -- trip the coverage guard while unscored fill rows exist in a bowled week.
  BEGIN
    PERFORM public.archive_week(v_week, true, NULL);
    RAISE EXCEPTION 'PROBE_FAIL: uncovered unscored fill did not trip the coverage guard';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%Unscored fill slots remain%' THEN RAISE; END IF;
  END;

  SELECT public.archive_week(v_week, true, v_fill_payload) INTO v_run;

  IF (SELECT score FROM public.scores WHERE team_slot_id = v_slot_fill AND game_id = v_game) IS DISTINCT FROM 130 THEN
    RAISE EXCEPTION 'PROBE_FAIL: fill score not materialized to 130 by archive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.week_archive_snapshot
                 WHERE run_id = v_run AND kind = 'preimage_row' AND table_name = 'scores') THEN
    RAISE EXCEPTION 'PROBE_FAIL: fill score pre-image missing from snapshot';
  END IF;
  -- The fill cannot mint pincome: the mint's WHERE filters player_id IS NOT
  -- NULL AND is_fill = false (and the fixture's seed rows trip the mint's
  -- per-week guard anyway). The ledger equality check below is the invariant.

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

  -- team_prop: settled at archive (NOT exempted — clock='archive'), graded on
  -- real + materialized fill (150 + 130 = 280) — won only because 280 > 260.5.
  IF (SELECT status FROM public.bet_markets WHERE id = v_mkt_tp) <> 'settled'
     OR (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_tp) <> 280 THEN
    RAISE EXCEPTION 'PROBE_FAIL: team_prop total_pins market not settled at 280 (real 150 + fill 130) by archive';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: team_prop bet not won at archive — fill score not counted (got %)',
      (SELECT status FROM public.bets WHERE id = v_bet_tp);
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE bet_id = v_bet_tp;
  IF v_got <> 0 OR (SELECT count(*) FROM public.pin_ledger WHERE bet_id = v_bet_tp) <> 4 THEN
    RAISE EXCEPTION 'PROBE_FAIL: won team_prop bet ledger wrong (net %, rows %)',
      v_got, (SELECT count(*) FROM public.pin_ledger WHERE bet_id = v_bet_tp);
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

  -- team_prop surgical reversal: market/selections/legs/bet back to pre-images.
  IF (SELECT status FROM public.bet_markets WHERE id = v_mkt_tp) <> 'open'
     OR (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_tp) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: team_prop market not restored to open/unsettled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bet_selections WHERE market_id = v_mkt_tp AND result IS NOT NULL) THEN
    RAISE EXCEPTION 'PROBE_FAIL: team_prop selection results not cleared by unarchive';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'pending'
     OR EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet_tp AND result IS NOT NULL) THEN
    RAISE EXCEPTION 'PROBE_FAIL: team_prop bet/legs not restored to pending';
  END IF;

  -- Fill materialization reversed: the score row is back to NULL (unscored).
  IF (SELECT score FROM public.scores WHERE team_slot_id = v_slot_fill AND game_id = v_game) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: materialized fill score not reverted to NULL by unarchive';
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
    'bet_voided_then_restored', true,
    'team_prop_settled_then_restored', true,
    'fill_materialized_then_reverted', true);
END $$;
