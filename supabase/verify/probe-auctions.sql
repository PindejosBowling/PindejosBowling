-- Auctions + item framework probe — self-contained, assertion-grade
-- (see context/db-verification.md).
--
-- Requires the Vault secret 'auction_bid_amount_key' (auction_bid_key()
-- raises its own message if missing) and the live 'golden_ticket' catalog row.
--
-- Flow:
--   sweep open phase: scheduled auction with due opens_at → open + opened event
--   bids: p1 450 (after a no-op re-place of 400 and a real edit), p2 120 →
--         cancel → re-bid 110; bidder_count recounted throughout
--   drain p1 to 40 → admin Settle Now (stamps closes_at, one settlement path):
--         p1 bounces for LEAST(40, 50) = 40, p2 wins at 110, item granted
--   losers destroyed; idempotent re-settle is a no-op
--   Safety Ticket: p2 attaches the won item to a 50-pin bet; p1 stealing it is
--         rejected; market settles against → lost + insurance refund 50;
--         re-finalize does not double-refund
--   reverse: blocked while the item is consumed; clean after un-consume;
--         zero residue (ledger/inventory/bids/feed all gone)
-- Always aborts via the final RAISE (PROBE_RESULT) — nothing persists.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid;
  v_auction uuid;
  v_item uuid;
  v_mkt uuid; v_sel uuid;
  v_bet uuid;
  c_seed1 constant int := 500;
  c_seed2 constant int := 120;
  v_got int;
  v_got2 int;
  v_caught boolean;
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
  IF NOT EXISTS (SELECT 1 FROM public.item_catalog WHERE key = 'golden_ticket' AND is_active) THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: golden_ticket catalog row missing';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed1, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed2, 'score_credit', 'PROBE FIXTURE seed');

  ------------------------------------------------------------------ create + sweep open phase
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);

  SELECT public.create_auction('golden_ticket', 'probe auction',
                               100, now() + interval '1 hour', now() + interval '2 hours')
    INTO v_auction;
  IF (SELECT status FROM public.auctions WHERE id = v_auction) <> 'scheduled' THEN
    RAISE EXCEPTION 'PROBE_FAIL: future-opening auction not scheduled';
  END IF;

  -- Make it due and let the sweep open it (fixture UPDATE: probes run as the
  -- session role and bypass RLS; the all-RPC posture is a client posture).
  UPDATE public.auctions SET opens_at = now() - interval '1 minute' WHERE id = v_auction;
  PERFORM public.sweep_auctions();
  IF (SELECT status FROM public.auctions WHERE id = v_auction) <> 'open' THEN
    RAISE EXCEPTION 'PROBE_FAIL: sweep did not open the due auction';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE auction_id = v_auction AND event_type = 'auction_opened') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected 1 auction_opened event';
  END IF;

  ------------------------------------------------------------------ bidding
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.place_auction_bid(v_auction, 400);
  PERFORM public.place_auction_bid(v_auction, 400);  -- no-op edit: idempotent success
  IF public.my_bid_amount(v_auction) <> 400 THEN
    RAISE EXCEPTION 'PROBE_FAIL: my_bid_amount after no-op edit';
  END IF;
  PERFORM public.place_auction_bid(v_auction, 450);  -- real edit
  IF public.my_bid_amount(v_auction) <> 450 THEN
    RAISE EXCEPTION 'PROBE_FAIL: my_bid_amount after edit';
  END IF;

  -- Over-balance and under-minimum bids must be rejected.
  v_caught := false;
  BEGIN
    PERFORM public.place_auction_bid(v_auction, c_seed1 + 1);
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  IF NOT v_caught THEN RAISE EXCEPTION 'PROBE_FAIL: over-balance bid accepted'; END IF;
  v_caught := false;
  BEGIN
    PERFORM public.place_auction_bid(v_auction, 99);
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  IF NOT v_caught THEN RAISE EXCEPTION 'PROBE_FAIL: under-minimum bid accepted'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.place_auction_bid(v_auction, 120);
  IF (SELECT bidder_count FROM public.auctions WHERE id = v_auction) <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bidder_count after 2 bids';
  END IF;
  PERFORM public.cancel_auction_bid(v_auction);
  IF (SELECT bidder_count FROM public.auctions WHERE id = v_auction) <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bidder_count after cancel';
  END IF;
  PERFORM public.place_auction_bid(v_auction, 110);

  -- Amounts at rest are ciphertext, not integers in disguise.
  IF EXISTS (SELECT 1 FROM public.auction_bids
             WHERE auction_id = v_auction
               AND (bid_amount_enc = convert_to('110', 'UTF8')
                 OR bid_amount_enc = convert_to('450', 'UTF8'))) THEN
    RAISE EXCEPTION 'PROBE_FAIL: bid amount stored in plaintext';
  END IF;

  ------------------------------------------------------------------ settle (bounce → winner)
  -- Drain p1 to 40: the top bid (450) must bounce for LEAST(40, 50) = 40.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description) VALUES
    (v_p1, v_season, v_week, false, -460, 'bonus', 'PROBE FIXTURE drain'),
    (NULL, v_season, v_week, true,   460, 'bonus', 'PROBE FIXTURE drain (house)');

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_auction(v_auction);  -- Settle Now: stamps closes_at, one path

  IF (SELECT status FROM public.auctions WHERE id = v_auction) <> 'settled' THEN
    RAISE EXCEPTION 'PROBE_FAIL: auction not settled';
  END IF;
  IF (SELECT winner_player_id FROM public.auctions WHERE id = v_auction) <> v_p2
     OR (SELECT winning_price FROM public.auctions WHERE id = v_auction) <> 110 THEN
    RAISE EXCEPTION 'PROBE_FAIL: winner/price denorms wrong';
  END IF;
  IF (SELECT closes_at FROM public.auctions WHERE id = v_auction) > now() THEN
    RAISE EXCEPTION 'PROBE_FAIL: Settle Now did not stamp closes_at';
  END IF;

  -- Money: p1 bounce -40, p2 purchase -110, all week-stamped + auction-rooted,
  -- netting to zero against the house.
  SELECT COALESCE(SUM(amount), 0) INTO v_got FROM public.pin_ledger
   WHERE auction_id = v_auction AND player_id = v_p1;
  IF v_got <> -40 THEN RAISE EXCEPTION 'PROBE_FAIL: bounce fee % (expected -40)', v_got; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_got FROM public.pin_ledger
   WHERE auction_id = v_auction AND player_id = v_p2;
  IF v_got <> -110 THEN RAISE EXCEPTION 'PROBE_FAIL: purchase % (expected -110)', v_got; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_got FROM public.pin_ledger WHERE auction_id = v_auction;
  IF v_got <> 0 THEN RAISE EXCEPTION 'PROBE_FAIL: auction movements net to % (expected 0)', v_got; END IF;
  IF EXISTS (SELECT 1 FROM public.pin_ledger WHERE auction_id = v_auction AND week_id IS DISTINCT FROM v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: auction ledger rows not stamped with the open week';
  END IF;

  -- The prize: one atomic, unconsumed, season-scoped inventory row.
  SELECT id INTO v_item FROM public.player_inventory_items WHERE auction_id = v_auction;
  IF v_item IS NULL OR (SELECT count(*) FROM public.player_inventory_items WHERE auction_id = v_auction) <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected exactly 1 granted item';
  END IF;
  IF (SELECT player_id FROM public.player_inventory_items WHERE id = v_item) <> v_p2
     OR (SELECT consumed_at FROM public.player_inventory_items WHERE id = v_item) IS NOT NULL
     OR (SELECT source FROM public.player_inventory_items WHERE id = v_item) <> 'auction' THEN
    RAISE EXCEPTION 'PROBE_FAIL: granted item wrong (owner/consumed/source)';
  END IF;

  -- Rejected pledges are destroyed; only the won row remains.
  IF (SELECT count(*) FROM public.auction_bids WHERE auction_id = v_auction) <> 1
     OR (SELECT status FROM public.auction_bids WHERE auction_id = v_auction) <> 'won' THEN
    RAISE EXCEPTION 'PROBE_FAIL: losing bid rows survived settlement';
  END IF;

  -- Feed: opened + bounce (fee, never amount) + won; week-agnostic (NULL week).
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE auction_id = v_auction AND event_type = 'auction_check_bounce'
        AND actor_player_id = v_p1 AND (public_payload ->> 'fee')::int = 40) <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: bounce event missing or wrong fee';
  END IF;
  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE auction_id = v_auction AND event_type = 'auction_won' AND actor_player_id = v_p2) <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: won event missing';
  END IF;
  -- Feed events show in the week they occurred (the open week — same stamp
  -- as the ledger), and the archive engine is exempt from touching them.
  IF EXISTS (SELECT 1 FROM public.activity_feed_events
             WHERE auction_id = v_auction AND week_id IS DISTINCT FROM v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: auction feed events not stamped with the open week';
  END IF;
  IF EXISTS (SELECT 1 FROM public.activity_feed_events
             WHERE auction_id = v_auction AND public_payload::text LIKE '%450%') THEN
    RAISE EXCEPTION 'PROBE_FAIL: a feed payload leaked a bid amount';
  END IF;

  -- Idempotent re-settle: nothing moves.
  SELECT count(*) INTO v_got FROM public.pin_ledger WHERE auction_id = v_auction;
  PERFORM public.settle_auction_internal(v_auction);
  SELECT count(*) INTO v_got2 FROM public.pin_ledger WHERE auction_id = v_auction;
  IF v_got <> v_got2 THEN RAISE EXCEPTION 'PROBE_FAIL: re-settle moved money'; END IF;

  ------------------------------------------------------------------ Safety Ticket
  INSERT INTO public.bet_markets (market_type, title, week_id, game_number, status)
    VALUES ('over_under', 'PROBE insured market', v_week, 1, 'open') RETURNING id INTO v_mkt;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'over', 'Over', 2.000, 100.5) RETURNING id INTO v_sel;
  INSERT INTO public.bet_selections (market_id, key, label, odds, line)
    VALUES (v_mkt, 'under', 'Under', 2.000, 100.5);

  -- p1 trying to spend p2's ticket must be rejected.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.place_house_bet(ARRAY[v_sel], 10, NULL, v_item);
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  IF NOT v_caught THEN RAISE EXCEPTION 'PROBE_FAIL: foreign ticket accepted'; END IF;

  -- p2 insures a 50-pin bet (balance 120 - 110 = 10… reseed to afford it).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    VALUES (v_p2, v_season, v_week, 100, 'score_credit', 'PROBE FIXTURE reseed');
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.place_house_bet(ARRAY[v_sel], 50, NULL, v_item) INTO v_bet;

  IF (SELECT consumed_at FROM public.player_inventory_items WHERE id = v_item) IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: ticket not consumed at placement';
  END IF;
  IF (SELECT insurance_item_id FROM public.bets WHERE id = v_bet) <> v_item THEN
    RAISE EXCEPTION 'PROBE_FAIL: bets.insurance_item_id not stamped';
  END IF;

  -- A second attach of the same (now consumed) ticket must be rejected.
  v_caught := false;
  BEGIN
    PERFORM public.place_house_bet(ARRAY[v_sel], 10, NULL, v_item);
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  IF NOT v_caught THEN RAISE EXCEPTION 'PROBE_FAIL: consumed ticket accepted'; END IF;

  -- Market settles against p2 → lost + House-funded full refund (share 1.0).
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_market(v_mkt, 99);  -- under wins → over lost

  IF (SELECT status FROM public.bets WHERE id = v_bet) <> 'lost' THEN
    RAISE EXCEPTION 'PROBE_FAIL: insured bet not lost';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_got FROM public.pin_ledger
   WHERE bet_id = v_bet AND type = 'bet_insurance_refund' AND is_house = false;
  IF v_got <> 50 THEN RAISE EXCEPTION 'PROBE_FAIL: insurance refund % (expected 50)', v_got; END IF;
  IF EXISTS (SELECT 1 FROM public.pin_ledger
             WHERE bet_id = v_bet AND type = 'bet_insurance_refund' AND week_id IS DISTINCT FROM v_week) THEN
    RAISE EXCEPTION 'PROBE_FAIL: insurance refund not week-stamped';
  END IF;

  -- Re-finalize: the NOT-EXISTS guard must hold (no double refund).
  PERFORM public.finalize_bets_for_market(v_mkt);
  IF (SELECT count(*) FROM public.pin_ledger WHERE bet_id = v_bet AND type = 'bet_insurance_refund') <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: insurance refund not idempotent';
  END IF;

  ------------------------------------------------------------------ reverse
  -- Blocked while the won item is consumed…
  v_caught := false;
  BEGIN
    PERFORM public.reverse_settled_auction(v_auction);
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  IF NOT v_caught THEN RAISE EXCEPTION 'PROBE_FAIL: reverse allowed with consumed item'; END IF;

  -- …clean after un-consume (fixture restore), leaving zero residue.
  UPDATE public.player_inventory_items SET consumed_at = NULL WHERE id = v_item;
  PERFORM public.reverse_settled_auction(v_auction);

  IF EXISTS (SELECT 1 FROM public.auctions WHERE id = v_auction)
     OR EXISTS (SELECT 1 FROM public.pin_ledger WHERE auction_id = v_auction)
     OR EXISTS (SELECT 1 FROM public.player_inventory_items WHERE id = v_item)
     OR EXISTS (SELECT 1 FROM public.auction_bids WHERE auction_id = v_auction)
     OR EXISTS (SELECT 1 FROM public.activity_feed_events WHERE auction_id = v_auction) THEN
    RAISE EXCEPTION 'PROBE_FAIL: reverse left residue';
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'bounce_fee', 40, 'winning_price', 110, 'insurance_refund', 50,
    'reversed_clean', true
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
