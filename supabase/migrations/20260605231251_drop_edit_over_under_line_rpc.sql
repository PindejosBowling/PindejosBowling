-- Drop the edit_over_under_line RPC.
--
-- This RPC backed the admin "Bet Lines" screen (BettingAdminScreen), which let an
-- admin set a market's line while it had no bets. That screen and all its associated
-- client code have been removed, and nothing else in the app or in any other RPC
-- calls this function, so it is now dead code.
--
-- The shared "admin can update" RLS policy on bet_markets (and the other canonical
-- betting tables) is intentionally left in place: it is a general admin-write policy
-- applied uniformly across the betting model, not specific to this removed feature.

DROP FUNCTION IF EXISTS public.edit_over_under_line(uuid, numeric);
