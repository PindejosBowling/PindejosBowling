-- ============================================================================
-- Bounty Board v1 — House-only sponsorship (integrity guard).
-- ============================================================================
-- v1 decision: only the Pinsino (admin, via create_house_bounty) may sponsor a
-- bounty. Players join as hunters only. Player-sponsored bounties are deferred
-- because a competitor who bowls can influence the outcome in the direction that
-- pays them (tanking), wash-transfer via collusion, or target a third party in
-- freeform text — none of which the House (a non-competing operator that sets and
-- curates the condition) is exposed to. Player-vs-player action already lives on
-- the PvP Challenge board.
--
-- The app hides the "Post a Bounty" path, but the create_sponsor_bounty RPC is
-- still GRANTed to authenticated and therefore callable directly via the API.
-- Lock it at the DB layer too (defense in depth). create_house_bounty stays
-- admin-gated; enter_bounty_as_hunter stays open to authenticated.
--
-- To re-enable player bounties later (e.g. behind an admin-approval gate), re-GRANT
-- EXECUTE on this signature.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION
  public.create_sponsor_bounty(uuid, text, text, int, int, int, timestamptz)
  FROM authenticated;
