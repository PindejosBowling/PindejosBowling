-- Admin bonus issuance — issue_pin_bonus
-- ===========================================================================
-- Gives Pinsino admins an in-app way to hand out house-funded `bonus` pins
-- (previously only writable by hand in migrations, e.g. the Season 1->2 champion
-- bonus). Each recipient gets a DOUBLE-ENTRY bonus (+amount player / -amount
-- house, week_id NULL) via pin_ledger_double_entry, so the credit nets to zero
-- across the economy and the conservation invariant (SUM(amount) =
-- SUM(score_credit)) still holds. Issuing also publishes a public Activity Feed
-- ("Market Moves") event per recipient.
--
-- Security invariants:
--   * SECURITY DEFINER + pinned search_path; admin-only via assert_admin().
--   * Balance scope = the current playing season (is_active AND NOT
--     registration_open) — the seasons.getCurrent() rule, never highest number.
--   * No client-supplied season/house ids trusted; season resolved server-side.
--   * No duplicate guard by design — issuance is fully manual (admin's call).
-- ===========================================================================

-- 1. Register the Activity Feed event type. `event_type` is an FK into this
--    catalog, so it must exist before publish_activity_event is ever called.
--    source_feature 'admin' + template_key 'admin.bonus_issued'; no source FK
--    (bonuses have no root entity); subject = the recipient (no actor — the
--    House issues it), so requires_actor = false.
INSERT INTO public.activity_event_catalog
  (event_type, source_feature, template_key, requires_actor, allowed_fk, default_visibility)
VALUES
  ('admin_bonus_issued', 'admin', 'admin.bonus_issued', false, 'none', 'public')
ON CONFLICT (event_type) DO NOTHING;

-- 2. The RPC.
CREATE OR REPLACE FUNCTION public.issue_pin_bonus(
  p_player_ids uuid[],
  p_amount     integer,
  p_label      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_season uuid;
  v_player uuid;
BEGIN
  PERFORM public.assert_admin();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Bonus amount must be a positive number';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RAISE EXCEPTION 'Bonus label is required';
  END IF;
  IF p_player_ids IS NULL OR array_length(p_player_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one recipient is required';
  END IF;

  -- Current playing season (the getCurrent() rule): active, out of registration.
  SELECT id INTO v_season
  FROM public.seasons
  WHERE is_active AND NOT registration_open
  ORDER BY number DESC
  LIMIT 1;
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'No active season to credit the bonus into';
  END IF;

  FOREACH v_player IN ARRAY p_player_ids LOOP
    -- House-funded double entry. p_house_description = p_label so both sides of
    -- the ledger read identically (matches the champion-bonus convention).
    PERFORM public.pin_ledger_double_entry(
      v_player, v_season, NULL, p_amount, 'bonus', btrim(p_label), btrim(p_label));

    -- Public Market Moves announcement (subject = recipient; no actor/FK).
    PERFORM public.publish_activity_event(
      'admin', 'admin_bonus_issued',
      v_season, NULL, NULL, v_player, NULL,
      NULL, NULL,
      'admin.bonus_issued',
      jsonb_build_object('amount', p_amount, 'label', btrim(p_label)),
      '{}'::jsonb,
      'public', now());
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.issue_pin_bonus(uuid[], integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_pin_bonus(uuid[], integer, text) TO authenticated;
