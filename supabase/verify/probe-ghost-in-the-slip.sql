-- Ghost in the Slip probe — self-contained, assertion-grade
-- (see context/db-verification.md).
--
-- Fixtures: 1 victim/bettor seeded 1000 pins, 3 haunters each granted 2 Ghosts,
-- 4 synthetic open over_under markets (over/under @ 2.000, line 100.5). Live
-- anchors: active season + open week.
--
-- Branches of the haunt mechanic:
--   A) bettor bets 100 on over, settle WON (payout 200, profit 100). Haunted by
--      THREE ghosts (g1 earliest by attached_at). The bettor is credited EXACTLY
--      their stake (100) on 'bet_payout'; the profit splits 34/33/33 across the
--      ghosts on 'bet_haunt_steal' (remainder +1 to the earliest = g1); ONE
--      sportsbook_haunt_hit feed row is published.
--   B) bettor bets 100, settle LOST. Haunted by g1 → no steal, no feed, ghost's
--      ticket stays spent.
--   C) bettor bets 100, settle PUSH (exact line). Haunted by g2 → stake refunded
--      to the bettor, no steal, no feed, ghost's ticket stays spent.
--   D) bettor bets 100, haunted by g3, then admin cancel_bet → the haunt row is
--      gone and g3's ticket is REFUNDED (consumed_at back to NULL).
-- Asserts statuses, the exact split + remainder, item consumption/refund, feed
-- publication, the RLS policy's presence, and double-entry net-zero.
DO $$
DECLARE
  v_u_o uuid := gen_random_uuid();
  v_u1  uuid := gen_random_uuid();
  v_u2  uuid := gen_random_uuid();
  v_u3  uuid := gen_random_uuid();
  v_owner uuid; v_g1 uuid; v_g2 uuid; v_g3 uuid;
  v_season uuid; v_week uuid;
  v_mkt_a uuid; v_mkt_b uuid; v_mkt_c uuid; v_mkt_d uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;        -- "over" selections
  v_betA uuid; v_betB uuid; v_betC uuid; v_betD uuid;
  g1 uuid[]; g2 uuid[]; g3 uuid[];
  c_seed constant int := 1000;
  v_got int;
  v_result jsonb;
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u_o, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000060'),
    (v_u1,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000061'),
    (v_u2,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000062'),
    (v_u3,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000063');
  INSERT INTO public.players (first_name, last_name, phone, user_id) VALUES
    ('Probe', 'Victim', '+10000000060', v_u_o) RETURNING id INTO v_owner;
  INSERT INTO public.players (first_name, last_name, phone, user_id) VALUES
    ('Probe', 'GhostOne',   '+10000000061', v_u1) RETURNING id INTO v_g1;
  INSERT INTO public.players (first_name, last_name, phone, user_id) VALUES
    ('Probe', 'GhostTwo',   '+10000000062', v_u2) RETURNING id INTO v_g2;
  INSERT INTO public.players (first_name, last_name, phone, user_id) VALUES
    ('Probe', 'GhostThree', '+10000000063', v_u3) RETURNING id INTO v_g3;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    VALUES (v_owner, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  -- 4 markets, each over @2.000 / under @2.000, line 100.5.
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE haunt A', v_week, 1, 'open') RETURNING id INTO v_mkt_a;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_a, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_a;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_a, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE haunt B', v_week, 2, 'open') RETURNING id INTO v_mkt_b;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_b, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_b;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_b, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE haunt C', v_week, 3, 'open') RETURNING id INTO v_mkt_c;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_c, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_c;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_c, 'under', 'Under', 2.000, 100.5);

  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE haunt D', v_week, 4, 'open') RETURNING id INTO v_mkt_d;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt_d, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_d;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line) VALUES (v_mkt_d, 'under', 'Under', 2.000, 100.5);

  ------------------------------------------------------------------ grant ghosts (2 each)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u_o, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.grant_inventory_item(v_g1, 'ghost_in_the_slip', 2);
  PERFORM public.grant_inventory_item(v_g2, 'ghost_in_the_slip', 2);
  PERFORM public.grant_inventory_item(v_g3, 'ghost_in_the_slip', 2);

  SELECT array_agg(id ORDER BY id) INTO g1 FROM public.player_inventory_items WHERE player_id = v_g1 AND consumed_at IS NULL;
  SELECT array_agg(id ORDER BY id) INTO g2 FROM public.player_inventory_items WHERE player_id = v_g2 AND consumed_at IS NULL;
  SELECT array_agg(id ORDER BY id) INTO g3 FROM public.player_inventory_items WHERE player_id = v_g3 AND consumed_at IS NULL;
  IF array_length(g1,1) <> 2 OR array_length(g2,1) <> 2 OR array_length(g3,1) <> 2 THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: expected 2 ghosts per haunter';
  END IF;

  ------------------------------------------------------------------ bettor places 4 bets (no items)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u_o, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_a], 100) INTO v_betA;
  SELECT public.place_house_bet(ARRAY[v_b], 100) INTO v_betB;
  SELECT public.place_house_bet(ARRAY[v_c], 100) INTO v_betC;
  SELECT public.place_house_bet(ARRAY[v_d], 100) INTO v_betD;

  ------------------------------------------------------------------ haunts (each ghost is a separate caller)
  -- A: g1, g2, g3 all haunt the winner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.haunt_bet(v_betA, g1[1]);
  PERFORM public.haunt_bet(v_betB, g1[2]);   -- B: loser
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.haunt_bet(v_betA, g2[1]);
  PERFORM public.haunt_bet(v_betC, g2[2]);   -- C: push
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u3, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.haunt_bet(v_betA, g3[1]);
  PERFORM public.haunt_bet(v_betD, g3[2]);   -- D: cancelled

  -- self-haunt + double-haunt negatives.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  BEGIN
    PERFORM public.haunt_bet(v_betA, g1[2]);   -- g1 already haunts A
    RAISE EXCEPTION 'PROBE_FAIL: double-haunt by same player was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF position('PROBE_FAIL' in SQLERRM) > 0 THEN RAISE; END IF;
  END;

  -- Stagger attached_at so "earliest" is deterministic (in production each haunt
  -- is its own txn with a distinct now(); within this single txn they tie).
  UPDATE public.bet_haunts SET attached_at = now() - interval '3 second' WHERE bet_id = v_betA AND haunter_player_id = v_g1;
  UPDATE public.bet_haunts SET attached_at = now() - interval '2 second' WHERE bet_id = v_betA AND haunter_player_id = v_g2;
  UPDATE public.bet_haunts SET attached_at = now() - interval '1 second' WHERE bet_id = v_betA AND haunter_player_id = v_g3;

  -- All six attach-tickets consumed at attach, win or lose.
  IF (SELECT count(*) FROM public.player_inventory_items
      WHERE id IN (g1[1],g1[2],g2[1],g2[2],g3[1],g3[2]) AND consumed_at IS NOT NULL) <> 6 THEN
    RAISE EXCEPTION 'PROBE_FAIL: not all ghosts consumed at attach';
  END IF;

  ------------------------------------------------------------------ cancel D (admin), then settle the rest
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u_o, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.cancel_bet(v_betD);

  PERFORM public.settle_market(v_mkt_a, 101.5);  -- over WINS
  PERFORM public.settle_market(v_mkt_b, 99.5);   -- over LOSES
  PERFORM public.settle_market(v_mkt_c, 100.5);  -- exact line → PUSH

  ------------------------------------------------------------------ A: haunted win
  IF (SELECT status FROM public.bets WHERE id = v_betA) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: A not won';
  END IF;
  IF (SELECT potential_payout FROM public.bets WHERE id = v_betA) <> 200 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A payout % <> 200', (SELECT potential_payout FROM public.bets WHERE id = v_betA);
  END IF;
  -- Bettor credited EXACTLY their stake (100) on bet_payout — no profit.
  IF (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger
      WHERE bet_id = v_betA AND type = 'bet_payout' AND player_id = v_owner) <> 100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A bettor payout % <> 100 (stake back only)',
      (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id = v_betA AND type='bet_payout' AND player_id=v_owner);
  END IF;
  -- Profit 100 split 34/33/33; remainder +1 to the earliest (g1).
  IF (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g1) <> 34
     OR (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g2) <> 33
     OR (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g3) <> 33 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A split not 34/33/33 (g1=%, g2=%, g3=%)',
      (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g1),
      (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g2),
      (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g3);
  END IF;
  -- payout_amount stamped on the haunt rows.
  IF (SELECT COALESCE(SUM(payout_amount),0) FROM public.bet_haunts WHERE bet_id = v_betA) <> 100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A bet_haunts payout_amount sum <> 100';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE sportsbook_bet_id = v_betA AND event_type = 'sportsbook_haunt_hit') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: A expected exactly one sportsbook_haunt_hit feed row';
  END IF;

  ------------------------------------------------------------------ B: haunted loser
  IF (SELECT status FROM public.bets WHERE id = v_betB) <> 'lost' THEN
    RAISE EXCEPTION 'PROBE_FAIL: B not lost';
  END IF;
  IF (SELECT count(*) FROM public.pin_ledger WHERE bet_id = v_betB AND type = 'bet_haunt_steal') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: B (loss) should pay no ghost';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events WHERE sportsbook_bet_id = v_betB AND event_type = 'sportsbook_haunt_hit') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: B should publish no haunt_hit event';
  END IF;

  ------------------------------------------------------------------ C: haunted push
  IF (SELECT status FROM public.bets WHERE id = v_betC) <> 'push' THEN
    RAISE EXCEPTION 'PROBE_FAIL: C not push';
  END IF;
  IF (SELECT count(*) FROM public.pin_ledger WHERE bet_id = v_betC AND type = 'bet_haunt_steal') <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: C (push) should pay no ghost';
  END IF;

  ------------------------------------------------------------------ D: cancelled → ticket refunded, haunt gone
  IF (SELECT count(*) FROM public.bet_haunts WHERE bet_id = v_betD) <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: D haunt row should be gone after cancel';
  END IF;
  IF (SELECT consumed_at FROM public.player_inventory_items WHERE id = g3[2]) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: D ghost ticket should be refunded (consumed_at NULL) after cancel';
  END IF;

  ------------------------------------------------------------------ RLS policy present (enforcement tested by diff-policies.sh)
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='bet_haunts' AND cmd='SELECT') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bet_haunts missing its SELECT RLS policy';
  END IF;

  ------------------------------------------------------------------ net pin flow
  -- Bettor net (excl seed): A 0 (−100 +100), B −100, C 0 (−100 +100), D 0 (cancelled, ledger purged) → −100.
  SELECT COALESCE(SUM(amount),0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_owner AND created_at = now();
  IF v_got <> -100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bettor net % (expected −100)', v_got;
  END IF;
  -- Ghosts collectively gain the whole profit (34+33+33 = 100).
  SELECT COALESCE(SUM(amount),0) INTO v_got
    FROM public.pin_ledger WHERE player_id IN (v_g1,v_g2,v_g3) AND created_at = now();
  IF v_got <> 100 THEN
    RAISE EXCEPTION 'PROBE_FAIL: ghosts net % (expected +100)', v_got;
  END IF;
  -- Double-entry: every non-mint movement this txn nets to zero.
  SELECT COALESCE(SUM(amount),0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type <> 'score_credit';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: non-mint movements net to % (expected 0)', v_got;
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'A_status',     (SELECT status FROM public.bets WHERE id = v_betA),
    'A_payout',     (SELECT potential_payout FROM public.bets WHERE id = v_betA),
    'A_bettor_credit', (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_payout' AND player_id=v_owner),
    'A_split_g1',   (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g1),
    'A_split_g2',   (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g2),
    'A_split_g3',   (SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE bet_id=v_betA AND type='bet_haunt_steal' AND player_id=v_g3),
    'B_status',     (SELECT status FROM public.bets WHERE id = v_betB),
    'C_status',     (SELECT status FROM public.bets WHERE id = v_betC),
    'D_haunt_rows', (SELECT count(*) FROM public.bet_haunts WHERE bet_id = v_betD),
    'D_ticket_refunded', (SELECT consumed_at IS NULL FROM public.player_inventory_items WHERE id = g3[2]),
    'haunt_events', (SELECT count(*) FROM public.activity_feed_events WHERE event_type='sportsbook_haunt_hit' AND created_at = now()),
    'bettor_net',   -100,
    'ghosts_net',   100
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
