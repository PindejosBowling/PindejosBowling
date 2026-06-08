-- ============================================================================
-- Bounty Board — pin_ledger extension (economy/BOUNTIES_DB.md §2).
-- ============================================================================
-- Adds the root bounty_post_id link (+ optional granular per-stake/per-payout/
-- per-settlement links) to pin_ledger and extends pin_ledger.type with the three
-- bounty_* transfer types.
--
-- The root bounty_post_id is the MOST IMPORTANT linkage — it is what destructive
-- cancel deletes by (design §23.1). It is stamped on EVERY bounty-related pin row,
-- on BOTH the player side and the house side of each pair, so cancel_bounty can
-- delete all of them with one DELETE … WHERE bounty_post_id = X (§27). There is no
-- separate bounty-domain ledger table — pin_ledger rows carry bounty_post_id
-- directly (no mutual-ref link to wire up, unlike pvp_ledger / debt_ledger).
-- ============================================================================


-- ============================================================================
-- 1. Root + granular FK columns.
-- ============================================================================
ALTER TABLE public.pin_ledger
  ADD COLUMN bounty_post_id         uuid REFERENCES public.bounty_post(id)            ON DELETE CASCADE,
  ADD COLUMN bounty_hunter_stake_id uuid REFERENCES public.bounty_hunter_stakes(id)   ON DELETE CASCADE,
  ADD COLUMN bounty_settlement_id   uuid REFERENCES public.bounty_settlements(id)     ON DELETE CASCADE,
  ADD COLUMN bounty_payout_id       uuid REFERENCES public.bounty_payouts(id)         ON DELETE CASCADE;

CREATE INDEX pin_ledger_bounty_post_id_idx         ON public.pin_ledger (bounty_post_id);
CREATE INDEX pin_ledger_bounty_hunter_stake_id_idx ON public.pin_ledger (bounty_hunter_stake_id);
CREATE INDEX pin_ledger_bounty_settlement_id_idx   ON public.pin_ledger (bounty_settlement_id);
CREATE INDEX pin_ledger_bounty_payout_id_idx       ON public.pin_ledger (bounty_payout_id);


-- ============================================================================
-- 2. Extend pin_ledger.type CHECK with the three bounty transfer types.
-- ============================================================================
-- Live set confirmed from 20260607002141_pin_ledger_pvp_support.sql: bonus,
-- score_credit, bet_*, loan_*, pvp_*. No bounty_refund / bounty_void /
-- bounty_cancelled — cancellation deletes rows, it does not write reversals
-- (design §23.2).
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'bonus', 'score_credit',                                                        -- faucets (mints, player-only)
    'bet_stake', 'bet_payout', 'bet_refund',                                        -- betting double-entry transfers
    'loan_issued', 'loan_manual_repayment',                                         -- loan double-entry transfers
    'loan_weekly_garnishment', 'loan_season_close_settlement',                      -- loan auto transfers
    'pvp_stake', 'pvp_payout', 'pvp_refund', 'pvp_rake',                            -- PvP challenge transfers
    'bounty_sponsor_stake', 'bounty_hunter_stake', 'bounty_payout'                  -- Bounty Board transfers
  ));
