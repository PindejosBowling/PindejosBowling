-- ============================================================================
-- Seed the 4 v1 global Loan Shark products (design §4).
-- ============================================================================
-- season_id NULL = global. Rates stored as decimals (8% = 0.08). Guarded by
-- NOT EXISTS on display_name so the migration is re-runnable. Descriptions and
-- warnings copied from design §4.1–§4.2 (only Feeding Frenzy + Blood in the Water
-- carry warning text).
INSERT INTO public.loan_products
  (season_id, display_name, description, special_warning_text, risk_level,
   borrow_amount, weekly_interest_rate, garnishment_rate, sort_order)
SELECT v.season_id, v.display_name, v.description, v.special_warning_text, v.risk_level,
       v.borrow_amount, v.weekly_interest_rate, v.garnishment_rate, v.sort_order
FROM (VALUES
  (NULL::uuid, 'Minnow Loan',
   'A small liquidity bump for players who need a few extra pins to get back in the action.',
   NULL::text, 'low', 250, 0.08, 0.25, 1),
  (NULL::uuid, 'Shark Bite',
   'A standard Loan Shark product for players looking to make a meaningful move.',
   NULL::text, 'medium', 500, 0.10, 0.35, 2),
  (NULL::uuid, 'Feeding Frenzy',
   'Aggressive leverage for players who want enough firepower to chase bigger opportunities.',
   'This loan may require strong weekly pincome, winnings, or manual repayments to escape cleanly.',
   'high', 750, 0.12, 0.45, 3),
  (NULL::uuid, 'Blood in the Water',
   'A dangerous high-leverage loan for players trying to make a major move.',
   'At average league pincome, automatic garnishment may only slow this debt rather than repay it. Missing league nights can cause the balance to spiral quickly.',
   'extreme', 1000, 0.15, 0.55, 4)
) AS v(season_id, display_name, description, special_warning_text, risk_level,
       borrow_amount, weekly_interest_rate, garnishment_rate, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.loan_products lp
  WHERE lp.display_name = v.display_name AND lp.season_id IS NOT DISTINCT FROM v.season_id
);
