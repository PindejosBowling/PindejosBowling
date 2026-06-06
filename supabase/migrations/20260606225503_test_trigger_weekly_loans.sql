-- THROWAWAY TEST MIGRATION — DO NOT KEEP.
-- Synthetically triggers the loan garnishment + interest process for the active
-- test loan (player c985c0ad…, season fe73b724…, Minnow Loan, garn 0.25 / int 0.08)
-- without performing a real week archive. process_weekly_loans is the exact
-- function settle_betting_for_week chains into at archive time; calling it directly
-- reproduces the same garnishment→interest sequence in one transaction.
--
-- Week 1 (3f14c31d…) already has real score_credit pincome = 237, so no synthetic
-- pincome is minted. Expected against outstanding 250:
--   garnish   = ceil(237 * 0.25) = 60  (capped at outstanding)
--   remaining = 190
--   interest  = ceil(190 * 0.08) = 16
--   new outstanding = 206
--
-- Clean up afterwards with a companion migration that deletes the loan_ledger
-- weekly rows (and any garnishment pin_ledger pair) for this loan/week, restoring
-- outstanding to 250.

SELECT public.process_weekly_loans('3f14c31d-e74b-49c6-afe6-4f4df3973b35'::uuid);
