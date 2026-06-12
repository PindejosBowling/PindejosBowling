-- Auction feed events are week-stamped (revision to 20260612200006).
--
-- Originally auction events carried week_id = NULL (week-agnostic entities),
-- which dumped them into Market Moves' "Other Moves" bucket. Decision
-- (2026-06-12, schema review follow-up): feed events show in the week they
-- OCCURRED — the same week the ledger books the money to (the season's open
-- week at the moment of the action; the take_loan convention).
--
--   * auction_opened          → the open week at opening time
--   * auction_won / _check_bounce / _no_sale → the settlement week (identical
--     to the auction_purchase / auction_check_bounce ledger stamp)
--
-- To preserve archive independence, unarchive_week's feed delete gains the
-- same exemption the pin delete already has (`AND auction_id IS NULL`):
-- auction feed rows are never deleted by the archive engine — they die only
-- with their auction (CASCADE via cancel/reverse).

-- ---------------------------------------------------------------------------
-- open_auction_internal: stamp the open week on auction_opened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_auction_internal(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction   public.auctions;
  v_item_name text;
  v_item_icon text;
  v_week      uuid;
BEGIN
  UPDATE public.auctions
     SET status = 'open'
   WHERE id = p_auction_id AND status = 'scheduled';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT c.name, c.icon INTO v_item_name, v_item_icon
    FROM public.item_catalog c WHERE c.id = v_auction.catalog_item_id;

  -- The week this opening occurred in (the season's open week right now).
  SELECT id INTO v_week
    FROM public.weeks WHERE season_id = v_auction.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  PERFORM public.publish_activity_event(
    'auction_house', 'auction_opened',
    v_auction.season_id, v_week, NULL, NULL, NULL,
    NULL, NULL,
    'auction_house.opened',
    jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                       'minimum_bid', v_auction.minimum_bid, 'closes_at', v_auction.closes_at),
    jsonb_build_object('auction_id', p_auction_id),
    NULL, now(),
    NULL, NULL, p_auction_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- settle_auction_internal: pass the settlement week (already computed for the
-- ledger stamp) into every publish. Body otherwise identical to …200006.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_auction_internal(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction      public.auctions;
  v_item_name    text;
  v_item_icon    text;
  v_catalog_id   uuid;
  v_week         uuid;
  v_bid          record;
  v_balance      integer;
  v_fee          integer;
  v_bidder_count integer;
  v_bounce_count integer := 0;
  v_won          boolean := false;
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  -- Idempotent + the single timing rule (no override parameter exists).
  IF v_auction.status <> 'open' OR v_auction.closes_at > now() THEN
    RETURN;
  END IF;

  SELECT name, icon, id INTO v_item_name, v_item_icon, v_catalog_id
    FROM public.item_catalog WHERE id = v_auction.catalog_item_id;

  -- Week stamp: the season's open week at settlement time (accounting
  -- accuracy; the archive engine is auction-exempt). Shared by the ledger
  -- pairs AND the feed events below.
  SELECT id INTO v_week
    FROM public.weeks WHERE season_id = v_auction.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  SELECT count(*) INTO v_bidder_count
    FROM public.auction_bids WHERE auction_id = p_auction_id AND status = 'active';

  -- Rank: first-price, ties to whoever held their amount longest.
  FOR v_bid IN
    SELECT b.id, b.player_id,
           public.decrypt_bid_amount(b.bid_amount_enc) AS amount,
           b.submitted_at
      FROM public.auction_bids b
     WHERE b.auction_id = p_auction_id AND b.status = 'active'
     ORDER BY amount DESC, b.submitted_at ASC
  LOOP
    v_balance := public.pin_balance(v_bid.player_id, v_auction.season_id);

    IF v_balance >= v_bid.amount THEN
      PERFORM public.pin_ledger_double_entry(
        v_bid.player_id, v_auction.season_id, v_week,
        -v_bid.amount, 'auction_purchase',
        'Won at auction: ' || v_item_name,
        NULL, NULL, NULL, p_auction_id);

      INSERT INTO public.player_inventory_items
          (player_id, catalog_item_id, season_id, source, auction_id)
        VALUES (v_bid.player_id, v_catalog_id, v_auction.season_id, 'auction', p_auction_id);

      UPDATE public.auction_bids
         SET status = 'won', settled_at = now()
       WHERE id = v_bid.id;

      UPDATE public.auctions
         SET winner_player_id = v_bid.player_id,
             winning_bid_id   = v_bid.id,
             winning_price    = v_bid.amount
       WHERE id = p_auction_id;

      PERFORM public.publish_activity_event(
        'auction_house', 'auction_won',
        v_auction.season_id, v_week, v_bid.player_id, NULL, NULL,
        NULL, NULL,
        'auction_house.won',
        jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                           'price', v_bid.amount),
        jsonb_build_object('auction_id', p_auction_id),
        NULL, now(),
        NULL, NULL, p_auction_id);

      v_won := true;
      EXIT;
    ELSE
      -- Check bounce: ledger-silent at zero fee, feed-loud always. The event
      -- names the player + fee — NEVER the pledged amount.
      v_bounce_count := v_bounce_count + 1;
      v_fee := LEAST(v_balance, v_auction.bounce_fee);
      IF v_fee > 0 THEN
        PERFORM public.pin_ledger_double_entry(
          v_bid.player_id, v_auction.season_id, v_week,
          -v_fee, 'auction_check_bounce',
          'Bounced check at auction: ' || v_item_name,
          NULL, NULL, NULL, p_auction_id);
      END IF;

      PERFORM public.publish_activity_event(
        'auction_house', 'auction_check_bounce',
        v_auction.season_id, v_week, v_bid.player_id, NULL, NULL,
        NULL, NULL,
        'auction_house.check_bounce',
        jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                           'fee', v_fee),
        jsonb_build_object('auction_id', p_auction_id),
        NULL, now(),
        NULL, NULL, p_auction_id);
    END IF;
  END LOOP;

  UPDATE public.auctions
     SET status = 'settled', settled_at = now()
   WHERE id = p_auction_id;

  -- A rejected pledge is destroyed: every non-won row, bounced included.
  DELETE FROM public.auction_bids
   WHERE auction_id = p_auction_id AND status <> 'won';

  IF NOT v_won THEN
    PERFORM public.publish_activity_event(
      'auction_house', 'auction_no_sale',
      v_auction.season_id, v_week, NULL, NULL, NULL,
      NULL, NULL,
      'auction_house.no_sale',
      jsonb_build_object('item_name', v_item_name, 'item_icon', v_item_icon,
                         'bidder_count', v_bidder_count, 'bounce_count', v_bounce_count),
      jsonb_build_object('auction_id', p_auction_id),
      NULL, now(),
      NULL, NULL, p_auction_id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- unarchive_week: the feed delete gains the auction exemption the pin delete
-- already has. The ONLY change from the …200003 body is `AND a.auction_id IS
-- NULL` in the activity_feed_events delete (step 3a).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unarchive_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id     uuid;
  v_week_number   integer;
  v_run_id        uuid;
  v_next_week_id  uuid;
  v_n_scores      integer := 0;
  v_n_bets        integer := 0;
  v_n_pvp         integer := 0;
  v_n_loans       integer := 0;
  v_n_rsvp        integer := 0;
  v_n_ledger      integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- LIFO: only the most-recently-archived week can be unarchived.
  IF EXISTS (
    SELECT 1 FROM public.weeks w
     WHERE w.season_id = v_season_id AND w.is_archived = true AND w.week_number > v_week_number
  ) THEN
    RAISE EXCEPTION 'A later week is archived — unarchive the most recent week first';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week';
  END IF;

  SELECT id INTO v_next_week_id
    FROM public.weeks WHERE season_id = v_season_id AND week_number = v_week_number + 1;

  -- Downstream guard: warn (unless forced) if week N+1 holds real activity.
  IF v_next_week_id IS NOT NULL AND NOT p_force THEN
    SELECT count(*) INTO v_n_scores
      FROM public.scores sc
      JOIN public.team_slots ts ON ts.id = sc.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
     WHERE t.week_id = v_next_week_id AND sc.score IS NOT NULL;

    SELECT count(*) INTO v_n_bets
      FROM public.bets b WHERE b.week_id = v_next_week_id;

    SELECT count(*) INTO v_n_pvp  FROM public.pvp_challenges WHERE week_id = v_next_week_id;
    SELECT count(*) INTO v_n_rsvp FROM public.rsvp           WHERE week_id = v_next_week_id;
    SELECT count(*) INTO v_n_ledger FROM public.pin_ledger   WHERE week_id = v_next_week_id;

    IF (v_n_scores + v_n_bets + v_n_pvp + v_n_rsvp + v_n_ledger) > 0 THEN
      RAISE EXCEPTION 'Downstream activity in week %: % scores, % bets, % pvp, % rsvp, % ledger rows. Re-run with force to override.',
        v_week_number + 1, v_n_scores, v_n_bets, v_n_pvp, v_n_rsvp, v_n_ledger;
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3a. Delete the rows settlement INSERTed (everything matching the predicate
  --     whose id is NOT in the captured pre-existing set).
  -- --------------------------------------------------------------------------
  -- Auction exemption (both deletes): auction activity settles on its own
  -- clock and is reversed only by reverse_settled_auction — the archive
  -- engine never touches it.
  DELETE FROM public.activity_feed_events a
   WHERE a.week_id = p_week_id
     AND a.auction_id IS NULL
     AND a.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'activity_feed_events'
     );

  DELETE FROM public.pin_ledger pl
   WHERE (pl.week_id = p_week_id
          OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
     AND pl.auction_id IS NULL
     AND pl.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'pin_ledger'
     );

  DELETE FROM public.pvp_ledger pv
   WHERE pv.week_id = p_week_id
     AND pv.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'pvp_ledger'
     );

  DELETE FROM public.loan_ledger ll
   WHERE ll.week_id = p_week_id
     AND ll.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'loan_ledger'
     );

  -- --------------------------------------------------------------------------
  -- 3b. Restore the columns settlement UPDATEd (verbatim pre-images).
  -- --------------------------------------------------------------------------
  UPDATE public.bet_markets m SET
      status       = sn.payload ->> 'status',
      result_value = (sn.payload ->> 'result_value')::numeric,
      settled_at   = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bet_markets' AND sn.pk = m.id;

  UPDATE public.bet_selections s SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bet_selections' AND sn.pk = s.id;

  UPDATE public.bets b SET
      status           = sn.payload ->> 'status',
      potential_payout = (sn.payload ->> 'potential_payout')::integer,
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bets' AND sn.pk = b.id;

  UPDATE public.bet_legs l SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bet_legs' AND sn.pk = l.id;

  UPDATE public.pvp_challenges c SET
      status           = sn.payload ->> 'status',
      winner_player_id = (sn.payload ->> 'winner_player_id')::uuid,
      result_detail    = COALESCE(sn.payload -> 'result_detail', '{}'::jsonb),
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz,
      admin_note       = sn.payload ->> 'admin_note'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'pvp_challenges' AND sn.pk = c.id;

  UPDATE public.pvp_challenge_offers o SET
      superseded_at = (sn.payload ->> 'superseded_at')::timestamptz,
      accepted_at   = (sn.payload ->> 'accepted_at')::timestamptz,
      declined_at   = (sn.payload ->> 'declined_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'pvp_challenge_offers' AND sn.pk = o.id;

  UPDATE public.loans ln SET
      status      = sn.payload ->> 'status',
      paid_off_at = (sn.payload ->> 'paid_off_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'loans' AND sn.pk = ln.id;

  -- --------------------------------------------------------------------------
  -- 3c. Destroy week N+1. rsvp.week_id has no cascade → delete first.
  --     Teams/games/markets/pvp cascade; the refund_bets_before_market_delete
  --     trigger refunds any bets placed on N+1.
  -- --------------------------------------------------------------------------
  IF v_next_week_id IS NOT NULL THEN
    DELETE FROM public.rsvp  WHERE week_id = v_next_week_id;
    DELETE FROM public.weeks WHERE id = v_next_week_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3d. Reopen the week: it is simply in play again (scores editable,
  --     MatchupsScreen's Archive & Advance is the re-archive path).
  -- --------------------------------------------------------------------------
  UPDATE public.weeks SET is_archived = false, bowled_at = NULL WHERE id = p_week_id;

  UPDATE public.week_archive_runs
     SET status = 'reversed', reversed_mode = 'unarchive', reversed_at = now()
   WHERE id = v_run_id;
END;
$function$;
