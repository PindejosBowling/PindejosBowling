-- Combo-lines probe — self-contained, assertion-grade (see
-- context/db-verification.md). Exercises the SLIP-shaped compose_combo_bet
-- (jsonb spec array + extras), the RSVP-out auto-void prune, and settle_week
-- (c''') on both clocks, with zero persistence.
--
-- Fixtures: 3 players seeded 1000 pins on the live open week; P1/P2 RSVP'd in
-- and rostered on two probe teams with game 1 scores 150/120; later, official
-- LaneTalk imports (P1: 3 strikes/2 spares, P2: 2/1). P3 starts un-RSVP'd.
--
-- Vectors:
--   C1 compose (P1, strikes night 100)  → market + 2 selections (line 0.5 —
--      importless members clamp), sorted member_ids, canonical combo_key,
--      pending bet, bet_stake pair nets 0, ONE compose feed card.
--   C2 dedup (P2, shuffled order)       → same market, deduped=true, no card.
--   C2b multi-combo parlay (P1, spares night + clean_frames game 1, one call)
--      → ONE bet, 2 legs, 2 new markets, payout ×4, one compose card
--      (combo_count 2).
--   C3 validation negatives             → <2 members, dup members, non-RSVP'd
--      member, bad stat, night+game_number, off-schedule game, min stake,
--      duplicate spec on one ticket, self-referential parlay extra — all RAISE.
--   C4 anti-tank                        → member backing under RAISES;
--      non-member backing under is allowed (mechanic preserved).
--   C5 combo + regular-line parlay (clean_frames night + synthetic O/U extra)
--      → one bet, 2 legs, payout = stake × 4.
--   C6 total_pins combo (archive clock; line pinned to 260.5).
--   C7 RSVP-out auto-void → market + bet + ledger pair + feed card all gone
--      (erasure, balances restored); flip back in does NOT resurrect;
--      recompose mints a NEW market.
--   C7b admin cancel_bet → cancelling one of two bets on a combo leaves the
--      market; cancelling the LAST bet prunes the orphaned combo whole
--      (market + selections + ledger + feed card).
--   C8/C9 settle_week(force): strikes night = 5 → won; multi-combo parlay
--      (3 + 8) → won ×4; clean_frames/O-U parlay → won ×4; total_pins 270 >
--      260.5 → won; P3's under → lost; the import-less recomposed combo stays
--      PENDING (backstop-exempt), then settle_week(void_missing)
--      delete-refunds it. Re-settle idempotent.
-- Always aborts via the final RAISE.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_u3 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_season uuid; v_week uuid;
  v_t1 uuid; v_t2 uuid; v_slot1 uuid; v_slot2 uuid; v_game uuid;
  v_fill_payload jsonb;
  v_res jsonb;
  v_mkt_strikes uuid; v_bet1 uuid; v_bet2 uuid;
  v_under_strikes uuid; v_bet_under uuid;
  v_mkt_ou uuid; v_sel_ou uuid;
  v_mkt_cf uuid; v_bet_cf uuid;
  v_mkt_sp uuid; v_mkt_cfg uuid; v_bet_multi uuid;
  v_mkt_tp uuid; v_bet_tp uuid;
  v_mkt_void uuid; v_bet_void uuid; v_mkt_re uuid; v_bet_re uuid;
  v_mkt_ca uuid; v_bet_ca uuid; v_bet_cb uuid;
  v_expected_members jsonb;
  v_pre_void_sum bigint; v_pre_void_n bigint;
  v_set_sum bigint; v_set_n bigint;
  v_got bigint; v_got_n bigint;
  c_seed constant int := 1000;
  c_payload_p1 constant jsonb := jsonb_build_object('frames', jsonb_build_array(
    jsonb_build_object('is_strike', true),  jsonb_build_object('is_strike', true),
    jsonb_build_object('is_strike', true),  jsonb_build_object('is_spare', true),
    jsonb_build_object('is_spare', true),   jsonb_build_object(),
    jsonb_build_object(), jsonb_build_object(), jsonb_build_object(), jsonb_build_object()));
  c_payload_p2 constant jsonb := jsonb_build_object('frames', jsonb_build_array(
    jsonb_build_object('is_strike', true),  jsonb_build_object('is_strike', true),
    jsonb_build_object('is_spare', true),   jsonb_build_object(),
    jsonb_build_object(), jsonb_build_object(), jsonb_build_object(),
    jsonb_build_object(), jsonb_build_object(), jsonb_build_object()));
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000071'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000072'),
    (v_u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000073');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'ComboOne', '+10000000071', v_u1) RETURNING id INTO v_p1;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'ComboTwo', '+10000000072', v_u2) RETURNING id INTO v_p2;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'ComboThree', '+10000000073', v_u3) RETURNING id INTO v_p3;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p3, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  INSERT INTO public.rsvp (week_id, player_id, status) VALUES
    (v_week, v_p1, 'in'), (v_week, v_p2, 'in');

  INSERT INTO public.teams (week_id, team_number) VALUES (v_week, 998) RETURNING id INTO v_t1;
  INSERT INTO public.teams (week_id, team_number) VALUES (v_week, 999) RETURNING id INTO v_t2;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t1, 1, v_p1) RETURNING id INTO v_slot1;
  INSERT INTO public.team_slots (team_id, slot, player_id) VALUES (v_t2, 1, v_p2) RETURNING id INTO v_slot2;
  INSERT INTO public.games (game_number, team_a_id, team_b_id) VALUES (1, v_t1, v_t2) RETURNING id INTO v_game;
  UPDATE public.scores SET score = 150 WHERE team_slot_id = v_slot1 AND game_id = v_game;
  UPDATE public.scores SET score = 120 WHERE team_slot_id = v_slot2 AND game_id = v_game;

  ------------------------------------------------------------------ C1 compose
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'strikes', 'scope', 'night')), 100);
  v_mkt_strikes := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_bet1        := (v_res ->> 'bet_id')::uuid;
  IF (v_res -> 'combos' -> 0 ->> 'deduped')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: first compose reported deduped';
  END IF;
  IF (v_res -> 'combos' -> 0 ->> 'line')::numeric <> 0.5 THEN
    RAISE EXCEPTION 'PROBE_FAIL: importless-member seed line % (expected 0.5)', v_res -> 'combos' -> 0 ->> 'line';
  END IF;
  IF (SELECT count(*) FROM public.bet_selections WHERE market_id = v_mkt_strikes) <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: combo market does not have exactly 2 selections';
  END IF;
  SELECT to_jsonb(ARRAY[LEAST(v_p1, v_p2)::text, GREATEST(v_p1, v_p2)::text]) INTO v_expected_members;
  IF (SELECT params -> 'member_ids' FROM public.bet_markets WHERE id = v_mkt_strikes) <> v_expected_members THEN
    RAISE EXCEPTION 'PROBE_FAIL: member_ids not sorted/canonical';
  END IF;
  IF (SELECT params ->> 'combo_key' FROM public.bet_markets WHERE id = v_mkt_strikes)
     <> 'strikes|night|n|' || LEAST(v_p1, v_p2)::text || ',' || GREATEST(v_p1, v_p2)::text THEN
    RAISE EXCEPTION 'PROBE_FAIL: combo_key not canonical';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet1) <> 'pending' THEN
    RAISE EXCEPTION 'PROBE_FAIL: compose bet not pending';
  END IF;
  IF (SELECT COALESCE(SUM(amount), 0) FROM public.pin_ledger WHERE bet_id = v_bet1 AND type = 'bet_stake') <> 0
     OR (SELECT count(*) FROM public.pin_ledger WHERE bet_id = v_bet1 AND type = 'bet_stake') <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet_stake double entry wrong for compose bet';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_bet1 AND event_type = 'sportsbook_combo_composed') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected exactly one compose feed card';
  END IF;

  ------------------------------------------------------------------ C2 dedup
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p2::text, v_p1::text),
             'stat', 'strikes', 'scope', 'night')), 50);
  v_bet2 := (v_res ->> 'bet_id')::uuid;
  IF NOT (v_res -> 'combos' -> 0 ->> 'deduped')::boolean
     OR (v_res -> 'combos' -> 0 ->> 'market_id')::uuid <> v_mkt_strikes THEN
    RAISE EXCEPTION 'PROBE_FAIL: shuffled recompose did not dedup to the existing market';
  END IF;
  IF (SELECT count(*) FROM public.bet_markets
      WHERE week_id = v_week AND market_type = 'combo'
        AND params ->> 'combo_key' LIKE 'strikes|night|n|%') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: duplicate combo market created';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_bet2 AND event_type = 'sportsbook_combo_composed') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: dedup join published a compose card';
  END IF;

  ------------------------------------------------------------------ C2b multi-combo parlay
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(
             jsonb_build_object('member_ids', jsonb_build_array(v_p1::text, v_p2::text),
                                'stat', 'spares', 'scope', 'night'),
             jsonb_build_object('member_ids', jsonb_build_array(v_p1::text, v_p2::text),
                                'stat', 'clean_frames', 'scope', 'game', 'game_number', 1)), 50);
  v_bet_multi := (v_res ->> 'bet_id')::uuid;
  v_mkt_sp  := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_mkt_cfg := (v_res -> 'combos' -> 1 ->> 'market_id')::uuid;
  IF jsonb_array_length(v_res -> 'combos') <> 2 OR v_mkt_sp = v_mkt_cfg THEN
    RAISE EXCEPTION 'PROBE_FAIL: multi-combo ticket did not mint two markets';
  END IF;
  IF (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_bet_multi) <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: multi-combo bet does not have 2 legs';
  END IF;
  IF (SELECT potential_payout FROM public.bets WHERE id = v_bet_multi) <> 200 THEN
    RAISE EXCEPTION 'PROBE_FAIL: multi-combo payout % (expected 200 = 50 × 4)',
      (SELECT potential_payout FROM public.bets WHERE id = v_bet_multi);
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_bet_multi AND event_type = 'sportsbook_combo_composed') <> 1
     OR (SELECT public_payload ->> 'combo_count' FROM public.activity_feed_events
         WHERE sportsbook_bet_id = v_bet_multi AND event_type = 'sportsbook_combo_composed') <> '2' THEN
    RAISE EXCEPTION 'PROBE_FAIL: multi-combo ticket should post ONE card with combo_count 2';
  END IF;

  ------------------------------------------------------------------ C3 negatives
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text), 'stat', 'strikes', 'scope', 'night')), 100);
    RAISE EXCEPTION 'PROBE_FAIL: single-member combo was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p1::text), 'stat', 'strikes', 'scope', 'night')), 100);
    RAISE EXCEPTION 'PROBE_FAIL: duplicate-member combo was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p3::text), 'stat', 'strikes', 'scope', 'night')), 100);
    RAISE EXCEPTION 'PROBE_FAIL: non-RSVP''d member was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p2::text), 'stat', 'first_ball_avg', 'scope', 'night')), 100);
    RAISE EXCEPTION 'PROBE_FAIL: bad stat was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p2::text), 'stat', 'spares', 'scope', 'night', 'game_number', 1)), 100);
    RAISE EXCEPTION 'PROBE_FAIL: night combo with game_number was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p2::text), 'stat', 'spares', 'scope', 'game', 'game_number', 9)), 100);
    RAISE EXCEPTION 'PROBE_FAIL: off-schedule game number was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p2::text), 'stat', 'spares', 'scope', 'game', 'game_number', 1)), 9);
    RAISE EXCEPTION 'PROBE_FAIL: sub-minimum stake was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(
              jsonb_build_object('member_ids', jsonb_build_array(v_p1::text, v_p2::text), 'stat', 'strikes', 'scope', 'night'),
              jsonb_build_object('member_ids', jsonb_build_array(v_p2::text, v_p1::text), 'stat', 'strikes', 'scope', 'night')), 100);
    RAISE EXCEPTION 'PROBE_FAIL: the same combo twice on one ticket was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  SELECT id INTO v_under_strikes FROM public.bet_selections
    WHERE market_id = v_mkt_strikes AND key = 'under';
  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
              'member_ids', jsonb_build_array(v_p1::text, v_p2::text), 'stat', 'strikes', 'scope', 'night')), 100,
              ARRAY[v_under_strikes]);
    RAISE EXCEPTION 'PROBE_FAIL: self-referential parlay extra was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;

  ------------------------------------------------------------------ C4 anti-tank
  BEGIN
    PERFORM public.place_house_bet(ARRAY[v_under_strikes], 50);
    RAISE EXCEPTION 'PROBE_FAIL: member was allowed to back the under on their own combo';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u3, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_under_strikes], 50) INTO v_bet_under;  -- non-member: allowed

  ------------------------------------------------------------------ C5 combo + regular-line parlay
  -- Use the trigger-created O/U market for P1 game 1 (a synthetic subject-less
  -- market would be pruned by the next resync). Pin its line, then the compose
  -- bet freezes it against reseeds; settle_week (b) grades it at P1's 150.
  SELECT id INTO v_mkt_ou FROM public.bet_markets
    WHERE week_id = v_week AND market_type = 'over_under'
      AND subject_player_id = v_p1 AND game_number = 1 AND status = 'open';
  IF v_mkt_ou IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no auto-synced O/U market for P1 game 1';
  END IF;
  UPDATE public.bet_selections SET line = 100.5 WHERE market_id = v_mkt_ou;
  SELECT id INTO v_sel_ou FROM public.bet_selections
    WHERE market_id = v_mkt_ou AND key = 'over';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'clean_frames', 'scope', 'night')), 50,
             ARRAY[v_sel_ou]);
  v_mkt_cf := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_bet_cf := (v_res ->> 'bet_id')::uuid;
  IF (v_res -> 'combos' -> 0 ->> 'deduped')::boolean OR v_mkt_cf = v_mkt_strikes THEN
    RAISE EXCEPTION 'PROBE_FAIL: clean_frames compose did not mint its own market';
  END IF;
  IF (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_bet_cf) <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: combo+line parlay bet does not have 2 legs';
  END IF;
  IF (SELECT potential_payout FROM public.bets WHERE id = v_bet_cf) <> 200 THEN
    RAISE EXCEPTION 'PROBE_FAIL: parlay payout % (expected 200 = 50 × 4)',
      (SELECT potential_payout FROM public.bets WHERE id = v_bet_cf);
  END IF;

  ------------------------------------------------------------------ C6 total_pins (archive clock)
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'total_pins', 'scope', 'night')), 100);
  v_mkt_tp := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_bet_tp := (v_res ->> 'bet_id')::uuid;
  -- Pin the line so the grading assertion is deterministic (fixture control;
  -- grading reads the selection line, not line_at_placement).
  UPDATE public.bet_selections SET line = 260.5 WHERE market_id = v_mkt_tp;

  ------------------------------------------------------------------ C7 RSVP-out auto-void
  INSERT INTO public.rsvp (week_id, player_id, status) VALUES (v_week, v_p3, 'in');
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u3, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_pre_void_sum, v_pre_void_n
    FROM public.pin_ledger WHERE season_id = v_season;
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p3::text, v_p1::text),
             'stat', 'spares', 'scope', 'game', 'game_number', 1)), 100);
  v_mkt_void := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_bet_void := (v_res ->> 'bet_id')::uuid;

  UPDATE public.rsvp SET status = 'out' WHERE week_id = v_week AND player_id = v_p3;
  IF EXISTS (SELECT 1 FROM public.bet_markets WHERE id = v_mkt_void) THEN
    RAISE EXCEPTION 'PROBE_FAIL: RSVP-out did not prune the combo market';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bets WHERE id = v_bet_void) THEN
    RAISE EXCEPTION 'PROBE_FAIL: RSVP-out did not erase the combo bet';
  END IF;
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_pre_void_sum OR v_got_n <> v_pre_void_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: auto-void did not restore the ledger (sum %/%, rows %/%)',
      v_got, v_pre_void_sum, v_got_n, v_pre_void_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.activity_feed_events WHERE sportsbook_bet_id = v_bet_void) THEN
    RAISE EXCEPTION 'PROBE_FAIL: auto-void did not cascade the feed card away';
  END IF;

  UPDATE public.rsvp SET status = 'in' WHERE week_id = v_week AND player_id = v_p3;
  IF EXISTS (SELECT 1 FROM public.bet_markets WHERE id = v_mkt_void) THEN
    RAISE EXCEPTION 'PROBE_FAIL: flip-back-in resurrected the voided market';
  END IF;
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p3::text, v_p1::text),
             'stat', 'spares', 'scope', 'game', 'game_number', 1)), 100);
  v_mkt_re := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_bet_re := (v_res ->> 'bet_id')::uuid;
  IF v_mkt_re = v_mkt_void THEN
    RAISE EXCEPTION 'PROBE_FAIL: recompose reused the erased market id';
  END IF;

  ------------------------------------------------------------------ C7b admin cancel prunes orphan combos
  -- P1 composes total_pins game 1; P2 dedup-joins → 2 bets on one market.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'total_pins', 'scope', 'game', 'game_number', 1)), 50);
  v_mkt_ca := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_bet_ca := (v_res ->> 'bet_id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'total_pins', 'scope', 'game', 'game_number', 1)), 50);
  v_bet_cb := (v_res ->> 'bet_id')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  -- Cancel one of two: the market must SURVIVE (a bet still rides it).
  PERFORM public.cancel_bet(v_bet_ca);
  IF NOT EXISTS (SELECT 1 FROM public.bet_markets WHERE id = v_mkt_ca) THEN
    RAISE EXCEPTION 'PROBE_FAIL: cancel of one bet deleted a combo still carrying another';
  END IF;
  -- Cancel the last: the orphaned combo must be pruned whole.
  PERFORM public.cancel_bet(v_bet_cb);
  IF EXISTS (SELECT 1 FROM public.bet_markets WHERE id = v_mkt_ca)
     OR EXISTS (SELECT 1 FROM public.bets WHERE id IN (v_bet_ca, v_bet_cb))
     OR EXISTS (SELECT 1 FROM public.pin_ledger WHERE bet_id IN (v_bet_ca, v_bet_cb))
     OR EXISTS (SELECT 1 FROM public.activity_feed_events WHERE sportsbook_bet_id IN (v_bet_ca, v_bet_cb)) THEN
    RAISE EXCEPTION 'PROBE_FAIL: cancelling the last combo bet did not prune the orphaned market clean';
  END IF;

  ------------------------------------------------------------------ C8 imports + settle prep
  INSERT INTO public.lanetalk_game_imports
      (source_url, game_number, classification, player_id, week_id, payload)
    VALUES
      ('probe://combo-fixture/p1', 1, 'official', v_p1, v_week, c_payload_p1),
      ('probe://combo-fixture/p2', 1, 'official', v_p2, v_week, c_payload_p2);

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_slot_id', s.team_slot_id, 'game_id', s.game_id, 'score', 130)), '[]'::jsonb)
    INTO v_fill_payload
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
   WHERE t.week_id = v_week AND ts.is_fill AND s.score IS NULL;
  PERFORM public.advance_week(v_week, true, v_fill_payload);

  ------------------------------------------------------------------ C9 settle
  PERFORM public.settle_week(v_week, false, true);

  -- Strikes night combo: 3 + 2 = 5 > 0.5 → over won.
  IF (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_strikes) <> 5 THEN
    RAISE EXCEPTION 'PROBE_FAIL: strikes combo settled at % (expected 5)',
      (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_strikes);
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet1) <> 'won'
     OR (SELECT status FROM public.bets WHERE id = v_bet2) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: strikes combo over bets not won';
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_under) <> 'lost' THEN
    RAISE EXCEPTION 'PROBE_FAIL: non-member under bet not lost';
  END IF;
  -- Multi-combo parlay: spares night 2+1=3 AND clean_frames game 5+3=8 → won ×4.
  IF (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_sp) <> 3
     OR (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_cfg) <> 8 THEN
    RAISE EXCEPTION 'PROBE_FAIL: multi-combo markets settled at %/% (expected 3/8)',
      (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_sp),
      (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_cfg);
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_multi) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: multi-combo parlay bet not won';
  END IF;
  -- Combo + regular-line parlay: combo 5 + 3 = 8 > 0.5 AND O/U leg won → paid ×4.
  IF (SELECT status FROM public.bets WHERE id = v_bet_cf) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: combo+line parlay bet not won';
  END IF;
  IF (SELECT COALESCE(SUM(amount), 0) FROM public.pin_ledger
      WHERE bet_id = v_bet_cf AND type = 'bet_payout' AND player_id = v_p1) <> 200 THEN
    RAISE EXCEPTION 'PROBE_FAIL: parlay payout ledger % (expected 200)',
      (SELECT COALESCE(SUM(amount), 0) FROM public.pin_ledger
       WHERE bet_id = v_bet_cf AND type = 'bet_payout' AND player_id = v_p1);
  END IF;
  -- Total pins (archive clock): 150 + 120 = 270 > 260.5 → won.
  IF (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_tp) <> 270 THEN
    RAISE EXCEPTION 'PROBE_FAIL: total_pins combo settled at % (expected 270)',
      (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_tp);
  END IF;
  IF (SELECT status FROM public.bets WHERE id = v_bet_tp) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: total_pins combo bet not won';
  END IF;
  -- Import-less member (P3) combo: left PENDING, exempt from the backstop.
  IF (SELECT status FROM public.bet_markets WHERE id = v_mkt_re) = 'settled'
     OR (SELECT status FROM public.bets WHERE id = v_bet_re) <> 'pending' THEN
    RAISE EXCEPTION 'PROBE_FAIL: import-less combo was not left pending';
  END IF;

  -- Idempotency.
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_set_sum, v_set_n
    FROM public.pin_ledger WHERE season_id = v_season;
  PERFORM public.settle_week(v_week, false, true);
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_got, v_got_n
    FROM public.pin_ledger WHERE season_id = v_season;
  IF v_got <> v_set_sum OR v_got_n <> v_set_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: combo re-settle not idempotent';
  END IF;

  -- void_missing: the import-less combo is delete-refunded whole.
  PERFORM public.settle_week(v_week, true, true);
  IF EXISTS (SELECT 1 FROM public.bet_markets WHERE id = v_mkt_re)
     OR EXISTS (SELECT 1 FROM public.bets WHERE id = v_bet_re)
     OR EXISTS (SELECT 1 FROM public.pin_ledger WHERE bet_id = v_bet_re) THEN
    RAISE EXCEPTION 'PROBE_FAIL: void_missing did not delete-refund the import-less combo';
  END IF;

  RAISE EXCEPTION 'PROBE_RESULT %', jsonb_build_object(
    'compose', 'ok',
    'strikes_value', (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_strikes),
    'total_pins_value', (SELECT result_value FROM public.bet_markets WHERE id = v_mkt_tp),
    'multi_combo_parlay', 'won_x4',
    'combo_line_parlay_payout', 200,
    'dedup', true, 'negatives_rejected', 9, 'anti_tank', true,
    'auto_void_erased', true, 'no_resurrection', true,
    'cancel_prunes_orphans', true,
    'pending_exempt', true, 'void_missing_refunded', true,
    'settle_idempotent', true);
END $$;
