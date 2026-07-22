-- OddsEngine follow-up: derive bet_selections.side from the key on INSERT.
--
-- Migration 1 backfilled side for existing rows and made grading/anti-tank
-- dispatch on side — but every pre-ladder insert path (the current sync
-- generators until migration 2, probe fixtures, any raw insert) still writes
-- only key. Without this trigger those selections carry side NULL and are
-- invisible to settle_market_internal / place_house_bet / prevent_self_tank.
-- The trigger makes side self-maintaining: key 'over'/'under' → same side;
-- ladder keys 'over:<line>'/'under:<line>' → their prefix; anything else
-- (moneyline team uuids) stays NULL.

CREATE OR REPLACE FUNCTION public.bet_selections_fill_side()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.side IS NULL THEN
    NEW.side := CASE
      WHEN NEW.key = 'over'  OR NEW.key LIKE 'over:%'  THEN 'over'
      WHEN NEW.key = 'under' OR NEW.key LIKE 'under:%' THEN 'under'
      ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_bet_selections_fill_side
  BEFORE INSERT ON public.bet_selections
  FOR EACH ROW EXECUTE FUNCTION public.bet_selections_fill_side();

-- Re-backfill anything inserted between the two migrations.
UPDATE public.bet_selections SET side = key WHERE side IS NULL AND key IN ('over', 'under');
