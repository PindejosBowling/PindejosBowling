-- ============================================================================
-- PvP Challenge Contracts — make admin cancel a hard delete.
-- ============================================================================
-- Product decision: cancelling a contract should make it as if it never existed,
-- consistent with cancel_loan / cancel_bet. Previously cancel_pvp_challenge
-- deleted the escrow pin rows + pvp_ledger but left the contract row behind with
-- status='cancelled'. Now it deletes the contract row entirely.
--
-- Deletion order: pin_ledger references pvp_ledger ON DELETE SET NULL (so the pin
-- rows would orphan if we relied on cascade) — delete those explicitly first.
-- pvp_ledger and pvp_challenge_offers both cascade ON DELETE CASCADE from
-- pvp_challenges, so deleting the contract row cleans them up.
CREATE OR REPLACE FUNCTION public.cancel_pvp_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge public.pvp_challenges;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
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
