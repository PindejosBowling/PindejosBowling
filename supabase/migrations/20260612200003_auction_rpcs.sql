-- Silent Auctions M3 — the RPC surface (context/economy/AUCTION_FINDINGS.md §9/§11).
--
-- Lock ordering everywhere: the AUCTION ROW FIRST (FOR UPDATE) — bid, cancel,
-- and settlement all serialize on it, which resolves the close-boundary race
-- in lock order.
--
-- One settlement path, one timing rule: settle_auction_internal settles only
-- status='open' AND closes_at <= now(). Admin "Settle Now" (settle_auction)
-- stamps closes_at = now() under the lock and calls the same function —
-- closes_at is therefore always truthful history.
--
-- Feed events are wired in M6 (the publish helper gains p_auction_id there);
-- the M6 migration recreates open_auction_internal + settle_auction_internal
-- with the publish calls. Comments below mark each publish point.
--
-- Grants: deny-by-default ACL means functions are born unexecutable. Client-
-- facing RPCs get GRANT … TO authenticated (admin gates are in-function);
-- internal/cron functions (open_auction_internal, settle_auction_internal,
-- sweep_auctions) get NOTHING — no grant IS their security.

-- ---------------------------------------------------------------------------
-- Opening
-- ---------------------------------------------------------------------------

