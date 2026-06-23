-- Winner's Crutch probe — self-contained, assertion-grade
-- (see context/db-verification.md).
--
-- Fixtures: 1 synthetic player seeded 1000 pins, 7 synthetic open over_under
-- markets (odds 2.000, line 100.5), 3 granted Winner's Crutches. Live anchors:
-- active season + open week.
--
-- Three branches of the leg-salvage mechanic, each on its own markets so they
-- settle independently:
--   A) 3-leg parlay (over/over/over) + crutch, settle won/won/LOST →
--      the lone losing leg becomes 'crutched' and drops out; bet WON at the
--      reduced product of the two survivors (50 × 2.0 × 2.0 = 200); a
--      sportsbook_crutch_save feed row is published.
--   B) 2-leg parlay + crutch, settle LOST/LOST → 2 losses, crutch can't fire;
--      bet LOST, no 'crutched' leg, no save event, crutch still consumed.
--   C) 2-leg parlay + crutch, settle LOST/PUSH → the crutch removes the only
--      loss but no won leg survives → bet PUSH, stake refunded.
-- Asserts statuses, payout, leg results, item consumption, feed publication,
-- and double-entry net-zero; raises PROBE_RESULT.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_p1 uuid;
  v_season uuid; v_week uuid;
  v_mkt uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid;   -- case A "over" selections
  v_b1 uuid; v_b2 uuid;              -- case B "over" selections
  v_c1 uuid; v_c2 uuid;             -- case C "over" selections
  v_mkt_a3 uuid; v_mkt_b1 uuid; v_mkt_b2 uuid; v_mkt_c1 uuid; v_mkt_c2 uuid;
  v_mkt_a1 uuid; v_mkt_a2 uuid;
  v_crutch1 uuid; v_crutch2 uuid; v_crutch3 uuid;
  v_betA uuid; v_betB uuid; v_betC uuid;
  c_seed constant int := 1000;
  v_got int;
  v_result jsonb;
  v_crutches uuid[];
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000051');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'Crutch', '+10000000051', v_u1) RETURNING id INTO v_p1;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    VALUES (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  -- 7 markets, each over @2.000 / under @2.000, line 100.5.
  -- Case A markets (won, won, lost).
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch A1', v_week, 1, 'open') RETURNING id INTO v_mkt_a1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_a1, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_a1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_a1, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch A2', v_week, 2, 'open') RETURNING id INTO v_mkt_a2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_a2, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_a2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_a2, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch A3', v_week, 3, 'open') RETURNING id INTO v_mkt_a3;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_a3, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_a3;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_a3, 'under', 'Under', 2.000, 100.5);

  -- Case B markets (lost, lost).
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch B1', v_week, 4, 'open') RETURNING id INTO v_mkt_b1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_b1, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_b1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_b1, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch B2', v_week, 5, 'open') RETURNING id INTO v_mkt_b2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_b2, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_b2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_b2, 'under', 'Under', 2.000, 100.5);

  -- Case C markets (lost, push).
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch C1', v_week, 6, 'open') RETURNING id INTO v_mkt_c1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_c1, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_c1;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_c1, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE crutch C2', v_week, 7, 'open') RETURNING id INTO v_mkt_c2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_c2, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_c2;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_c2, 'under', 'Under', 2.000, 100.5);

  ------------------------------------------------------------------ grant crutches
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.grant_inventory_item(v_p1, 'winners_crutch', 3);

  SELECT array_agg(id ORDER BY id) INTO v_crutches
    FROM public.player_inventory_items
    WHERE player_id = v_p1 AND consumed_at IS NULL;
  IF v_crutches IS NULL OR array_length(v_crutches, 1) <> 3 THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: expected 3 granted crutches';
  END IF;
  v_crutch1 := v_crutches[1];
  v_crutch2 := v_crutches[2];
  v_crutch3 := v_crutches[3];

  ------------------------------------------------------------------ place bets
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_a1, v_a2, v_a3], 50, NULL, NULL, v_crutch1) INTO v_betA;
  SELECT public.place_house_bet(ARRAY[v_b1, v_b2], 50, NULL, NULL, v_crutch2) INTO v_betB;
  SELECT public.place_house_bet(ARRAY[v_c1, v_c2], 50, NULL, NULL, v_crutch3) INTO v_betC;

  -- All three crutches consumed at placement, win or lose.
  IF (SELECT count(*) FROM public.player_inventory_items
      WHERE id IN (v_crutch1, v_crutch2, v_crutch3) AND consumed_at IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'PROBE_FAIL: crutches not all consumed at placement';
  END IF;

  ------------------------------------------------------------------ settle markets
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  -- Case A: over wins, over wins, under wins (the 3rd over leg LOSES).
  PERFORM public.settle_market(v_mkt_a1, 101.5);
  PERFORM public.settle_market(v_mkt_a2, 101.5);
  PERFORM public.settle_market(v_mkt_a3, 99.5);
  -- Case B: under wins on both (both over legs LOSE).
  PERFORM public.settle_market(v_mkt_b1, 99.5);
  PERFORM public.settle_market(v_mkt_b2, 99.5);
  -- Case C: under wins (over leg LOSES), exact line (PUSH).
  PERFORM public.settle_market(v_mkt_c1, 99.5);
  PERFORM public.settle_market(v_mkt_c2, 100.5);

  ------------------------------------------------------------------ assertions: A
  IF (SELECT status FROM public.bets WHERE id = v_betA) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: A not won (crutch should salvage 1-leg miss)';
  END IF;
  IF (SELECT potential_payout FROM public.bets WHERE id = v_betA) <> 200 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A payout % <> 200 (50 × 2.0 × 2.0 over the 2 survivors)',
      (SELECT potential_payout FROM public.bets WHERE id = v_betA);
  END IF;
  IF (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_betA AND result = 'crutched') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A expected exactly one crutched leg';
  END IF;
  IF (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_betA AND result = 'won') <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A expected two won legs';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betA AND event_type = 'sportsbook_crutch_save') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A expected one sportsbook_crutch_save feed row';
  END IF;

  ------------------------------------------------------------------ assertions: B
  IF (SELECT status FROM public.bets WHERE id = v_betB) <> 'lost' THEN
    RAISE EXCEPTION 'PROBE_FAIL: B not lost (2 losses must not be salvaged)';
  END IF;
  IF (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_betB AND result = 'crutched') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: B should have no crutched leg';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betB AND event_type = 'sportsbook_crutch_save') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: B should publish no save event';
  END IF;

  ------------------------------------------------------------------ assertions: C
  IF (SELECT status FROM public.bets WHERE id = v_betC) <> 'push' THEN
    RAISE EXCEPTION 'PROBE_FAIL: C not push (crutch removes the only loss, no survivor → refund)';
  END IF;
  IF (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_betC AND result = 'crutched') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: C expected one crutched leg';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betC AND event_type = 'sportsbook_crutch_save') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: C should publish no save event (no payout, just a refund)';
  END IF;

  ------------------------------------------------------------------ net pin flow
  -- Player net (excl. the seed mint): A pays 200 (−50 stake +200 payout = +150),
  -- B loses 50, C pushes (−50 stake +50 refund = 0) → +100.
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> 100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: player net % (expected +100 = +150 A − 50 B + 0 C)', v_got;
  END IF;
  -- Double-entry: every movement this tx (excl. the seed mint) nets to zero.
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type <> 'score_credit';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: non-mint movements net to % (expected 0)', v_got;
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'A_status',  (SELECT status FROM public.bets WHERE id = v_betA),
    'A_payout',  (SELECT potential_payout FROM public.bets WHERE id = v_betA),
    'A_legs',    (SELECT jsonb_object_agg(result, n) FROM (
                    SELECT result, count(*) n FROM public.bet_legs WHERE bet_id = v_betA GROUP BY result) s),
    'B_status',  (SELECT status FROM public.bets WHERE id = v_betB),
    'C_status',  (SELECT status FROM public.bets WHERE id = v_betC),
    'save_events', (SELECT count(*) FROM public.activity_feed_events
                    WHERE event_type = 'sportsbook_crutch_save' AND created_at = now()),
    'player_net', v_got + 100
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
