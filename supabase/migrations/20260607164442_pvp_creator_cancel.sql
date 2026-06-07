-- ============================================================================
-- PvP Challenge Contracts — let a challenge author cancel their own OPEN contract.
-- ============================================================================
-- Product decision: a player who posted an open-board challenge or sent an
-- unaccepted direct offer should be able to withdraw it entirely. Cancelling
-- behaves exactly like the existing Admin Cancel (a full hard delete — the
-- contract and all related rows vanish as if it never existed), but a player may
-- only cancel a contract they authored AND only while it is still open
-- (pending/countered, i.e. pre-acceptance, zero escrow).
--
-- This only relaxes the authorization gate; the delete body is unchanged from
-- 20260607012000_pvp_cancel_hard_delete.sql. Admins keep cancelling any
-- pending/countered/locked contract.
CREATE OR REPLACE FUNCTION public.cancel_pvp_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge public.pvp_challenges;
  v_is_admin  boolean;
  v_caller    uuid;
BEGIN
  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';

  -- Player path: must be the author, and the contract must still be open. Admins
  -- bypass both checks (they can cancel pending/countered/locked contracts).
  IF NOT v_is_admin THEN
    SELECT id INTO v_caller FROM public.players WHERE user_id = auth.uid();
    IF v_challenge.creator_player_id <> v_caller THEN
      RAISE EXCEPTION 'Not your challenge';
    END IF;
    IF v_challenge.status NOT IN ('pending', 'countered') THEN
      RAISE EXCEPTION 'Only open challenges can be cancelled';
    END IF;
  END IF;

  -- Delete the escrow pin rows (both player + house sides) linked through this
  -- challenge's pvp_ledger entries. pin_ledger.pvp_ledger_id is ON DELETE SET
  -- NULL, so these must go before the contract is removed or they orphan.
  DELETE FROM public.pin_ledger
    WHERE pvp_ledger_id IN (
      SELECT id FROM public.pvp_ledger WHERE challenge_id = p_challenge_id
    );

  -- Delete the contract; pvp_ledger and pvp_challenge_offers cascade.
  DELETE FROM public.pvp_challenges WHERE id = p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_pvp_challenge(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_pvp_challenge(uuid) TO authenticated;
