-- ============================================================================
-- Loan Shark — tables, pin_ledger extension, and immutability trigger.
-- ============================================================================
-- The DB foundation for the Debt & Leverage feature (economy/ECONOMIC_DESIGN_DEBT.md).
-- Three append-only / lifecycle tables (loan_products, loans, debt_ledger) plus a
-- nullable debt_ledger_id link on pin_ledger, mirroring the bet_* / pin_ledger
-- conventions (funded-house double-entry; balances derived by SUM; corrections
-- are new rows). All player write paths go through the SECURITY DEFINER RPCs in
-- a later migration — RLS here only opens reads + admin-direct writes.
--
-- Audit columns: created_at + updated_at only; the enforce_audit_columns event
-- trigger auto-attaches set_updated_at (do NOT declare it here — it would collide).
-- ============================================================================


-- ============================================================================
-- 1. loan_products — immutable historical Loan Shark offers (design §9.2).
-- ============================================================================
-- id is canonical (no product_key). Existing loans keep referencing their
-- original product even after it is deactivated. Functional terms (season_id,
-- amounts, rates, availability window, max_uses) are immutable — enforced by the
-- trigger in §5 below.
CREATE TABLE public.loan_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id            uuid REFERENCES public.seasons(id),  -- NULL = global. Immutable.
  display_name         text NOT NULL,
  description          text NOT NULL,
  special_warning_text text,
  risk_level           text NOT NULL CHECK (risk_level IN ('low','medium','high','extreme')),
  borrow_amount        integer NOT NULL CHECK (borrow_amount > 0),                                    -- immutable
  weekly_interest_rate numeric(5,4) NOT NULL CHECK (weekly_interest_rate >= 0),                        -- immutable
  garnishment_rate     numeric(5,4) NOT NULL CHECK (garnishment_rate >= 0 AND garnishment_rate <= 1), -- immutable
  is_active            boolean NOT NULL DEFAULT true,
  available_from       timestamptz,                                                                    -- immutable
  available_until      timestamptz,                                                                    -- immutable
  max_uses             integer CHECK (max_uses IS NULL OR max_uses > 0),                               -- NULL = unlimited. immutable
  sort_order           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loan_products_season_id_idx ON public.loan_products (season_id);


