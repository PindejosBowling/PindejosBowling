-- Sealed bids become commitments: once placed, a bid can be EDITED (any
-- amount >= minimum_bid — place_auction_bid already enforces that) but never
-- withdrawn. Reverses the "free sealed re-pricing incl. cancel" decision
-- (AUCTION_FINDINGS as-built update in the same commit).
--
-- No admin variant is kept: sealed means sealed — admins can't see bids and
-- have no business unwinding a player's pledge. Pre-settlement escape for a
-- whole auction remains cancel_auction (admin, erases every bid).
--
-- Economy RPC migration: run ./supabase/verify/run-all-probes.sh before AND
-- after pushing.

DROP FUNCTION public.cancel_auction_bid(uuid);
