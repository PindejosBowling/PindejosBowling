-- cancel_bet: prune orphaned combo markets.
--
-- The admin cancel (total undo of a placed bet) predates combo lines: after
-- deleting the bet it only handled the "settled market now betless" case by
-- re-opening it. For a COMBO market that leaves an unbet combo on the board —
-- violating the compose=bet invariant (a combo market exists only while a bet
-- rides it) and stranding a line the sportsbook should no longer show.
--
-- Fix: in the post-delete sweep, a now-betless market that is a combo is
-- DELETED outright (any status — cascade removes its selections; the
-- refund-before-delete trigger no-ops since no bets remain; the bet-linked
-- compose feed card already cascaded away with the bet). Recomposing later
-- mints a fresh market. Markets with other bets still riding are untouched.
-- Non-combo markets keep the existing reopen-settled behavior.

CREATE OR REPLACE FUNCTION public.cancel_bet(p_bet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market_ids uuid[];
  v_mid        uuid;
BEGIN
  PERFORM public.assert_admin();

  -- Markets this bet touched (captured before the bet is deleted).
  SELECT ARRAY_AGG(DISTINCT s.market_id) INTO v_market_ids
  FROM public.bet_legs l
  JOIN public.bet_selections s ON s.id = l.selection_id
  WHERE l.bet_id = p_bet_id;

  -- Restore the attached items consumed at placement (consumed_at back to NULL on
  -- the exact rows the bet points at). The only sanctioned un-spend.
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT insurance_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT crutch_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT boost_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;

  -- Restore every ghost's ticket too — a haunt on a cancelled bet never resolved,
  -- so the haunter gets their Ghost back. The bet_haunts rows themselves cascade
  -- away with the bet delete below.
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id IN (SELECT inventory_item_id FROM public.bet_haunts WHERE bet_id = p_bet_id)
     AND consumed_at IS NOT NULL;

  DELETE FROM public.pin_ledger WHERE bet_id = p_bet_id;
  DELETE FROM public.bets WHERE id = p_bet_id;

  -- Sweep the touched markets now that the bet is gone:
  --  • a betless COMBO is deleted outright (compose = bet: a combo market
  --    never exists without a bet riding it — off the board, recompose mints
  --    a new one);
  --  • any other betless SETTLED market re-opens (its result derived from a
  --    bet that no longer exists).
  IF v_market_ids IS NOT NULL THEN
    FOREACH v_mid IN ARRAY v_market_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        WHERE s.market_id = v_mid
      ) THEN
        IF EXISTS (
          SELECT 1 FROM public.bet_markets WHERE id = v_mid AND market_type = 'combo'
        ) THEN
          DELETE FROM public.bet_markets WHERE id = v_mid;
        ELSIF EXISTS (
          SELECT 1 FROM public.bet_markets WHERE id = v_mid AND status = 'settled'
        ) THEN
          UPDATE public.bet_markets
            SET status = 'open', result_value = NULL, settled_at = NULL
            WHERE id = v_mid;
          UPDATE public.bet_selections SET result = NULL WHERE market_id = v_mid;
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$function$;
