-- House-funded bonuses + house_seed cleanup
-- ===========================================================================
-- Bonuses (formerly the player-only `champion_bonus` faucet) become DOUBLE-ENTRY
-- against the house: each bonus credit to a player is paired with a house debit
-- of the same magnitude, so the bonus nets to zero across the economy and the
-- house balance reflects bonuses it has paid out. Only `score_credit` remains a
-- true mint. The ledger `type` is generalized to a reusable `bonus`.
--
-- `house_seed` is dropped entirely: it was a per-season amount-0 marker with no
-- balance impact, never inserted on new-season open and referenced by no code.
--
-- Updated conservation invariant:  SUM(amount) = SUM(score_credit).
-- ===========================================================================

-- 1. Drop the old CHECK first — it forbids 'bonus', so it must go before the
--    UPDATE that renames champion_bonus → bonus can succeed.
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;

-- 2. Generalize champion_bonus → bonus, and remove the dead house_seed rows.
UPDATE public.pin_ledger SET type = 'bonus' WHERE type = 'champion_bonus';
DELETE FROM public.pin_ledger WHERE type = 'house_seed';

-- 3. Re-add the type vocabulary without champion_bonus / house_seed.
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'bonus', 'score_credit',                   -- faucets (score_credit is the only mint)
    'bet_stake', 'bet_payout', 'bet_refund'    -- double-entry betting transfers
  ));

-- 4. Backfill one paired house debit per existing bonus player credit, so
--    historical bonuses are reflected on the house side. Re-run safety is a
--    GLOBAL guard: if any house bonus row already exists the whole backfill is
--    skipped (a per-row/amount match would wrongly collapse multiple equal
--    credits in the same season into a single house debit).
INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
SELECT NULL, pl.season_id, NULL, true, -pl.amount, 'bonus',
       'House-funded: ' || pl.description
FROM public.pin_ledger pl
WHERE pl.type = 'bonus'
  AND pl.is_house = false
  AND NOT EXISTS (
    SELECT 1 FROM public.pin_ledger h
    WHERE h.type = 'bonus' AND h.is_house = true
  );
