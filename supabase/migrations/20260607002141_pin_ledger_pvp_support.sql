-- ============================================================================
-- PvP Challenge Contracts — pin_ledger extension.
-- ============================================================================
-- Adds pvp_ledger_id reverse-link column to pin_ledger (mutual reference with
-- pvp_ledger.pin_ledger_id, both nullable). Also adds the FK from pvp_ledger to
-- pin_ledger (deferred from the tables migration to resolve the circular ref),
-- and extends pin_ledger.type with the four pvp_* transfer types.
--
-- Cancel-friendliness: pvp_ledger_id is stamped on BOTH pin rows (player + house)
-- so cancel_pvp_challenge can delete by it and catch both sides (mirrors
-- debt_ledger_id / bet_id pattern).
-- ============================================================================


-- ============================================================================
-- 1. Add pvp_ledger_id reverse link to pin_ledger.
-- ============================================================================
ALTER TABLE public.pin_ledger
  ADD COLUMN pvp_ledger_id uuid REFERENCES public.pvp_ledger(id) ON DELETE SET NULL;

CREATE INDEX pin_ledger_pvp_ledger_id_idx ON public.pin_ledger (pvp_ledger_id);


-- ============================================================================
-- 2. Add the FK from pvp_ledger.pin_ledger_id to pin_ledger.
-- ============================================================================
-- This resolves the mutual reference now that pin_ledger.pvp_ledger_id exists.
ALTER TABLE public.pvp_ledger
  ADD CONSTRAINT pvp_ledger_pin_ledger_id_fkey
    FOREIGN KEY (pin_ledger_id) REFERENCES public.pin_ledger(id) ON DELETE SET NULL;


-- ============================================================================
-- 3. Extend pin_ledger.type CHECK to include the four PvP transfer types.
-- ============================================================================
-- Live set confirmed: bonus, score_credit, bet_stake, bet_payout, bet_refund,
-- loan_issued, loan_manual_repayment, loan_weekly_garnishment,
-- loan_season_close_settlement.
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'bonus', 'score_credit',                                                        -- faucets (mints, player-only)
    'bet_stake', 'bet_payout', 'bet_refund',                                        -- betting double-entry transfers
    'loan_issued', 'loan_manual_repayment',                                         -- loan double-entry transfers
    'loan_weekly_garnishment', 'loan_season_close_settlement',                      -- loan auto transfers
    'pvp_stake', 'pvp_payout', 'pvp_refund', 'pvp_rake'                            -- PvP challenge transfers
  ));
