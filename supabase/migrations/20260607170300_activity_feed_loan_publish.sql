-- ============================================================================
-- Activity Feed — loan publish integration (§4, design §11) — privacy-aware.
-- ============================================================================
-- CREATE OR REPLACE take_loan and repay_loan from their current live bodies
-- (20260606223843_rename_debt_ledger_to_loan_ledger.sql), adding ONLY the publish
-- calls. Loan events are DELIBERATELY VAGUE (§5.5, §11): public_payload is always
-- '{}' — NO product, amount, interest, garnishment, or debt is ever exposed.
--
-- repay_loan publishes ONLY on a full payoff (outstanding hits 0). Partial
-- repayments, weekly garnishment/interest, missed-week interest, and season-close
-- settlement publish NOTHING (§11.2) — so process_weekly_loans /
-- settle_loans_for_season_close get no publish call. cancel_loan also needs no
-- edit: the loan_id ON DELETE CASCADE drops the vague feed row automatically.
-- ============================================================================

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
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

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

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_season_id, v_week_id, false, v_product.borrow_amount, 'loan_issued', 'Loan issued: ' || v_product.display_name)
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_season_id, v_week_id, true, -v_product.borrow_amount, 'loan_issued', 'Loan issued (house): ' || v_product.display_name)
    RETURNING id INTO v_pin_house;

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (v_loan_id, v_player_id, v_season_id, v_week_id, v_product.borrow_amount, 'loan_issued',
            'Loan issued: ' || v_product.display_name, v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  -- Activity Feed: vague "{actor} visited the Loan Shark." — empty public payload,
  -- NO amounts/rate/product (§11.1, §5.5). Operational detail lives in admin_payload.
  PERFORM public.publish_activity_event(
    'loan_shark', 'loan_shark_loan_taken',
    v_season_id, v_week_id, v_player_id, NULL, NULL,
    NULL, v_loan_id,
    'loan_shark.loan_taken',
    '{}'::jsonb,
    jsonb_build_object('loan_id', v_loan_id, 'loan_product_id', p_loan_product_id),
    NULL, NULL, now());

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
  v_balance     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

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

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger
    WHERE player_id = v_player_id AND season_id = v_loan.season_id;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Repayment exceeds your balance';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_loan.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_loan.season_id, v_week_id, false, -p_amount, 'loan_manual_repayment', 'Loan repayment')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_loan.season_id, v_week_id, true, p_amount, 'loan_manual_repayment', 'Loan repayment (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_loan_id, v_player_id, v_loan.season_id, v_week_id, -p_amount, 'manual_repayment', 'Loan repayment', v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  IF v_outstanding - p_amount = 0 THEN
    UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = p_loan_id;

    -- Activity Feed: full payoff only (§11.1). Partial repayments post nothing.
    -- Vague — empty public payload (§5.5). Actor = the borrower.
    PERFORM public.publish_activity_event(
      'loan_shark', 'loan_shark_loan_repaid',
      v_loan.season_id, v_week_id, v_player_id, NULL, NULL,
      NULL, p_loan_id,
      'loan_shark.loan_repaid',
      '{}'::jsonb,
      jsonb_build_object('loan_id', p_loan_id),
      NULL, NULL, now());
  END IF;
END;
$function$;
