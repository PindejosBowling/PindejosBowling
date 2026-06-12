-- PvP probe — self-contained, assertion-grade (see context/db-verification.md).
--
-- Fixtures: 2 synthetic players seeded 1000 pins each. Live anchors: active
-- season + one open week.
--
-- Flow: two custom-contract lifecycles —
--   #1 create → accept → admin settle (winner p1) → void (payout reversal +
--      stake refunds)
--   #2 create → accept → void from locked (stake refunds)
-- Asserts escrow/payout/refund arithmetic at each stage, final zero deltas,
-- statuses, back-links, net-zero; raises PROBE_RESULT (always aborts).
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid;
  v_ch1 uuid; v_ch2 uuid;
  c_seed constant int := 1000;
  c_stake constant int := 50;
  v_got int;
  v_result jsonb;
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000001'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000002');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'One', '+10000000001', v_u1) RETURNING id INTO v_p1;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'Two', '+10000000002', v_u2) RETURNING id INTO v_p2;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  ------------------------------------------------------------------ lifecycle #1
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.create_pvp_challenge('custom', v_p2, v_week, NULL, c_stake, c_stake,
    NULL, NULL, 'probe', 'Probe duel', 'probe', NULL, NULL) INTO v_ch1;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.accept_pvp_challenge(v_ch1);

  -- escrow: both stakes held by the house
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> -c_stake THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 delta % after escrow (expected %)', v_got, -c_stake;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.settle_pvp_challenge(v_ch1, 'admin', v_p1, 'probe settle');

  -- winner paid the full pot
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> c_stake THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 delta % after win (expected +%)', v_got, c_stake;
  END IF;
  IF (SELECT winner_player_id FROM public.pvp_challenges WHERE id = v_ch1) <> v_p1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: winner not recorded on challenge 1';
  END IF;

  PERFORM public.void_pvp_challenge(v_ch1, 'probe void after settle');

  ------------------------------------------------------------------ lifecycle #2
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  SELECT public.create_pvp_challenge('custom', v_p2, v_week, NULL, c_stake, c_stake,
    NULL, NULL, 'probe', 'Probe duel 2', 'probe', NULL, NULL) INTO v_ch2;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.accept_pvp_challenge(v_ch2);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.void_pvp_challenge(v_ch2, 'probe void from locked');

  ------------------------------------------------------------------ assertions
  -- both contracts fully unwound: every fixture player back to seed
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 final delta % (expected 0 after voids)', v_got;
  END IF;
  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p2 AND created_at = now();
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: p2 final delta % (expected 0 after voids)', v_got;
  END IF;

  IF (SELECT count(*) FROM public.pvp_challenges
      WHERE created_at = now() AND status = 'voided') <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected both challenges voided';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type LIKE 'pvp_%';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: pvp movements net to % (expected 0)', v_got;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pvp_ledger pl
    JOIN LATERAL (SELECT count(*) AS n FROM public.pin_ledger x
                  WHERE x.pvp_ledger_id = pl.id) c ON true
    WHERE pl.created_at = now() AND pl.pin_ledger_id IS NOT NULL AND c.n <> 2
  ) THEN
    RAISE EXCEPTION 'PROBE_FAIL: a pvp_ledger row is not back-linked by exactly 2 pin rows';
  END IF;

  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE created_at = now() AND event_type LIKE 'pvp_%') <> 3 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected 3 pvp events (2 accepted + 1 settled)';
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'pin_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'is_house', is_house, 'amount', amount, 'type', type, 'description', description,
        'linked', pvp_ledger_id IS NOT NULL)
        ORDER BY type, description, is_house, amount)
      FROM public.pin_ledger WHERE created_at = now() AND type LIKE 'pvp_%'),
    'pvp_ledger', (
      SELECT jsonb_agg(jsonb_build_object('amount', amount, 'type', type, 'description', description)
        ORDER BY type, description, amount)
      FROM public.pvp_ledger WHERE created_at = now())
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