-- Internal: scheduled → open. Idempotent (guarded UPDATE). M6 adds the
-- auction_opened publish.
CREATE FUNCTION public.open_auction_internal(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.auctions
     SET status = 'open'
   WHERE id = p_auction_id AND status = 'scheduled';
  -- M6: publish 'auction_opened' here.
END;
$$;

CREATE FUNCTION public.create_auction(
  p_catalog_key text,
  p_description text,
  p_minimum_bid integer,
  p_opens_at timestamptz,
  p_closes_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_season  uuid;
  v_cat     public.item_catalog;
  v_id      uuid;
  v_opens   timestamptz;
BEGIN
  PERFORM public.assert_admin();
  v_season := public.current_season_id();

  SELECT * INTO v_cat FROM public.item_catalog WHERE key = p_catalog_key;
  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Unknown catalog item: %', p_catalog_key;
  END IF;
  -- Storefront rule: retired items can't be newly auctioned (owned instances
  -- are unaffected — retirement never confiscates).
  IF NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Catalog item % is retired', p_catalog_key;
  END IF;

  v_opens := COALESCE(p_opens_at, now());
  IF p_closes_at IS NULL OR p_closes_at <= now() THEN
    RAISE EXCEPTION 'Close time must be in the future';
  END IF;
  IF p_closes_at <= v_opens THEN
    RAISE EXCEPTION 'Close time must be after open time';
  END IF;
  IF p_minimum_bid IS NULL OR p_minimum_bid <= 0 THEN
    RAISE EXCEPTION 'Minimum bid must be at least 1';
  END IF;

  INSERT INTO public.auctions (season_id, catalog_item_id, description, opens_at, closes_at, minimum_bid)
    VALUES (v_season, v_cat.id, p_description, v_opens, p_closes_at, p_minimum_bid)
    RETURNING id INTO v_id;

  -- "Opens now" creates open directly (same path as the sweep's open phase).
  IF v_opens <= now() THEN
    PERFORM public.open_auction_internal(v_id);
  END IF;

  RETURN v_id;
END;
$$;

-- Metadata is frozen once open: edit exists for scheduled auctions only.
CREATE FUNCTION public.update_auction(
  p_auction_id uuid,
  p_catalog_key text,
  p_description text,
  p_minimum_bid integer,
  p_opens_at timestamptz,
  p_closes_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction public.auctions;
  v_cat     public.item_catalog;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Auction metadata is frozen once it opens';
  END IF;

  SELECT * INTO v_cat FROM public.item_catalog WHERE key = p_catalog_key;
  IF v_cat.id IS NULL OR NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Unknown or retired catalog item: %', p_catalog_key;
  END IF;
  IF p_closes_at IS NULL OR p_closes_at <= now() OR p_closes_at <= COALESCE(p_opens_at, now()) THEN
    RAISE EXCEPTION 'Close time must be in the future and after open time';
  END IF;
  IF p_minimum_bid IS NULL OR p_minimum_bid <= 0 THEN
    RAISE EXCEPTION 'Minimum bid must be at least 1';
  END IF;

  UPDATE public.auctions
     SET catalog_item_id = v_cat.id,
         description     = p_description,
         minimum_bid     = p_minimum_bid,
         opens_at        = COALESCE(p_opens_at, opens_at),
         closes_at       = p_closes_at
   WHERE id = p_auction_id;
END;
$$;

-- Admin "Open Now": stamp opens_at and run the one opening path.
CREATE FUNCTION public.open_auction_now(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_admin();

  SELECT status INTO v_status FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled auctions can be opened';
  END IF;

  UPDATE public.auctions SET opens_at = now() WHERE id = p_auction_id;
  PERFORM public.open_auction_internal(p_auction_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Bidding — free sealed re-pricing: one active bid per player, edit to any
-- value >= minimum_bid, cancel anytime pre-close. No ledger, no feed at bid
-- time. Every real edit resets submitted_at (tie-break = longest-held amount);
-- a no-op edit (same amount) deliberately does NOT reset the clock.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.place_auction_bid(p_auction_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_player   uuid;
  v_auction  public.auctions;
  v_bid_id   uuid;
  v_current  integer;
BEGIN
  v_player := public.current_player_id();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  -- Authoritative independent of cron lag: time check, not just status.
  IF v_auction.status <> 'open' OR now() >= v_auction.closes_at THEN
    RAISE EXCEPTION 'Auction is not open for bids';
  END IF;

  IF p_amount IS NULL OR p_amount < v_auction.minimum_bid THEN
    RAISE EXCEPTION 'Bid must be at least % pins', v_auction.minimum_bid;
  END IF;
  IF p_amount > public.pin_balance(v_player, v_auction.season_id) THEN
    RAISE EXCEPTION 'Bid exceeds your balance';
  END IF;

  SELECT id, public.decrypt_bid_amount(bid_amount_enc) INTO v_bid_id, v_current
    FROM public.auction_bids
   WHERE auction_id = p_auction_id AND player_id = v_player AND status = 'active';

  IF v_bid_id IS NOT NULL AND v_current = p_amount THEN
    RETURN;  -- no-op edit: tie-break clock preserved, idempotent success.
  END IF;

  IF v_bid_id IS NOT NULL THEN
    UPDATE public.auction_bids
       SET bid_amount_enc = public.encrypt_bid_amount(p_amount),
           submitted_at   = now()
     WHERE id = v_bid_id;
  ELSE
    INSERT INTO public.auction_bids (auction_id, player_id, bid_amount_enc)
      VALUES (p_auction_id, v_player, public.encrypt_bid_amount(p_amount));
  END IF;

  -- Recounted, never ±1 (self-healing denorm; we hold the auction lock).
  UPDATE public.auctions a
     SET bidder_count = (SELECT count(*) FROM public.auction_bids b
                          WHERE b.auction_id = a.id AND b.status = 'active')
   WHERE a.id = p_auction_id;
END;
$$;

CREATE FUNCTION public.cancel_auction_bid(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_player  uuid;
  v_auction public.auctions;
BEGIN
  v_player := public.current_player_id();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'open' OR now() >= v_auction.closes_at THEN
    RAISE EXCEPTION 'Auction is not open';
  END IF;

  DELETE FROM public.auction_bids
   WHERE auction_id = p_auction_id AND player_id = v_player AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No bid to cancel';
  END IF;

  UPDATE public.auctions a
     SET bidder_count = (SELECT count(*) FROM public.auction_bids b
                          WHERE b.auction_id = a.id AND b.status = 'active')
   WHERE a.id = p_auction_id;
END;
$$;

-- Owner-only decode path for the app's tap-to-reveal. Returns NULL when the
-- caller has no active bid. (RLS already hides other players' rows; this is
-- the only way to read your own AMOUNT, since the column is ciphertext.)
CREATE FUNCTION public.my_bid_amount(p_auction_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.decrypt_bid_amount(b.bid_amount_enc)
    FROM public.auction_bids b
   WHERE b.auction_id = p_auction_id
     AND b.player_id = public.current_player_id()
     AND b.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------

-- The one settlement path. Cron-callable (no JWT inside, no grant outside).
-- Money is week-stamped with the season's OPEN week at settlement time (the
-- take_loan convention) so weekly accounting books outcomes to the week they
-- occurred; unarchive_week is auction-exempt (see bottom of this migration).
CREATE FUNCTION public.settle_auction_internal(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction      public.auctions;
  v_item_name    text;
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

  SELECT name, id INTO v_item_name, v_catalog_id
    FROM public.item_catalog WHERE id = v_auction.catalog_item_id;

  -- Week stamp: the season's open week at settlement time.
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
      -- The winning purchase: player → House, week-stamped, auction-rooted.
      PERFORM public.pin_ledger_double_entry(
        v_bid.player_id, v_auction.season_id, v_week,
        -v_bid.amount, 'auction_purchase',
        'Won at auction: ' || v_item_name,
        NULL, NULL, NULL, p_auction_id);

      -- Deliver the prize: one atomic inventory row.
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

      v_won := true;
      EXIT;
    ELSE
      -- Check bounce: ledger-silent at zero, feed-loud always (M6).
      v_bounce_count := v_bounce_count + 1;
      v_fee := LEAST(v_balance, v_auction.bounce_fee);
      IF v_fee > 0 THEN
        PERFORM public.pin_ledger_double_entry(
          v_bid.player_id, v_auction.season_id, v_week,
          -v_fee, 'auction_check_bounce',
          'Bounced check at auction: ' || v_item_name,
          NULL, NULL, NULL, p_auction_id);
      END IF;
      -- M6: publish 'auction_check_bounce' here (player + fee, never amount).
    END IF;
  END LOOP;

  UPDATE public.auctions
     SET status = 'settled', settled_at = now()
   WHERE id = p_auction_id;

  -- A rejected pledge is destroyed: every non-won row, bounced included.
  -- (Counts above were captured first — the feed payloads need them.)
  DELETE FROM public.auction_bids
   WHERE auction_id = p_auction_id AND status <> 'won';

  -- M6: publish 'auction_won' (winner + price) or 'auction_no_sale'
  -- (payload: bidder_count = v_bidder_count, bounce_count = v_bounce_count —
  -- the all-bounce no-sale gets special copy in the app template).
END;
$$;

-- Admin "Settle Now" = closing the auction: stamp closes_at and run the one
-- path. closes_at thereby records when the auction ACTUALLY closed.
CREATE FUNCTION public.settle_auction(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction public.auctions;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'open' THEN
    RAISE EXCEPTION 'Only open auctions can be settled';
  END IF;

  IF v_auction.closes_at > now() THEN
    UPDATE public.auctions SET closes_at = now() WHERE id = p_auction_id;
  END IF;

  PERFORM public.settle_auction_internal(p_auction_id);
END;
$$;

-- The per-minute clock (scheduled by M4). Each auction is isolated in its own
-- sub-block: a poisoned auction logs a WARNING into cron.job_run_details,
-- rolls back only its own movements, retries next tick, and never blocks the
-- others. settle_auction is the admin unwedge tool.
CREATE FUNCTION public.sweep_auctions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Phase 1: open what's due.
  FOR v_id IN
    SELECT id FROM public.auctions
     WHERE status = 'scheduled' AND opens_at <= now()
     ORDER BY opens_at
  LOOP
    BEGIN
      PERFORM public.open_auction_internal(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sweep_auctions: open failed for %: %', v_id, SQLERRM;
    END;
  END LOOP;

  -- Phase 2: settle what's due.
  FOR v_id IN
    SELECT id FROM public.auctions
     WHERE status = 'open' AND closes_at <= now()
     ORDER BY closes_at
  LOOP
    BEGIN
      PERFORM public.settle_auction_internal(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sweep_auctions: settle failed for %: %', v_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation / reversal — the §4 reversal rule: pre-settlement = hard delete
-- (no ledger rows can exist); post-settlement = reverse by the auction_id root
-- ref, "as if it never happened".
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.cancel_auction(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_admin();

  SELECT status INTO v_status FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_status = 'settled' THEN
    RAISE EXCEPTION 'Settled auctions are reversed, not cancelled';
  END IF;
  -- Defensive: no money can have moved pre-settlement.
  IF EXISTS (SELECT 1 FROM public.pin_ledger WHERE auction_id = p_auction_id) THEN
    RAISE EXCEPTION 'Auction has ledger rows — refusing to cancel';
  END IF;

  -- Bids cascade; feed rows cascade (M6 FK); inventory can't exist pre-settlement.
  DELETE FROM public.auctions WHERE id = p_auction_id;
END;
$$;

CREATE FUNCTION public.reverse_settled_auction(p_auction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_auction public.auctions;
  v_item    public.player_inventory_items;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'settled' THEN
    RAISE EXCEPTION 'Only settled auctions can be reversed';
  END IF;

  -- Revoke the granted item by its provenance FK — never by heuristics.
  IF v_auction.winner_player_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.player_inventory_items WHERE auction_id = p_auction_id;
    IF v_item.id IS NOT NULL THEN
      IF v_item.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'The won item has already been used — this auction cannot be reversed';
      END IF;
      DELETE FROM public.player_inventory_items WHERE id = v_item.id;
    END IF;
  END IF;

  -- Claw back every pair (purchase + bounces) by the root ref.
  DELETE FROM public.pin_ledger WHERE auction_id = p_auction_id;

  -- Erase the auction; the won bid + feed rows cascade. As if it never happened.
  DELETE FROM public.auctions WHERE id = p_auction_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Inventory admin grant — N atomic rows (quantity is row count, always).
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.grant_inventory_item(
  p_player_id uuid, p_catalog_key text, p_quantity integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_cat    public.item_catalog;
  v_season uuid;
BEGIN
  PERFORM public.assert_admin();

  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 50 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 50';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  SELECT * INTO v_cat FROM public.item_catalog WHERE key = p_catalog_key;
  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Unknown catalog item: %', p_catalog_key;
  END IF;
  IF NOT v_cat.is_active THEN
    RAISE EXCEPTION 'Catalog item % is retired', p_catalog_key;
  END IF;

  v_season := public.current_season_id();

  INSERT INTO public.player_inventory_items (player_id, catalog_item_id, season_id, source)
    SELECT p_player_id, v_cat.id, v_season, 'admin_grant'
      FROM generate_series(1, p_quantity);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants (client-facing only; everything else stays unexecutable).
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.create_auction(text, text, integer, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_auction(uuid, text, text, integer, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_auction_now(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_auction_bid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_bid_amount(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_settled_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_inventory_item(uuid, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- unarchive_week: the auction exemption. Auction money is week-stamped for
-- accounting but NEVER reversed by the archive engine (system independence —
-- closes the sweep-vs-archive race where unarchive could resurrect a purchase
-- while the winner keeps the item). Reversal of auction money is exclusively
-- reverse_settled_auction, by root ref. The ONLY change to the current body
-- is `AND pl.auction_id IS NULL` in the pin_ledger delete (step 3a).
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
  DELETE FROM public.activity_feed_events a
   WHERE a.week_id = p_week_id
     AND a.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'activity_feed_events'
     );

  -- Auction exemption: auction money settles on its own clock and is reversed
  -- only by reverse_settled_auction — the archive engine never touches it.
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
