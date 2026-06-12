-- Batch B: loans RPCs adopt the shared helpers (TODO_DB_CONSOLIDATION §2,
-- TODO_DB_FUNCTION_HYGIENE §1 adoption).
--
-- take_loan, repay_loan, process_weekly_loans, settle_loans_for_season_close
-- rewritten to use current_player_id() / current_season_id() / assert_admin()
-- / pin_balance() and pin_ledger_double_entry(). Ledger output is
-- byte-identical to the old bodies (incl. house-row description spellings) —
-- proven by the rollback-probe (supabase/verify/probe-loans.sql): the
-- before/after captures must be identical.

CREATE OR REPLACE FUNCTION public.take_loan(p_loan_product_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_product   public.loan_products;
  v_used      integer;
  v_loan_id   uuid;
  v_pin_player uuid;
  v_pin_house  uuid;
  v_debt_id    uuid;
BEGIN
  v_player_id := public.current_player_id();
  v_season_id := public.current_season_id();

  SELECT * INTO v_product FROM public.loan_products WHERE id = p_loan_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Loan product not found';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'Loan product is not available';
  END IF;
  IF v_product.season_id IS NOT NULL AND v_product.season_id <> v_season_id THEN
    RAISE EXCEPTION 'Loan product is not available this season';
  END IF;
  IF v_product.available_from IS NOT NULL AND now() < v_product.available_from THEN
    RAISE EXCEPTION 'Loan product is not yet available';
  END IF;
  IF v_product.available_until IS NOT NULL AND now() > v_product.available_until THEN
    RAISE EXCEPTION 'Loan product is no longer available';
  END IF;
  IF v_product.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.loans WHERE loan_product_id = p_loan_product_id;
    IF v_used >= v_product.max_uses THEN
      RAISE EXCEPTION 'Loan product has reached its usage limit';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE player_id = v_player_id AND season_id = v_season_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You already have an active loan this season';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.loans (player_id, season_id, loan_product_id, status)
    VALUES (v_player_id, v_season_id, p_loan_product_id, 'active')
    RETURNING id INTO v_loan_id;

  SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
    FROM public.pin_ledger_double_entry(
      v_player_id, v_season_id, v_week_id,
      v_product.borrow_amount, 'loan_issued',
      'Loan issued: ' || v_product.display_name,
      'Loan issued (house): ' || v_product.display_name);

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (v_loan_id, v_player_id, v_season_id, v_week_id, v_product.borrow_amount, 'loan_issued',
            'Loan issued: ' || v_product.display_name, v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  -- Activity Feed: vague loan-taken event. public_payload carries ONLY the risk
  -- tier (no amount/rate/product, §11.1, §5.5) so the copy can hint at the kind
  -- of deal. Operational detail lives in admin_payload.
  PERFORM public.publish_activity_event(
    'loan_shark', 'loan_shark_loan_taken',
    v_season_id, v_week_id, v_player_id, NULL, NULL,
    NULL, v_loan_id,
    'loan_shark.loan_taken',
    jsonb_build_object('risk_level', v_product.risk_level),
    jsonb_build_object('loan_id', v_loan_id, 'loan_product_id', p_loan_product_id),
    NULL, now());

  RETURN v_loan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repay_loan(p_loan_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id   uuid;
  v_loan        public.loans;
  v_week_id     uuid;
  v_outstanding integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
  v_risk_level  text;
BEGIN
  v_player_id := public.current_player_id();

  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;
  IF v_loan.id IS NULL THEN
    RAISE EXCEPTION 'Loan not found';
  END IF;
  IF v_loan.player_id <> v_player_id THEN
    RAISE EXCEPTION 'Not your loan';
  END IF;
  IF v_loan.status <> 'active' THEN
    RAISE EXCEPTION 'Loan is not active';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Repayment amount must be a positive integer';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
    FROM public.loan_ledger WHERE loan_id = p_loan_id;
  IF p_amount > v_outstanding THEN
    RAISE EXCEPTION 'Repayment exceeds outstanding debt';
  END IF;

  IF p_amount > public.pin_balance(v_player_id, v_loan.season_id) THEN
    RAISE EXCEPTION 'Repayment exceeds your balance';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_loan.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
    FROM public.pin_ledger_double_entry(
      v_player_id, v_loan.season_id, v_week_id,
      -p_amount, 'loan_manual_repayment', 'Loan repayment');

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_loan_id, v_player_id, v_loan.season_id, v_week_id, -p_amount, 'manual_repayment', 'Loan repayment', v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  IF v_outstanding - p_amount = 0 THEN
    UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = p_loan_id;

    -- Activity Feed: full payoff only (§11.1). Partial repayments post nothing.
    -- Vague — public_payload carries ONLY the risk tier (no amounts, §5.5) so the
    -- copy can vary by how dangerous the deal was. Actor = the borrower.
    SELECT risk_level INTO v_risk_level
      FROM public.loan_products WHERE id = v_loan.loan_product_id;

    PERFORM public.publish_activity_event(
      'loan_shark', 'loan_shark_loan_repaid',
      v_loan.season_id, v_week_id, v_player_id, NULL, NULL,
      NULL, p_loan_id,
      'loan_shark.loan_repaid',
      jsonb_build_object('risk_level', v_risk_level),
      jsonb_build_object('loan_id', p_loan_id),
      NULL, now());
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_weekly_loans(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_loan        record;
  v_product     public.loan_products;
  v_pincome     integer;
  v_outstanding integer;
  v_garnish     integer;
  v_interest    integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_loan IN
    SELECT id, player_id, season_id, loan_product_id
    FROM public.loans
    WHERE season_id = v_season_id AND status = 'active'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.loan_ledger
      WHERE loan_id = v_loan.id AND week_id = p_week_id
        AND type IN ('weekly_garnishment', 'weekly_interest')
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_product FROM public.loan_products WHERE id = v_loan.loan_product_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_pincome
      FROM public.pin_ledger
      WHERE player_id = v_loan.player_id AND week_id = p_week_id AND type = 'score_credit';

    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.loan_ledger WHERE loan_id = v_loan.id;

    IF v_outstanding <= 0 THEN
      UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = v_loan.id;
      CONTINUE;
    END IF;

    v_garnish := LEAST(CEIL(v_pincome * v_product.garnishment_rate)::int, v_outstanding);
    IF v_garnish > 0 THEN
      SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
        FROM public.pin_ledger_double_entry(
          v_loan.player_id, v_loan.season_id, p_week_id,
          -v_garnish, 'loan_weekly_garnishment', 'Loan garnishment');

      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, p_week_id, -v_garnish, 'weekly_garnishment', 'Loan garnishment', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.loan_ledger WHERE loan_id = v_loan.id;
    IF v_outstanding <= 0 THEN
      UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = v_loan.id;
      CONTINUE;
    END IF;

    v_interest := CEIL(v_outstanding * v_product.weekly_interest_rate)::int;
    IF v_interest > 0 THEN
      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, p_week_id, v_interest, 'weekly_interest', 'Weekly interest', NULL);
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_loans_for_season_close(p_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_loan        record;
  v_week_id     uuid;
  v_outstanding integer;
  v_payment     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = p_season_id
    ORDER BY week_number DESC LIMIT 1;

  FOR v_loan IN
    SELECT id, player_id, season_id
    FROM public.loans
    WHERE season_id = p_season_id AND status = 'active'
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.loan_ledger WHERE loan_id = v_loan.id;

    v_payment := LEAST(public.pin_balance(v_loan.player_id, v_loan.season_id), v_outstanding);
    IF v_payment > 0 THEN
      SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
        FROM public.pin_ledger_double_entry(
          v_loan.player_id, v_loan.season_id, v_week_id,
          -v_payment, 'loan_season_close_settlement', 'Season-close loan settlement');

      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, v_week_id, -v_payment, 'season_close_settlement', 'Season-close loan settlement', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    UPDATE public.loans SET status = 'season_closed', season_closed_at = now() WHERE id = v_loan.id;
  END LOOP;
END;
$function$;
