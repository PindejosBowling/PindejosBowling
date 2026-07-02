-- Team-aggregate prop markets — foundation (PR1, migration 1 of 4).
--
-- Introduces a new `market_type = 'team_prop'`: a bet on a TEAM's summed stat in
-- a single game (team total clean frames / strikes / spares / pins vs a line).
-- A team_prop market is anchored by subject_game_id (the persistent within-week
-- matchup, like moneyline) + params.team_id, with subject_player_id NULL. Its
-- selections are ordinary over/under sides sharing a line at even money, so the
-- existing over/under/push settlement engine grades it verbatim.
--
-- Why a distinct market_type (not another `params` flavor of 'prop'): team_props
-- span TWO settlement clocks — total_pins settles at archive from `scores`, while
-- the frame stats settle next-day on the LaneTalk clock. Both the settlement
-- loops AND the archive no-pending BACKSTOP dispatch on market_type, so a
-- dedicated type keeps that split clean and leaves the shipped 'prop' (LaneTalk
-- player props) system untouched. See PIN_ECONOMY_SCHEMA.md §3/§7.
--
-- This migration only widens the CHECK and teaches the shared settlement engine
-- to accept the new type. Generation (migration 2), settlement + backstop
-- (migration 3), and anti-tank (migration 4) build on it.

ALTER TABLE public.bet_markets DROP CONSTRAINT bet_markets_market_type_check;
ALTER TABLE public.bet_markets ADD CONSTRAINT bet_markets_market_type_check
  CHECK ((market_type = ANY (ARRAY['over_under'::text, 'moneyline'::text, 'prop'::text, 'team_prop'::text])));

-- Relax the over/under/push engine to grade team_prop markets too. team_prop
-- selections are 'over'/'under' sharing a `line`, identical in shape to O/U, so
-- the body is unchanged apart from the accepted-type guard.
CREATE OR REPLACE FUNCTION public.settle_market_internal(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market public.bet_markets;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type NOT IN ('over_under', 'prop', 'team_prop') THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under/prop/team_prop markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;

  -- Selection results: over wins above the line, under below; half-point lines
  -- never push, but equality is handled as push for completeness.
  UPDATE public.bet_selections s
    SET result = CASE
      WHEN s.key = 'over'  THEN CASE WHEN p_result_value > s.line THEN 'won'
                                     WHEN p_result_value < s.line THEN 'lost' ELSE 'push' END
      WHEN s.key = 'under' THEN CASE WHEN p_result_value < s.line THEN 'won'
                                     WHEN p_result_value > s.line THEN 'lost' ELSE 'push' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  UPDATE public.bet_markets
    SET result_value = p_result_value, status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$function$
;
