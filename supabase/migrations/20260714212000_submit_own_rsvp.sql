-- RSVP self-submit bonus — the submit_own_rsvp RPC.
-- ===========================================================================
-- The self-service write path a player takes to RSVP for THEIR OWN row. It
-- writes the rsvp row and, if eligible, pays a one-time house-funded bonus as a
-- "thank you from the House" for responding early.
--
-- Why an RPC (vs the plain dbRsvp.upsert the admin batch still uses):
--   * The rsvp table records no actor — self vs proxy is only a write-time RLS
--     distinction. Resolving the player from auth.uid() here is the only way to
--     guarantee the bonus pays for a PERSONAL submission and can't be forged or
--     paid on an admin/proxy submission on someone else's behalf.
--   * The bonus moves pins (pin_ledger writes are admin-only at RLS), so it must
--     run SECURITY DEFINER.
--
-- Eligibility (all must hold), enforced server-side (untrusted client clock):
--   * caller owns the row (player resolved from auth.uid());
--   * status is 'in' or 'out' — ANY personal response earns it;
--   * the week is the current playing season's and not archived;
--   * config.is_enabled;
--   * now() <= deadline, where deadline = (week.bowled_at + cfg.deadline_time)
--     AT TIME ZONE cfg.timezone. bowled_at NULL ⇒ deadline unknown ⇒ allowed;
--   * no prior 'rsvp_bonus' row for (player, week) — once per player per week,
--     so toggling In↔Out or re-saving never re-pays.
--
-- Returns jsonb {awarded, amount, reason} so the client can toast on award.
-- Config resolution: current-season row if present, else the global row.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.submit_own_rsvp(
  p_week_id uuid,
  p_status  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_player   uuid;
  v_week     public.weeks%ROWTYPE;
  v_season   public.seasons%ROWTYPE;
  v_cfg      public.rsvp_bonus_config%ROWTYPE;
  v_deadline timestamptz;
  v_awarded  boolean := false;
  v_amount   integer := 0;
  v_reason   text;
BEGIN
  -- 1. Caller → player.
  SELECT id INTO v_player FROM public.players WHERE user_id = auth.uid();
  IF v_player IS NULL THEN
    RAISE EXCEPTION 'No player is linked to the current user';
  END IF;

  -- 2. Status.
  IF p_status IS NULL OR p_status NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'RSVP status must be ''in'' or ''out''';
  END IF;

  -- 3. Week must exist, not be archived, and belong to the current playing
  --    season (is_active AND NOT registration_open — the getCurrent() rule).
  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF v_week.is_archived THEN
    RAISE EXCEPTION 'This week is archived — RSVPs are closed';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = v_week.season_id;
  IF v_season.id IS NULL OR NOT v_season.is_active OR v_season.registration_open THEN
    RAISE EXCEPTION 'This week is not in the current playing season';
  END IF;

  -- 4. Upsert the caller's OWN row (never anyone else's).
  INSERT INTO public.rsvp (week_id, player_id, status)
    VALUES (p_week_id, v_player, p_status)
  ON CONFLICT (player_id, week_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  -- 5. Resolve config: current-season row first, else global.
  SELECT * INTO v_cfg FROM public.rsvp_bonus_config
    WHERE season_id = v_season.id;
  IF v_cfg.id IS NULL THEN
    SELECT * INTO v_cfg FROM public.rsvp_bonus_config
      WHERE season_id IS NULL;
  END IF;

  -- 6. Award, guarded.
  IF v_cfg.id IS NULL OR NOT v_cfg.is_enabled THEN
    v_reason := 'disabled';
  ELSIF EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE player_id = v_player AND week_id = p_week_id AND type = 'rsvp_bonus'
  ) THEN
    v_reason := 'already_claimed';
  ELSE
    -- bowled_at NULL ⇒ deadline unknown ⇒ treat as not yet passed.
    IF v_week.bowled_at IS NOT NULL THEN
      v_deadline := (v_week.bowled_at + v_cfg.deadline_time) AT TIME ZONE v_cfg.timezone;
    END IF;

    IF v_deadline IS NOT NULL AND now() > v_deadline THEN
      v_reason := 'past_deadline';
    ELSE
      PERFORM public.pin_ledger_double_entry(
        v_player, v_season.id, p_week_id, v_cfg.bonus_amount, 'rsvp_bonus',
        'RSVP bonus — thanks from the House', 'RSVP bonus (house)');
      v_awarded := true;
      v_amount  := v_cfg.bonus_amount;
      v_reason  := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('awarded', v_awarded, 'amount', v_amount, 'reason', v_reason);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.submit_own_rsvp(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_own_rsvp(uuid, text) TO authenticated;
