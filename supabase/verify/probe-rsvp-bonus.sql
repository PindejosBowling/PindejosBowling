-- RSVP self-submit bonus probe — self-contained, assertion-grade
-- (see context/db-verification.md).
--
-- Fixtures (synthetic, created in-transaction): 3 auth users + players. Live
-- anchors required: an active season + one open week. The week's bowled_at and
-- the global rsvp_bonus_config are mutated in-transaction to drive the deadline
-- and enabled branches; everything rolls back.
--
-- Flow / branches asserted against submit_own_rsvp:
--   * p1, deadline in the FUTURE      → awarded, +amount double-entry (net zero),
--                                        rsvp row = 'in', bonus player = caller;
--   * p1, resubmit ('out')            → NOT awarded, reason 'already_claimed',
--                                        still exactly one bonus, rsvp now 'out';
--   * p2, deadline in the PAST        → NOT awarded, reason 'past_deadline',
--                                        rsvp row written, no bonus for p2;
--   * p3, bonus DISABLED              → NOT awarded, reason 'disabled', no bonus.
-- Raises PROBE_RESULT (always aborts — nothing persists; PROBE_FAIL on violation).
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_u3 uuid := gen_random_uuid();
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_season uuid;
  v_week uuid;
  v_cfg_id uuid;
  v_amount int;
  v_res jsonb;
  v_got int;
  v_result jsonb;
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000101'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000102'),
    (v_u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000103');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'RsvpOne', '+10000000101', v_u1) RETURNING id INTO v_p1;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'RsvpTwo', '+10000000102', v_u2) RETURNING id INTO v_p2;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'RsvpThree', '+10000000103', v_u3) RETURNING id INTO v_p3;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  -- Ensure a global config row and read its amount; force enabled + known time.
  SELECT id, bonus_amount INTO v_cfg_id, v_amount
    FROM public.rsvp_bonus_config WHERE season_id IS NULL;
  IF v_cfg_id IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no global rsvp_bonus_config row';
  END IF;
  UPDATE public.rsvp_bonus_config
    SET is_enabled = true, deadline_time = '18:00', timezone = 'America/New_York'
    WHERE id = v_cfg_id;

  ---------------------------------------------------------- p1: before deadline
  -- Push the bowl date a week out so the deadline is unambiguously in the future.
  UPDATE public.weeks SET bowled_at = (current_date + 7) WHERE id = v_week;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);

  v_res := public.submit_own_rsvp(v_week, 'in');
  IF NOT (v_res->>'awarded')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 not awarded (reason=%)', v_res->>'reason';
  END IF;
  IF (v_res->>'amount')::int <> v_amount THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 amount % (expected %)', v_res->>'amount', v_amount;
  END IF;
  IF (SELECT status FROM public.rsvp WHERE player_id = v_p1 AND week_id = v_week) <> 'in' THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 rsvp not ''in''';
  END IF;
  -- exactly one player-side bonus row (+amount), owned by the caller
  IF (SELECT count(*) FROM public.pin_ledger
      WHERE player_id = v_p1 AND week_id = v_week AND type = 'rsvp_bonus') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 does not have exactly one rsvp_bonus row';
  END IF;
  IF (SELECT amount FROM public.pin_ledger
      WHERE player_id = v_p1 AND week_id = v_week AND type = 'rsvp_bonus') <> v_amount THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 bonus amount wrong';
  END IF;

  ---------------------------------------------------------- p1: resubmit (dedup)
  v_res := public.submit_own_rsvp(v_week, 'out');
  IF (v_res->>'awarded')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 re-awarded on resubmit';
  END IF;
  IF v_res->>'reason' <> 'already_claimed' THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 resubmit reason % (expected already_claimed)', v_res->>'reason';
  END IF;
  IF (SELECT count(*) FROM public.pin_ledger
      WHERE player_id = v_p1 AND week_id = v_week AND type = 'rsvp_bonus') <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 bonus paid more than once';
  END IF;
  IF (SELECT status FROM public.rsvp WHERE player_id = v_p1 AND week_id = v_week) <> 'out' THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 rsvp status not updated to ''out''';
  END IF;

  ---------------------------------------------------------- p2: past deadline
  UPDATE public.weeks SET bowled_at = (current_date - 1) WHERE id = v_week;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);

  v_res := public.submit_own_rsvp(v_week, 'in');
  IF (v_res->>'awarded')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 awarded past deadline';
  END IF;
  IF v_res->>'reason' <> 'past_deadline' THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 reason % (expected past_deadline)', v_res->>'reason';
  END IF;
  IF (SELECT status FROM public.rsvp WHERE player_id = v_p2 AND week_id = v_week) <> 'in' THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 rsvp not written despite no bonus';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pin_ledger
             WHERE player_id = v_p2 AND type = 'rsvp_bonus') THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 got a bonus past deadline';
  END IF;

  ---------------------------------------------------------- p3: disabled
  UPDATE public.rsvp_bonus_config SET is_enabled = false WHERE id = v_cfg_id;
  UPDATE public.weeks SET bowled_at = (current_date + 7) WHERE id = v_week;  -- future, but disabled short-circuits
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u3, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);

  v_res := public.submit_own_rsvp(v_week, 'in');
  IF (v_res->>'awarded')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: p3 awarded while disabled';
  END IF;
  IF v_res->>'reason' <> 'disabled' THEN
    RAISE EXCEPTION 'PROBE_FAIL: p3 reason % (expected disabled)', v_res->>'reason';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pin_ledger
             WHERE player_id = v_p3 AND type = 'rsvp_bonus') THEN
    RAISE EXCEPTION 'PROBE_FAIL: p3 got a bonus while disabled';
  END IF;

  ---------------------------------------------------------- invariant: net zero
  -- every rsvp_bonus movement in this tx (player + house mirror) nets to zero
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type = 'rsvp_bonus';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: rsvp_bonus movements net to % (expected 0)', v_got;
  END IF;
  -- exactly two rows total (one player +, one house −) — only p1 was paid
  IF (SELECT count(*) FROM public.pin_ledger
      WHERE created_at = now() AND type = 'rsvp_bonus') <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected exactly 2 rsvp_bonus rows (p1 double-entry)';
  END IF;
  IF (SELECT count(*) FROM public.pin_ledger
      WHERE created_at = now() AND type = 'rsvp_bonus' AND is_house) <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: missing the house mirror row';
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'bonus_amount', v_amount,
    'p1_awarded', true,
    'p1_dedup_reason', 'already_claimed',
    'p2_reason', 'past_deadline',
    'p3_reason', 'disabled',
    'rsvp_bonus_net', v_got,
    'rsvp_bonus_rows', (SELECT count(*) FROM public.pin_ledger
                        WHERE created_at = now() AND type = 'rsvp_bonus')
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
