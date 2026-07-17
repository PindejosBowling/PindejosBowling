-- Add the auction's quantity to the auction_house.opened activity-feed payload
-- so the app can render "The House has put N <item>s up for auction!".
-- Copy-only change: no table/RLS/accounting impact. Older events lack the key;
-- the app template falls back to quantity 1.

CREATE OR REPLACE FUNCTION public.open_auction_internal(p_auction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                       'minimum_bid', v_auction.minimum_bid, 'closes_at', v_auction.closes_at,
                       'quantity', v_auction.quantity),
    jsonb_build_object('auction_id', p_auction_id),
    NULL, now(),
    NULL, NULL, p_auction_id);
END;
$function$
;
