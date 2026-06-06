-- ============================================================================
-- Rename debt_ledger → loan_ledger (table + all related identifiers).
-- ============================================================================
-- Renames the table, the reverse-reference column pin_ledger.debt_ledger_id →
-- loan_ledger_id, and every constraint / index that carried the old name. The
-- five Loan Shark RPCs reference the old object names by text in their bodies,
-- so they are recreated with the new names (search_path-pinned, fully qualified).
-- RLS policy names are generic ("authenticated can read", …) and follow the
-- table automatically — no policy changes needed.
-- ============================================================================

-- 1. Table.
ALTER TABLE public.debt_ledger RENAME TO loan_ledger;

-- 2. Reverse-reference column on pin_ledger.
ALTER TABLE public.pin_ledger RENAME COLUMN debt_ledger_id TO loan_ledger_id;

-- 3. Constraints (PK, type CHECK, FKs on loan_ledger, + the FK on pin_ledger).
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_pkey            TO loan_ledger_pkey;
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_type_check      TO loan_ledger_type_check;
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_loan_id_fkey    TO loan_ledger_loan_id_fkey;
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_pin_ledger_id_fkey TO loan_ledger_pin_ledger_id_fkey;
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_player_id_fkey  TO loan_ledger_player_id_fkey;
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_season_id_fkey  TO loan_ledger_season_id_fkey;
ALTER TABLE public.loan_ledger RENAME CONSTRAINT debt_ledger_week_id_fkey    TO loan_ledger_week_id_fkey;
ALTER TABLE public.pin_ledger  RENAME CONSTRAINT pin_ledger_debt_ledger_id_fkey TO pin_ledger_loan_ledger_id_fkey;

-- 4. Indexes.
ALTER INDEX public.debt_ledger_loan_id_idx       RENAME TO loan_ledger_loan_id_idx;
ALTER INDEX public.debt_ledger_player_id_idx     RENAME TO loan_ledger_player_id_idx;
ALTER INDEX public.debt_ledger_season_id_idx     RENAME TO loan_ledger_season_id_idx;
ALTER INDEX public.debt_ledger_week_id_idx       RENAME TO loan_ledger_week_id_idx;
ALTER INDEX public.debt_ledger_pin_ledger_id_idx RENAME TO loan_ledger_pin_ledger_id_idx;
ALTER INDEX public.pin_ledger_debt_ledger_id_idx RENAME TO pin_ledger_loan_ledger_id_idx;

-- ============================================================================
-- 5. Recreate the Loan Shark RPCs against the renamed objects.
--    (Function bodies referenced public.debt_ledger / debt_ledger_id by text.)
-- ============================================================================

-- 5.1 take_loan
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

  RETURN v_loan_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.take_loan(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.take_loan(uuid) TO authenticated;


-- 5.2 repay_loan
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
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repay_loan(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.repay_loan(uuid, integer) TO authenticated;


-- 5.3 process_weekly_loans
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
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (v_loan.player_id, v_loan.season_id, p_week_id, false, -v_garnish, 'loan_weekly_garnishment', 'Loan garnishment')
        RETURNING id INTO v_pin_player;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
        VALUES (NULL, v_loan.season_id, p_week_id, true, v_garnish, 'loan_weekly_garnishment', 'Loan garnishment (house)')
        RETURNING id INTO v_pin_house;

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
$$;

REVOKE EXECUTE ON FUNCTION public.process_weekly_loans(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.process_weekly_loans(uuid) TO authenticated;


-- 5.4 settle_loans_for_season_close
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

      INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (v_loan.id, v_loan.player_id, v_loan.season_id, v_week_id, -v_payment, 'season_close_settlement', 'Season-close loan settlement', v_pin_player)
        RETURNING id INTO v_debt_id;

      UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);
    END IF;

    UPDATE public.loans SET status = 'season_closed', season_closed_at = now() WHERE id = v_loan.id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_loans_for_season_close(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_loans_for_season_close(uuid) TO authenticated;


-- 5.5 cancel_loan
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

  DELETE FROM public.pin_ledger
   WHERE loan_ledger_id IN (SELECT id FROM public.loan_ledger WHERE loan_id = p_loan_id);

  DELETE FROM public.loan_ledger WHERE loan_id = p_loan_id;
  DELETE FROM public.loans WHERE id = p_loan_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_loan(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_loan(uuid) TO authenticated;
