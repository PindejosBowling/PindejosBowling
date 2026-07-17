-- RSVP bonus remediation — the admin_grant_rsvp_bonus RPC.
-- ===========================================================================
-- An admin escape hatch for the case where a player genuinely self-RSVP'd but
-- the bonus never paid — e.g. their installed build predated the split write
-- path (submit_own_rsvp) and their save went through the plain rsvp upsert,
-- which by design never pays. The rsvp table records no actor, so the server
-- cannot detect this after the fact; remediation is a human judgment call, and
-- this RPC is the audited, double-entry-correct way to make it.
--
-- Guards (vs submit_own_rsvp, whose award block this mirrors):
--   * admin only (assert_admin) — this moves house pins;
--   * an rsvp row must EXIST for (player, week) — this remediates a real,
--     already-recorded RSVP, it is not a general pin-granting tool;
--   * once per (player, week): same pin_ledger dedup key ('rsvp_bonus' +
--     week_id), so a later self-submit on an updated app returns
--     already_claimed and can never double-pay;
--   * DELIBERATELY SKIPS the deadline and is_enabled checks — an explicit
--     admin remediation overrides both (the miss usually surfaces after the
--     deadline has passed).
--
-- Pays the CURRENT configured amount via the identical pin_ledger_double_entry
-- call submit_own_rsvp makes, and returns the same {awarded, amount, reason}
-- shape (reason ∈ ok | already_claimed | no_rsvp | disabled).

CREATE OR REPLACE FUNCTION public.admin_grant_rsvp_bonus(
  p_player_id uuid,
  p_week_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_week    public.weeks%ROWTYPE;
  v_season  public.seasons%ROWTYPE;
  v_cfg     public.rsvp_bonus_config%ROWTYPE;
  v_awarded boolean := false;
  v_amount  integer := 0;
  v_reason  text;
BEGIN
  PERFORM public.assert_admin();

  IF p_player_id IS NULL OR p_week_id IS NULL THEN
    RAISE EXCEPTION 'player id and week id are required';
  END IF;

  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = v_week.season_id;

  -- The player must actually have an RSVP on record for this week.
  IF NOT EXISTS (
    SELECT 1 FROM public.rsvp
    WHERE player_id = p_player_id AND week_id = p_week_id
  ) THEN
    v_reason := 'no_rsvp';
  ELSIF EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE player_id = p_player_id AND week_id = p_week_id AND type = 'rsvp_bonus'
  ) THEN
    v_reason := 'already_claimed';
  ELSE
    -- Config resolution: current-season row first, else global (same as
    -- submit_own_rsvp). Only the amount is honored — is_enabled and the
    -- deadline are intentionally not checked here.
    SELECT * INTO v_cfg FROM public.rsvp_bonus_config
      WHERE season_id = v_week.season_id;
    IF v_cfg.id IS NULL THEN
      SELECT * INTO v_cfg FROM public.rsvp_bonus_config
        WHERE season_id IS NULL;
    END IF;

    IF v_cfg.id IS NULL THEN
      v_reason := 'disabled';
    ELSE
      PERFORM public.pin_ledger_double_entry(
        p_player_id, v_season.id, p_week_id, v_cfg.bonus_amount, 'rsvp_bonus',
        'RSVP bonus — thanks from the House', 'RSVP bonus (house)');
      v_awarded := true;
      v_amount  := v_cfg.bonus_amount;
      v_reason  := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('awarded', v_awarded, 'amount', v_amount, 'reason', v_reason);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_grant_rsvp_bonus(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_rsvp_bonus(uuid, uuid) TO authenticated;
