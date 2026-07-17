-- RSVP bonus ledger text: "RSVP Bonus - Season X Week Y".
-- ===========================================================================
-- The ledger row for a non-bet entry renders its stored description as the
-- primary line (LedgerRow), and 'RSVP bonus — thanks from the House' reads as
-- flavor, not a record. Stamp the season + week into the description at award
-- time in BOTH award paths (submit_own_rsvp + admin_grant_rsvp_bonus), and
-- backfill the rows already written. House mirror keeps its (House) marker.

-- Re-create submit_own_rsvp with the composed description (only the
-- pin_ledger_double_entry text arguments change; see
-- 20260714212000_submit_own_rsvp.sql for the design commentary).
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
  v_desc     text;
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
      v_desc := format('RSVP Bonus - Season %s Week %s', v_season.number, v_week.week_number);
      PERFORM public.pin_ledger_double_entry(
        v_player, v_season.id, p_week_id, v_cfg.bonus_amount, 'rsvp_bonus',
        v_desc, v_desc || ' (House)');
      v_awarded := true;
      v_amount  := v_cfg.bonus_amount;
      v_reason  := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('awarded', v_awarded, 'amount', v_amount, 'reason', v_reason);
END;
$function$;

-- Re-create admin_grant_rsvp_bonus with the same composed description (see
-- 20260717120000_admin_grant_rsvp_bonus.sql for the design commentary).
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
  v_desc    text;
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
      v_desc := format('RSVP Bonus - Season %s Week %s', v_season.number, v_week.week_number);
      PERFORM public.pin_ledger_double_entry(
        p_player_id, v_season.id, p_week_id, v_cfg.bonus_amount, 'rsvp_bonus',
        v_desc, v_desc || ' (House)');
      v_awarded := true;
      v_amount  := v_cfg.bonus_amount;
      v_reason  := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('awarded', v_awarded, 'amount', v_amount, 'reason', v_reason);
END;
$function$;

-- Backfill the rows already written (both sides carry week_id).
UPDATE public.pin_ledger l
SET description = format('RSVP Bonus - Season %s Week %s', s.number, w.week_number)
                  || CASE WHEN l.is_house THEN ' (House)' ELSE '' END
FROM public.weeks w
JOIN public.seasons s ON s.id = w.season_id
WHERE l.type = 'rsvp_bonus' AND l.week_id = w.id;
