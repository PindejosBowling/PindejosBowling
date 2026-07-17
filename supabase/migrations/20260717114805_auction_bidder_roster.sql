-- Auction participants roster — WHO is bidding becomes public while the
-- auction is live; AMOUNTS stay sealed (owner-only via my_bid_amount).
--
-- This deliberately loosens the original FINDINGS §9 posture (bidder COUNT as
-- the only public signal): the detail screen now shows an alphabetical roster
-- of active bidders. Identity only — the function never touches
-- bid_amount_enc, and RLS on auction_bids is unchanged (owner-only rows, so
-- amounts still never leave the DB for anyone else).
--
-- Live-only: once the auction leaves 'open' the roster goes dark again —
-- losing bidders' participation stays private in history; winners become
-- public through the settlement ledger as before.

CREATE FUNCTION public.auction_bidders(p_auction_id uuid)
RETURNS TABLE(player_id uuid, player_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT b.player_id, p.name
    FROM public.auction_bids b
    JOIN public.players p ON p.id = b.player_id
    JOIN public.auctions a ON a.id = b.auction_id
   WHERE b.auction_id = p_auction_id
     AND b.status = 'active'
     AND a.status = 'open'
   ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.auction_bidders(uuid) TO authenticated;
