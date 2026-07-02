-- Team-aggregate prop markets — anti-tank (PR1, migration 4 of 4).
--
-- Today prevent_self_tank blocks a player backing the 'under' (or laying the
-- 'over') on their OWN player line — keyed on m.subject_player_id = bettor. A
-- team_prop market has subject_player_id NULL, so that guard never fires: a
-- player could bet the under on their OWN team (betting their team to do poorly).
--
-- Extend the trigger with a team branch: block under-back / over-lay on a
-- team_prop whose params.team_id is a team the bettor is rostered on (non-fill)
-- this week. The trigger is the authoritative backstop (it fires on every
-- bet_legs insert, so it covers place_house_bet and any future path); the app
-- surfaces the friendly pre-check + under-hide, mirroring the player O/U policy.

CREATE OR REPLACE FUNCTION public.prevent_self_tank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_bettor      uuid;
  v_subject     uuid;
  v_key         text;
  v_market_type text;
  v_params      jsonb;
BEGIN
  SELECT player_id INTO v_bettor FROM public.bets WHERE id = NEW.bet_id;

  SELECT m.subject_player_id, s.key, m.market_type, m.params
    INTO v_subject, v_key, v_market_type, v_params
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = NEW.selection_id;

  -- Player markets: no backing the under (or laying the over) on your OWN line.
  IF v_subject IS NOT NULL AND v_subject = v_bettor THEN
    IF (NEW.side = 'back' AND v_key = 'under')
       OR (NEW.side = 'lay' AND v_key = 'over') THEN
      RAISE EXCEPTION 'A player cannot bet against their own performance (anti-tanking)';
    END IF;
  END IF;

  -- Team markets: no backing the under (or laying the over) on a team the bettor
  -- is rostered on this week (betting your own team to do poorly).
  IF v_market_type = 'team_prop'
     AND ((NEW.side = 'back' AND v_key = 'under') OR (NEW.side = 'lay' AND v_key = 'over')) THEN
    IF EXISTS (
      SELECT 1 FROM public.team_slots ts
      WHERE ts.team_id = (v_params ->> 'team_id')::uuid
        AND ts.player_id = v_bettor
        AND ts.is_fill = false
    ) THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own team (anti-tanking)';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;
