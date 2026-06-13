-- Multi-unit Silent Auctions: an admin sets quantity N (1–50) at create/edit;
-- at settlement the top N sealed bidders each win ONE unit individually.
--
-- Mechanics (decision record: AUCTION_FINDINGS.md §4 as-built update):
--   * Pay-as-bid — every winner pays their own sealed pledge.
--   * Sell-what-sells — settlement walks the ranked list (amount DESC,
--     submitted_at ASC); affordable bidders win one unit each until N sold or
--     bids run out; broke bidders bounce (existing fee) and the cascade
--     continues; k < N winners is a normal settle; no-sale only at zero.
--   * One unit per player — already enforced by the one-active-bid-per-player
--     unique index; no new rules.
--   * Winner denorms (winner_player_id / winning_bid_id / winning_price) keep
--     holding the FIRST (highest) winner — the hammer-price headline; the full
--     winners list derives from pin_ledger 'auction_purchase' rows app-side.
--
-- Overload trap: create_auction / update_auction gain a trailing p_quantity —
-- CREATE OR REPLACE would leave the old signatures behind as ambiguous
-- overloads, so both are DROPped and recreated (then re-granted; ACLs are
-- deny-by-default).
--
-- Economy RPCs touched: run ./supabase/verify/run-all-probes.sh before AND
-- after pushing.

-- ---------------------------------------------------------------------------
-- §1 Quantity constraint: unlock 1–50 (was CHECK (quantity = 1)).
-- ---------------------------------------------------------------------------
ALTER TABLE public.auctions DROP CONSTRAINT auctions_quantity_check;
ALTER TABLE public.auctions ADD CONSTRAINT auctions_quantity_check CHECK (quantity BETWEEN 1 AND 50);

-- ---------------------------------------------------------------------------
-- §2 Feed dedup indexes: auction_won becomes per-winner (actor-keyed, like
-- bounces). Safe on live data — existing auctions have one auction_won each.
-- ---------------------------------------------------------------------------
DROP INDEX public.activity_feed_unique_auction_bounce;
DROP INDEX public.activity_feed_unique_auction_event;

CREATE UNIQUE INDEX activity_feed_unique_auction_actor_event
  ON public.activity_feed_events (auction_id, event_type, actor_player_id)
  WHERE auction_id IS NOT NULL AND event_type IN ('auction_check_bounce', 'auction_won');

CREATE UNIQUE INDEX activity_feed_unique_auction_event
  ON public.activity_feed_events (auction_id, event_type)
  WHERE auction_id IS NOT NULL AND event_type NOT IN ('auction_check_bounce', 'auction_won');

-- ---------------------------------------------------------------------------
-- §3 create_auction: trailing p_quantity (DEFAULT 1). DROP first — a trailing
-- defaulted arg via CREATE OR REPLACE would create a second overload.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.create_auction(text, text, integer, timestamp with time zone, timestamp with time zone);

CREATE FUNCTION public.create_auction(
  p_catalog_key text, p_description text, p_minimum_bid integer,
  p_opens_at timestamp with time zone, p_closes_at timestamp with time zone,
  p_quantity integer DEFAULT 1
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 50';
  END IF;

  INSERT INTO public.auctions (season_id, catalog_item_id, description, opens_at, closes_at, minimum_bid, quantity)
    VALUES (v_season, v_cat.id, p_description, v_opens, p_closes_at, p_minimum_bid, p_quantity)
    RETURNING id INTO v_id;

  -- "Opens now" creates open directly (same path as the sweep's open phase).
  IF v_opens <= now() THEN
    PERFORM public.open_auction_internal(v_id);
  END IF;

  RETURN v_id;
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.create_auction(text, text, integer, timestamp with time zone, timestamp with time zone, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- §4 update_auction: trailing p_quantity (DEFAULT NULL = keep current — a
-- forgotten arg must never silently reset a multi-unit auction to 1).
-- ---------------------------------------------------------------------------
DROP FUNCTION public.update_auction(uuid, text, text, integer, timestamp with time zone, timestamp with time zone);

CREATE FUNCTION public.update_auction(
  p_auction_id uuid, p_catalog_key text, p_description text, p_minimum_bid integer,
  p_opens_at timestamp with time zone, p_closes_at timestamp with time zone,
  p_quantity integer DEFAULT NULL
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  IF p_quantity IS NOT NULL AND p_quantity NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 50';
  END IF;

  UPDATE public.auctions
     SET catalog_item_id = v_cat.id,
         description     = p_description,
         minimum_bid     = p_minimum_bid,
         opens_at        = COALESCE(p_opens_at, opens_at),
         closes_at       = p_closes_at,
         quantity        = COALESCE(p_quantity, quantity)
   WHERE id = p_auction_id;
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.update_auction(uuid, text, text, integer, timestamp with time zone, timestamp with time zone, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- §5 settle_auction_internal: the EXIT-after-first-winner becomes a sold
-- counter walking the same ranked list until quantity units are sold. Winner
-- denorms are written for the FIRST (highest) winner only. Bounce branch and
-- everything else unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_auction_internal(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_sold         integer := 0;
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

  -- Rank: first-price, ties to whoever held their amount longest. Multi-unit:
  -- pay-as-bid, sell-what-sells — each affordable bidder takes one unit (one
  -- per player via the one-active-bid index) until quantity units are gone.
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

      v_sold := v_sold + 1;

      -- The denorm headline is the hammer price: the first (highest) winner.
      IF v_sold = 1 THEN
        UPDATE public.auctions
           SET winner_player_id = v_bid.player_id,
               winning_bid_id   = v_bid.id,
               winning_price    = v_bid.amount
         WHERE id = p_auction_id;
      END IF;

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

      EXIT WHEN v_sold >= v_auction.quantity;
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

  IF v_sold = 0 THEN
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
$function$
;

-- ---------------------------------------------------------------------------
-- §6 reverse_settled_auction: revoke EVERY item granted by this auction (the
-- provenance FK now matches up to quantity rows); any consumed item blocks the
-- whole reversal. Ledger claw-back and auction delete already cover N winners
-- by root ref.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_settled_auction(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auction public.auctions;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;
  IF v_auction.status <> 'settled' THEN
    RAISE EXCEPTION 'Only settled auctions can be reversed';
  END IF;

  -- Revoke the granted items by their provenance FK — never by heuristics.
  -- All or nothing: one consumed item blocks the whole reversal.
  IF EXISTS (
    SELECT 1 FROM public.player_inventory_items
     WHERE auction_id = p_auction_id AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A won item has already been used — this auction cannot be reversed';
  END IF;
  DELETE FROM public.player_inventory_items WHERE auction_id = p_auction_id;

  -- Claw back every pair (purchases + bounces) by the root ref.
  DELETE FROM public.pin_ledger WHERE auction_id = p_auction_id;

  -- Erase the auction; the won bids + feed rows cascade. As if it never happened.
  DELETE FROM public.auctions WHERE id = p_auction_id;
END;
$function$
;
