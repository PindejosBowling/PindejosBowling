-- Energy Drink probe — self-contained, assertion-grade
-- (see context/db-verification.md).
--
-- Fixtures: 1 synthetic player seeded 1000 pins, 3 synthetic open over_under
-- markets (odds 2.000, line 100.5), 3 granted Energy Drinks. Live anchors:
-- active season + open week.
--
-- Three branches of the profit-doubling mechanic, each a single bet on its own
-- market (a boost helps any winning bet — no parlay floor):
--   A) single over + boost, settle WON → bet_payout 100 (50 × 2.0) PLUS a
--      House-funded bet_odds_boost bonus of 50 (profit 50 × boost_pct 1.0 ⇒
--      1:1 becomes 2:1); a sportsbook_boost_hit feed row is published.
--   B) single over + boost, settle LOST → no bonus, no feed event, boost still
--      consumed at placement.
--   C) single over + boost, settle PUSH (exact line) → stake refunded, no bonus,
--      no feed event, boost still consumed.
-- Asserts statuses, payout, the boost bonus + ledger type, item consumption,
-- feed publication, and double-entry net-zero; raises PROBE_RESULT.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_p1 uuid;
  v_season uuid; v_week uuid;
  v_mkt_a uuid; v_mkt_b uuid; v_mkt_c uuid;
  v_a uuid; v_b uuid; v_c uuid;        -- "over" selections
  v_boost1 uuid; v_boost2 uuid; v_boost3 uuid;
  v_betA uuid; v_betB uuid; v_betC uuid;
  c_seed constant int := 1000;
  v_got int;
  v_result jsonb;
  v_boosts uuid[];
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000052');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'Boost', '+10000000052', v_u1) RETURNING id INTO v_p1;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    VALUES (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  -- 3 markets, each over @2.000 / under @2.000, line 100.5.
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE boost A', v_week, 1, 'open') RETURNING id INTO v_mkt_a;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_a, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_a;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_a, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE boost B', v_week, 2, 'open') RETURNING id INTO v_mkt_b;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_b, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_b;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_b, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE boost C', v_week, 3, 'open') RETURNING id INTO v_mkt_c;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_c, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_c;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_c, 'under', 'Under', 2.000, 100.5);

  ------------------------------------------------------------------ grant boosts
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.grant_inventory_item(v_p1, 'energy_drink', 3);

  SELECT array_agg(id ORDER BY id) INTO v_boosts
    FROM public.player_inventory_items
    WHERE player_id = v_p1 AND consumed_at IS NULL;
  IF v_boosts IS NULL OR array_length(v_boosts, 1) <> 3 THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: expected 3 granted energy drinks';
  END IF;
  v_boost1 := v_boosts[1];
  v_boost2 := v_boosts[2];
  v_boost3 := v_boosts[3];

  ------------------------------------------------------------------ place bets
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  -- 6th arg = the boost slot.
  SELECT public.place_house_bet(ARRAY[v_a], 50, NULL, NULL, NULL, v_boost1) INTO v_betA;
  SELECT public.place_house_bet(ARRAY[v_b], 50, NULL, NULL, NULL, v_boost2) INTO v_betB;
  SELECT public.place_house_bet(ARRAY[v_c], 50, NULL, NULL, NULL, v_boost3) INTO v_betC;

  -- All three boosts consumed at placement, win or lose.
  IF (SELECT count(*) FROM public.player_inventory_items
      WHERE id IN (v_boost1, v_boost2, v_boost3) AND consumed_at IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'PROBE_FAIL: boosts not all consumed at placement';
  END IF;

  ------------------------------------------------------------------ settle markets
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_market(v_mkt_a, 101.5);  -- over WINS
  PERFORM public.settle_market(v_mkt_b, 99.5);   -- over LOSES
  PERFORM public.settle_market(v_mkt_c, 100.5);  -- exact line → PUSH

  ------------------------------------------------------------------ assertions: A (won + boost)
  IF (SELECT status FROM public.bets WHERE id = v_betA) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: A not won';
  END IF;
  IF (SELECT potential_payout FROM public.bets WHERE id = v_betA) <> 100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A payout % <> 100 (50 × 2.0)',
      (SELECT potential_payout FROM public.bets WHERE id = v_betA);
  END IF;
  -- The House-funded boost bonus = floor(profit × boost_pct) = (100 − 50) × 1.0 = 50.
  IF (SELECT COALESCE(SUM(amount), 0) FROM public.pin_ledger
      WHERE bet_id = v_betA AND type = 'bet_odds_boost' AND player_id = v_p1) <> 50 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A boost bonus % <> 50',
      (SELECT COALESCE(SUM(amount), 0) FROM public.pin_ledger
       WHERE bet_id = v_betA AND type = 'bet_odds_boost' AND player_id = v_p1);
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betA AND event_type = 'sportsbook_boost_hit') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A expected one sportsbook_boost_hit feed row';
  END IF;

  ------------------------------------------------------------------ assertions: B (lost)
  IF (SELECT status FROM public.bets WHERE id = v_betB) <> 'lost' THEN
    RAISE EXCEPTION 'PROBE_FAIL: B not lost';
  END IF;
  IF (SELECT count(*) FROM public.pin_ledger
      WHERE bet_id = v_betB AND type = 'bet_odds_boost') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: B should have no boost bonus on a loss';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betB AND event_type = 'sportsbook_boost_hit') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: B should publish no boost_hit event';
  END IF;

  ------------------------------------------------------------------ assertions: C (push)
  IF (SELECT status FROM public.bets WHERE id = v_betC) <> 'push' THEN
    RAISE EXCEPTION 'PROBE_FAIL: C not push';
  END IF;
  IF (SELECT count(*) FROM public.pin_ledger
      WHERE bet_id = v_betC AND type = 'bet_odds_boost') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: C should have no boost bonus on a push';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betC AND event_type = 'sportsbook_boost_hit') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: C should publish no boost_hit event';
  END IF;

  ------------------------------------------------------------------ net pin flow
  -- Player net (excl. the seed mint): A (−50 stake +100 payout +50 bonus = +100),
  -- B loses 50, C pushes (−50 stake +50 refund = 0) → +50.
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> 50 THEN
    RAISE EXCEPTION 'PROBE_FAIL: player net % (expected +50 = +100 A − 50 B + 0 C)', v_got;
  END IF;
  -- Double-entry: every movement this tx (excl. the seed mint) nets to zero.
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type <> 'score_credit';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: non-mint movements net to % (expected 0)', v_got;
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'A_status',     (SELECT status FROM public.bets WHERE id = v_betA),
    'A_payout',     (SELECT potential_payout FROM public.bets WHERE id = v_betA),
    'A_boost_bonus',(SELECT COALESCE(SUM(amount), 0) FROM public.pin_ledger
                     WHERE bet_id = v_betA AND type = 'bet_odds_boost' AND player_id = v_p1),
    'B_status',     (SELECT status FROM public.bets WHERE id = v_betB),
    'C_status',     (SELECT status FROM public.bets WHERE id = v_betC),
    'boost_events', (SELECT count(*) FROM public.activity_feed_events
                     WHERE event_type = 'sportsbook_boost_hit' AND created_at = now()),
    'player_net',   50
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
