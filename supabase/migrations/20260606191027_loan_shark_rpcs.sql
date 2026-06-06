-- ============================================================================
-- Loan Shark — RPCs.
-- ============================================================================
-- Modeled on place_house_bet / settle_market_internal / cancel_bet. Every RPC is
-- SECURITY DEFINER with a pinned search_path and fully-qualified objects; identity
-- comes from auth.uid() (never a client-supplied player id). Balances/debt are
-- always derived:
--   balance = SUM(pin_ledger.amount) WHERE player_id = X AND season_id = Y
--   debt    = SUM(debt_ledger.amount) WHERE loan_id = L
-- Loan transfers stamp debt_ledger_id on BOTH pin rows (player + house) so
-- cancel_loan deletes by it and catches both sides. Each pin row is inserted with
-- its own RETURNING so the two ids are captured deterministically (no time-window
-- guessing), then the debt row links the player row and both pin rows are stamped.
-- ============================================================================


-- ============================================================================
-- 1. take_loan — issue a loan to the caller (design §11.1, §10.1).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.take_loan(p_loan_product_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  -- Current season = is_active AND NOT registration_open (seasons.getCurrent()).
  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  -- Lock the product row to serialize the max_uses check.
  SELECT * INTO v_product FROM public.loan_products WHERE id = p_loan_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Loan product not found';
  END IF;

  -- Availability (design §10).
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

  -- One active loan per player this season (app rule; checked here for safety).
  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE player_id = v_player_id AND season_id = v_season_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You already have an active loan this season';
  END IF;

  -- Current week (may be NULL — acceptable).
  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.loans (player_id, season_id, loan_product_id, status)
    VALUES (v_player_id, v_season_id, p_loan_product_id, 'active')
    RETURNING id INTO v_loan_id;

  -- Double-entry: player +borrow_amount, house −borrow_amount (nets to zero).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_season_id, v_week_id, false, v_product.borrow_amount, 'loan_issued', 'Loan issued: ' || v_product.display_name)
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_season_id, v_week_id, true, -v_product.borrow_amount, 'loan_issued', 'Loan issued (house): ' || v_product.display_name)
    RETURNING id INTO v_pin_house;

  INSERT INTO public.debt_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (v_loan_id, v_player_id, v_season_id, v_week_id, v_product.borrow_amount, 'loan_issued',
            'Loan issued: ' || v_product.display_name, v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET debt_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  RETURN v_loan_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.take_loan(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.take_loan(uuid) TO authenticated;


-- ============================================================================
-- 2. repay_loan — manual repayment by the caller (design §11.2).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.repay_loan(p_loan_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    FROM public.debt_ledger WHERE loan_id = p_loan_id;
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

  -- Double-entry: player −p_amount, house +p_amount.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_loan.season_id, v_week_id, false, -p_amount, 'loan_manual_repayment', 'Loan repayment')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_loan.season_id, v_week_id, true, p_amount, 'loan_manual_repayment', 'Loan repayment (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.debt_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_loan_id, v_player_id, v_loan.season_id, v_week_id, -p_amount, 'manual_repayment', 'Loan repayment', v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET debt_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  -- Payoff is an outcome, not an event type (design §9.6).
  IF v_outstanding - p_amount = 0 THEN
    UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = p_loan_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repay_loan(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.repay_loan(uuid, integer) TO authenticated;


-- ============================================================================
-- 3. process_weekly_loans — garnishment + interest at weekly settlement.
-- ============================================================================
-- Admin-gated. Called by settle_betting_for_week (already admin-gated) in the same
-- transaction as the score_credit mint, so there is no player-action window
-- between garnishment and interest (design §6). Idempotent per (loan, week).
CREATE OR REPLACE FUNCTION public.process_weekly_loans(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_loan IN
    SELECT id, player_id, season_id, loan_product_id
    FROM public.loans
    WHERE season_id = v_season_id AND status = 'active'
  LOOP
    -- Idempotency: skip if this loan already has a weekly event for this week.
    IF EXISTS (
      SELECT 1 FROM public.debt_ledger
      WHERE loan_id = v_loan.id AND week_id = p_week_id
        AND type IN ('weekly_garnishment', 'weekly_interest')
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_product FROM public.loan_products WHERE id = v_loan.loan_product_id;

    -- Weekly bowling pincome: the score_credit rows minted for this week.
    SELECT COALESCE(SUM(amount), 0) INTO v_pincome
      FROM public.pin_ledger
      WHERE player_id = v_loan.player_id AND week_id = p_week_id AND type = 'score_credit';

    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.debt_ledger WHERE loan_id = v_loan.id;

    -- Already at zero → mark paid off, no interest.
    IF v_outstanding <= 0 THEN
      UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = v_loan.id;
      CONTINUE;
    END IF;

    -- Garnishment first (design §5.1), capped at outstanding, rounded up.
    v_garnish := LEAST(CEIL(v_pincome * v_product.garnishment_rate)::int, v_outstanding);
    IF v_garnish > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (v_loan.player_id, v_loan.season_id, p_week_id, false, -v_garnish, 'loan_weekly_garnishment', 'Loan garnishment')
        RETURNING id INTO v_pin_player;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (NULL, v_loan.season_id, p_week_id, true, v_garnish, 'loan_weekly_garnishment', 'Loan garnishment (house)')
        RETURNING id INTO v_pin_house;

      INSERT INTO public.debt_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, p_week_id, -v_garnish, 'weekly_garnishment', 'Loan garnishment', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET debt_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    -- Recompute; if garnishment cleared the loan, skip interest.
    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.debt_ledger WHERE loan_id = v_loan.id;
    IF v_outstanding <= 0 THEN
      UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = v_loan.id;
      CONTINUE;
    END IF;

    -- Weekly interest: debt_ledger only, no pin movement (design §5.1, §11.4).
    v_interest := CEIL(v_outstanding * v_product.weekly_interest_rate)::int;
    IF v_interest > 0 THEN
      INSERT INTO public.debt_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, p_week_id, v_interest, 'weekly_interest', 'Weekly interest', NULL);
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_weekly_loans(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.process_weekly_loans(uuid) TO authenticated;


-- ============================================================================
-- 4. settle_loans_for_season_close — auto-apply balance to debt (design §11.5).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_loans_for_season_close(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_loan        record;
  v_week_id     uuid;
  v_outstanding integer;
  v_balance     integer;
  v_payment     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Season's last week (or NULL) for week-stamping the settlement pin rows.
  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = p_season_id
    ORDER BY week_number DESC LIMIT 1;

  FOR v_loan IN
    SELECT id, player_id, season_id
    FROM public.loans
    WHERE season_id = p_season_id AND status = 'active'
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.debt_ledger WHERE loan_id = v_loan.id;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger
      WHERE player_id = v_loan.player_id AND season_id = v_loan.season_id;

    v_payment := LEAST(v_balance, v_outstanding);
    IF v_payment > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (v_loan.player_id, v_loan.season_id, v_week_id, false, -v_payment, 'loan_season_close_settlement', 'Season-close loan settlement')
        RETURNING id INTO v_pin_player;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (NULL, v_loan.season_id, v_week_id, true, v_payment, 'loan_season_close_settlement', 'Season-close loan settlement (house)')
        RETURNING id INTO v_pin_house;

      INSERT INTO public.debt_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, v_week_id, -v_payment, 'season_close_settlement', 'Season-close loan settlement', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET debt_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    -- Residual debt stays on the ledger → negative final net worth (design §7.2).
    UPDATE public.loans SET status = 'season_closed', season_closed_at = now() WHERE id = v_loan.id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_loans_for_season_close(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_loans_for_season_close(uuid) TO authenticated;


-- ============================================================================
-- 5. cancel_loan — admin destructive rollback (design §12), mirrors cancel_bet.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_loan(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Delete all pin rows linked through this loan's debt events (both sides).
  DELETE FROM public.pin_ledger
   WHERE debt_ledger_id IN (SELECT id FROM public.debt_ledger WHERE loan_id = p_loan_id);

  -- debt_ledger cascades from loans, but delete explicitly for clarity.
  DELETE FROM public.debt_ledger WHERE loan_id = p_loan_id;
  DELETE FROM public.loans WHERE id = p_loan_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_loan(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_loan(uuid) TO authenticated;