-- ============================================================================
-- 2. loans — issued loan accounts + lifecycle (design §9.4).
-- ============================================================================
-- No stored balance — current debt is derived as SUM(debt_ledger.amount). The
-- "one active loan per player" rule is an application + RPC concern (design §3.3),
-- deliberately NOT a DB constraint so future versions can allow multiple loans.
CREATE TABLE public.loans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season_id        uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  loan_product_id  uuid NOT NULL REFERENCES public.loan_products(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid_off','season_closed')),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  paid_off_at      timestamptz,
  season_closed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loans_player_id_idx       ON public.loans (player_id);
CREATE INDEX loans_season_id_idx       ON public.loans (season_id);
CREATE INDEX loans_loan_product_id_idx ON public.loans (loan_product_id);


-- ============================================================================
-- 3. debt_ledger — append-only debt event log (design §9.5).
-- ============================================================================
-- loan_balance(loan) = SUM(amount). Signs are written by the RPCs per the design
-- sign table: loan_issued +, manual_repayment −, weekly_garnishment −,
-- weekly_interest +, season_close_settlement −.
-- pin_ledger_id links the player-side pin row when pins actually move (NULL for
-- weekly_interest, where no pins move). pin_ledger.debt_ledger_id is the reverse
-- link, added in §4 below; the RPCs set both after inserting all rows.
CREATE TABLE public.debt_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id       uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,   -- denormalized
  season_id     uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,   -- denormalized
  week_id       uuid REFERENCES public.weeks(id) ON DELETE SET NULL,
  amount        integer NOT NULL,  -- signed (see sign table)
  type          text NOT NULL CHECK (type IN (
                  'loan_issued', 'manual_repayment', 'weekly_garnishment',
                  'weekly_interest', 'season_close_settlement')),
  description   text NOT NULL,
  pin_ledger_id uuid REFERENCES public.pin_ledger(id) ON DELETE SET NULL,  -- player-side pin row; NULL for weekly_interest
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX debt_ledger_loan_id_idx       ON public.debt_ledger (loan_id);
CREATE INDEX debt_ledger_player_id_idx     ON public.debt_ledger (player_id);
CREATE INDEX debt_ledger_season_id_idx     ON public.debt_ledger (season_id);
CREATE INDEX debt_ledger_week_id_idx       ON public.debt_ledger (week_id);
CREATE INDEX debt_ledger_pin_ledger_id_idx ON public.debt_ledger (pin_ledger_id);


-- ============================================================================
-- 4. pin_ledger extension — reverse link + loan transfer types.
-- ============================================================================
-- debt_ledger.pin_ledger_id and pin_ledger.debt_ledger_id are mutually referential
-- and both nullable; the RPCs insert pin rows → insert the debt row → UPDATE both
-- pin rows' debt_ledger_id. Both sides of a loan transfer carry debt_ledger_id
-- (mirrors bet_id on both bet rows) so cancel_loan can delete by it and catch both.
ALTER TABLE public.pin_ledger
  ADD COLUMN debt_ledger_id uuid REFERENCES public.debt_ledger(id) ON DELETE SET NULL;

CREATE INDEX pin_ledger_debt_ledger_id_idx ON public.pin_ledger (debt_ledger_id);

-- Extend the pin_ledger.type vocabulary with the four loan transfer types. The
-- live set today is bonus / score_credit / bet_stake / bet_payout / bet_refund.
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'bonus', 'score_credit',                            -- faucets (mints, player-only)
    'bet_stake', 'bet_payout', 'bet_refund',            -- betting double-entry transfers
    'loan_issued', 'loan_manual_repayment',             -- loan double-entry transfers
    'loan_weekly_garnishment', 'loan_season_close_settlement'
  ));


-- ============================================================================
-- 5. Immutability trigger on loan_products (design §9.3.1).
-- ============================================================================
-- Rejects UPDATEs that change any functional term. Body per the design doc,
-- with the mandatory pinned search_path.
CREATE OR REPLACE FUNCTION public.prevent_loan_product_term_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.season_id IS DISTINCT FROM NEW.season_id
     OR OLD.borrow_amount IS DISTINCT FROM NEW.borrow_amount
     OR OLD.weekly_interest_rate IS DISTINCT FROM NEW.weekly_interest_rate
     OR OLD.garnishment_rate IS DISTINCT FROM NEW.garnishment_rate
     OR OLD.max_uses IS DISTINCT FROM NEW.max_uses
     OR OLD.available_from IS DISTINCT FROM NEW.available_from
     OR OLD.available_until IS DISTINCT FROM NEW.available_until THEN
    RAISE EXCEPTION 'loan product functional terms are immutable after creation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER loan_products_immutable_terms
  BEFORE UPDATE ON public.loan_products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_loan_product_term_updates();


-- ============================================================================
-- 6. RLS — mirror the bet_* tables (reads open; direct writes admin-only).
-- ============================================================================
-- All player write paths run through SECURITY DEFINER RPCs (which bypass RLS), so
-- players never write these tables directly.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loan_products', 'loans', 'debt_ledger'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "anon can read"          ON public.%I FOR SELECT TO anon          USING (true)', t);
    EXECUTE format('CREATE POLICY "authenticated can read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format($f$CREATE POLICY "admin can insert" ON public.%I FOR INSERT TO authenticated
      WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')$f$, t);
    EXECUTE format($f$CREATE POLICY "admin can update" ON public.%I FOR UPDATE TO authenticated
      USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
      WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')$f$, t);
    EXECUTE format($f$CREATE POLICY "admin can delete" ON public.%I FOR DELETE TO authenticated
      USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')$f$, t);
  END LOOP;
END $$;
