-- RSVP reset — reset_rsvp_for_week, an admin rollback that also revokes bonuses.
-- ===========================================================================
-- The RSVP screen's admin "Reset" clears a week's RSVPs. Previously that was a
-- plain `DELETE FROM rsvp WHERE week_id = …`, which left the rsvp_bonus pin
-- credits behind (pin_ledger has no FK to rsvp; its week_id FK is ON DELETE SET
-- NULL, so nothing cascades). This RPC makes reset undo the money too: it deletes
-- the week's rsvp_bonus double-entry rows (BOTH the player + and house − sides
-- carry week_id) and then the rsvp rows, in one transaction.
--
-- Destructive rollback by row deletion — the same posture as cancel_loan. Both
-- sides of each bonus are removed together, so the conservation invariant
-- (SUM(amount) = SUM(score_credit)) and net-zero house accounting stay intact.
--
-- Deliberately NOT a trigger on rsvp DELETE: the archive/unarchive engine also
-- deletes rsvp rows (the N+1 week teardown), and coupling bonus reversal into
-- that probe-covered machinery would be unsafe. Scope the revoke to the explicit
-- admin reset action only.
CREATE OR REPLACE FUNCTION public.reset_rsvp_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.assert_admin();

  IF p_week_id IS NULL THEN
    RAISE EXCEPTION 'week id is required';
  END IF;

  -- Revoke the week's RSVP bonuses (player + house mirror), then clear RSVPs.
  DELETE FROM public.pin_ledger WHERE week_id = p_week_id AND type = 'rsvp_bonus';
  DELETE FROM public.rsvp       WHERE week_id = p_week_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reset_rsvp_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reset_rsvp_for_week(uuid) TO authenticated;
