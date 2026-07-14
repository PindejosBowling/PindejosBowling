-- Admin: remove a single item from a player's inventory (undo a bad grant).
--
-- The item framework is atomic single-use rows; "quantity" is row count, so
-- revoking one grant = deleting one row. Only UNCONSUMED rows are removable:
-- a consumed item is attached to a bet/haunt (money in flight or historical),
-- and that reversal path is `cancel_bet` / `reverse_settled_auction`, not this.
--
-- Cascade-safe by construction: an unconsumed item is never referenced by a
-- bet (`insurance/crutch/boost_item_id`) or `bet_haunts.inventory_item_id`,
-- because those references are only written when the item is consumed. We
-- still guard defensively so a live reference can never dangle.
CREATE OR REPLACE FUNCTION public.revoke_inventory_item(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item public.player_inventory_items;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_item FROM public.player_inventory_items
   WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  IF v_item.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This item has already been used and cannot be removed';
  END IF;

  -- Defensive: unconsumed items are never referenced, but never dangle a live
  -- bet/haunt link if that invariant ever slips.
  IF EXISTS (
    SELECT 1 FROM public.bets
     WHERE insurance_item_id = p_item_id
        OR crutch_item_id = p_item_id
        OR boost_item_id = p_item_id
  ) OR EXISTS (
    SELECT 1 FROM public.bet_haunts WHERE inventory_item_id = p_item_id
  ) THEN
    RAISE EXCEPTION 'This item is attached to a bet and cannot be removed';
  END IF;

  DELETE FROM public.player_inventory_items WHERE id = p_item_id;
END;
$function$
;

REVOKE ALL ON FUNCTION public.revoke_inventory_item(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_inventory_item(uuid) TO authenticated;
