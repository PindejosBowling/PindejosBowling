-- ============================================================================
-- Phase 2 · WS1 — Accounting migration: house account on pin_ledger + anti-tank.
-- ============================================================================
-- Additive. Does not disturb existing rows or the live per-player balance query
-- (balance = SUM(amount) WHERE player_id = X), because house rows are written
-- with player_id IS NULL / is_house = true and are therefore excluded by that
-- filter automatically.
--
-- This is the funded-house, double-entry foundation for the target betting model
-- (bet_markets / bet_selections / bets / bet_legs). Every betting transfer will
-- write TWO pin_ledger rows with the same bet_id and opposite signs (player vs
-- house), netting to zero. Faucet entries (score_credit / champion_bonus) stay
-- mints (player-only, no house counterpart).
--
-- House seed policy (decided): seed the house at 0 and allow its balance to go
-- negative. This preserves the effective infinite-bankroll feel of the legacy
-- mint-on-win model while making house liability auditable (a negative house
-- balance = pins owed out). Top up later with an explicit house_seed mint if a
-- finite bankroll is adopted.
-- ============================================================================

-- 1. House-account support on pin_ledger ------------------------------------
ALTER TABLE public.pin_ledger ALTER COLUMN player_id DROP NOT NULL;

ALTER TABLE public.pin_ledger
  ADD COLUMN is_house boolean NOT NULL DEFAULT false,
  ADD COLUMN bet_id   uuid    REFERENCES public.bets(id) ON DELETE SET NULL;

-- Every row is owned by either a player or the house (never neither).
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_owner_chk CHECK (is_house OR player_id IS NOT NULL);

-- Extend the type vocabulary with the double-entry betting types + the house
-- seed mint. The legacy bet_placed / bet_won / bet_push values are kept here for
-- now (no rows currently use them; pruned in WS6 once legacy is dropped).
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'champion_bonus', 'score_credit',                 -- faucets (mints, player-only)
    'bet_stake', 'bet_payout', 'bet_refund',          -- target double-entry transfers
    'house_seed',                                     -- explicit house mint
    'bet_placed', 'bet_won', 'bet_push'              -- legacy (pruned in WS6)
  ));

CREATE INDEX idx_pin_ledger_bet   ON public.pin_ledger (bet_id);
CREATE INDEX idx_pin_ledger_house ON public.pin_ledger (season_id) WHERE is_house;

-- 2. Anti-tanking trigger on bet_legs ---------------------------------------
-- A player may never bet AGAINST their own performance. For the back/lay model
-- that means: backing the 'under' on your own line, OR laying the 'over' on it.
-- Phase 2 is back-only (house O/U), so in practice this blocks backing 'under'
-- on your own market — the legacy placed_bets_no_self_under rule. The lay/over
-- arm future-proofs the guard for peer bets.
CREATE OR REPLACE FUNCTION public.prevent_self_tank()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bettor  uuid;
  v_subject uuid;
  v_key     text;
BEGIN
  SELECT player_id INTO v_bettor FROM public.bets WHERE id = NEW.bet_id;

  SELECT m.subject_player_id, s.key
    INTO v_subject, v_key
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = NEW.selection_id;

  IF v_subject IS NOT NULL AND v_subject = v_bettor THEN
    IF (NEW.side = 'back' AND v_key = 'under')
       OR (NEW.side = 'lay' AND v_key = 'over') THEN
      RAISE EXCEPTION 'A player cannot bet against their own performance (anti-tanking)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bet_legs_no_self_tank
  BEFORE INSERT OR UPDATE ON public.bet_legs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_tank();

-- 3. Seed the house account for every season that can host house bets --------
-- One house_seed marker row per season (amount 0; seed-0 policy above). Guarded
-- by NOT EXISTS so this migration is re-runnable and so later top-ups aren't
-- clobbered.
INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description)
SELECT NULL, s.id, true, 0, 'house_seed', 'House account opened (seed 0)'
FROM public.seasons s
WHERE NOT EXISTS (
  SELECT 1 FROM public.pin_ledger pl
  WHERE pl.season_id = s.id AND pl.type = 'house_seed'
);
