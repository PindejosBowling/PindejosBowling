-- ============================================================================
-- Phase 2 · WS6 — Decommission the legacy betting infrastructure.
-- ============================================================================
-- Over/under now runs entirely on the target model (bet_markets / bet_selections
-- / bets / bet_legs) with funded-house double-entry accounting. Legacy history has
-- been migrated (WS5). Nothing in the app or DB references the legacy objects.
-- Drop them in FK-safe order.
-- ============================================================================

-- 1. Legacy player-write RPCs (superseded by place_house_bet /
--    sync_over_under_markets_for_week).
DROP FUNCTION IF EXISTS public.place_bet(uuid, text, integer);
DROP FUNCTION IF EXISTS public.sync_bet_lines_for_week(uuid);

-- 2. The legacy ledger → placed_bets linkage. pin_ledger.bet_id (target model)
--    has already been backfilled (WS5), so this column is dead.
ALTER TABLE public.pin_ledger DROP COLUMN IF EXISTS placed_bet_id;

-- 3. Legacy tables. Dropping placed_bets removes its anti-tank trigger
--    (placed_bets_no_self_under); bet_lines is referenced only by placed_bets
--    (now gone) and cascades nothing else.
DROP TABLE IF EXISTS public.placed_bets;
DROP TABLE IF EXISTS public.bet_lines;

-- 4. The legacy anti-tank trigger function (replaced by prevent_self_tank on
--    bet_legs). Safe to drop now that its trigger's table is gone.
DROP FUNCTION IF EXISTS public.prevent_self_under_bet();

-- 5. Prune the legacy ledger type values now that no rows use them (renamed to
--    bet_stake / bet_payout / bet_refund in WS5). The current vocabulary is the
--    two faucets, the three double-entry transfers, and the house seed.
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'champion_bonus', 'score_credit',          -- faucets (mints, player-only)
    'bet_stake', 'bet_payout', 'bet_refund',   -- double-entry betting transfers
    'house_seed'                               -- explicit house mint
  ));
