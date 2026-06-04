-- Anti-tanking hard constraint: a player may never bet the UNDER on their own
-- bet line. A bet line's subject is bet_lines.player_id; a placed bet's bettor
-- is placed_bets.player_id. If a player bet the under on themselves they could
-- intentionally bowl badly to win, manipulating the outcome.
--
-- Enforced at the database (not just the BettingScreen UI) so it cannot be
-- bypassed by a crafted request. A BEFORE INSERT/UPDATE trigger rejects any
-- placed_bet where pick = 'under' and the bettor is the line's subject.

CREATE OR REPLACE FUNCTION public.prevent_self_under_bet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pick = 'under' AND EXISTS (
    SELECT 1
    FROM public.bet_lines bl
    WHERE bl.id = NEW.bet_line_id
      AND bl.player_id = NEW.player_id
  ) THEN
    RAISE EXCEPTION 'A player cannot bet the under on their own line';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER placed_bets_no_self_under
  BEFORE INSERT OR UPDATE ON public.placed_bets
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_under_bet();
