-- Loans probe — self-contained, assertion-grade (see context/db-verification.md).
--
-- Fixtures (synthetic, created in-transaction): 2 auth users + players, a
-- 1000-pin seed each, and a probe loan product (borrow 250, interest 20%,
-- garnishment 10%). Live anchors required: an active season + one open week.
--
-- Flow: take → repay 100 → repay 150 (payoff) → take #2 → process_weekly_loans
-- → settle_loans_for_season_close. Asserts exact arithmetic, statuses,
-- back-links, and the double-entry net-zero invariant, then raises
-- PROBE_RESULT (always aborts — nothing persists; PROBE_FAIL on violation).
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid;
  v_p2 uuid;
  v_season uuid;
  v_week uuid;
  v_product uuid;
  v_loan1 uuid;
  v_loan2 uuid;
  -- expected arithmetic (mirrors the loan product spec, not the implementation)
  c_seed constant int := 1000;
  c_borrow constant int := 250;
  v_exp_garnish int;
  v_exp_interest int;
  v_exp_close int;
  v_exp_delta int;
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

  INSERT INTO public.loan_products
      (display_name, description, risk_level, borrow_amount, weekly_interest_rate, garnishment_rate)
    VALUES ('Probe Loan', 'probe fixture', 'low', c_borrow, 0.20, 0.10)
    RETURNING id INTO v_product;

  ------------------------------------------------------------------ flow
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);

  SELECT public.take_loan(v_product) INTO v_loan1;
  PERFORM public.repay_loan(v_loan1, 100);
  PERFORM public.repay_loan(v_loan1, 150);   -- payoff
  SELECT public.take_loan(v_product) INTO v_loan2;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  PERFORM public.process_weekly_loans(v_week);
  PERFORM public.settle_loans_for_season_close(v_season);

  ------------------------------------------------------------------ expected
  -- weekly tick on loan2: pincome = fixture seed (score_credit in v_week)
  v_exp_garnish  := LEAST(CEIL(c_seed * 0.10)::int, c_borrow);                  -- 100
  v_exp_interest := CEIL((c_borrow - v_exp_garnish) * 0.20)::int;               -- 30
  v_exp_close    := c_borrow - v_exp_garnish + v_exp_interest;                  -- 180 (balance is ample)
  v_exp_delta    := c_borrow - 100 - 150 + c_borrow - v_exp_garnish - v_exp_close;  -- -30

  ------------------------------------------------------------------ assertions
  IF (SELECT status FROM public.loans WHERE id = v_loan1) <> 'paid_off' THEN
    RAISE EXCEPTION 'PROBE_FAIL: loan1 not paid_off';
  END IF;
  IF (SELECT status FROM public.loans WHERE id = v_loan2) <> 'season_closed' THEN
    RAISE EXCEPTION 'PROBE_FAIL: loan2 not season_closed';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_got FROM public.loan_ledger WHERE loan_id = v_loan2;
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: loan2 outstanding % after season close (expected 0)', v_got;
  END IF;

  SELECT COALESCE(SUM(amount), 0) - c_seed INTO v_got
    FROM public.pin_ledger WHERE player_id = v_p1 AND created_at = now();
  IF v_got <> v_exp_delta THEN
    RAISE EXCEPTION 'PROBE_FAIL: p1 balance delta % (expected %)', v_got, v_exp_delta;
  END IF;

  -- double-entry: every loan-type movement in this tx nets to zero
  SELECT COALESCE(SUM(amount), 0) INTO v_got
    FROM public.pin_ledger WHERE created_at = now() AND type LIKE 'loan_%';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: loan movements net to % (expected 0)', v_got;
  END IF;

  -- back-links: each linked loan_ledger row is pointed at by exactly 2 pin rows
  IF EXISTS (
    SELECT 1 FROM public.loan_ledger ll
    JOIN LATERAL (SELECT count(*) AS n FROM public.pin_ledger pl
                  WHERE pl.loan_ledger_id = ll.id) c ON true
    WHERE ll.created_at = now() AND ll.pin_ledger_id IS NOT NULL AND c.n <> 2
  ) THEN
    RAISE EXCEPTION 'PROBE_FAIL: a loan_ledger row is not back-linked by exactly 2 pin rows';
  END IF;

  IF (SELECT count(*) FROM public.activity_feed_events
      WHERE created_at = now() AND event_type LIKE 'loan_shark_%') <> 3 THEN
    RAISE EXCEPTION 'PROBE_FAIL: expected 3 loan_shark events (2 taken + 1 repaid)';
  END IF;

  ------------------------------------------------------------------ capture
  SELECT jsonb_build_object(
    'pin_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'is_house', is_house, 'amount', amount, 'type', type, 'description', description,
        'linked', loan_ledger_id IS NOT NULL)
        ORDER BY type, description, is_house, amount)
      FROM public.pin_ledger
      WHERE created_at = now() AND type LIKE 'loan_%' AND (player_id = v_p1 OR is_house)),
    'loan_ledger', (
      SELECT jsonb_agg(jsonb_build_object('amount', amount, 'type', type, 'description', description)
        ORDER BY type, amount)
      FROM public.loan_ledger WHERE created_at = now() AND player_id = v_p1)
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
