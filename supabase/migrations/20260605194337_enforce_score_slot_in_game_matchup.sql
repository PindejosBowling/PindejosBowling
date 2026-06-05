-- Guard: a score may only attach to a game whose matchup includes the score's
-- own team. Prevents the class of corruption fixed in
-- 20260605193514_fix_season1_mismatched_score_game_links.sql, where Season 1
-- scores were linked to a game (same week + game_number) belonging to the OTHER
-- matchup in that round. Such scores silently dropped out of W/L records (the
-- opponent lookup found the team absent from the matchup and skipped the game)
-- while still counting toward averages.
--
-- The invariant spans tables (scores -> team_slots.team_id must equal one of
-- games.team_a_id / team_b_id), so a CHECK constraint can't express it — enforced
-- by a BEFORE INSERT/UPDATE trigger, mirroring public.games_same_week().
--
-- SECURITY INVOKER (default); team_slots/games are readable by authenticated via
-- RLS and writers are admins. search_path pinned empty + schema-qualified per
-- advisor guidance. Existing data verified clean (0 violations) before adding.

CREATE OR REPLACE FUNCTION public.scores_slot_in_game() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE slot_team uuid; ga uuid; gb uuid;
BEGIN
  SELECT team_id INTO slot_team FROM public.team_slots WHERE id = NEW.team_slot_id;
  SELECT team_a_id, team_b_id INTO ga, gb FROM public.games WHERE id = NEW.game_id;
  IF slot_team IS DISTINCT FROM ga AND slot_team IS DISTINCT FROM gb THEN
    RAISE EXCEPTION 'scores.game_id (%) matchup (% vs %) does not include the slot''s team (%)',
      NEW.game_id, ga, gb, slot_team;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scores_slot_in_game_check
  BEFORE INSERT OR UPDATE OF team_slot_id, game_id ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.scores_slot_in_game();
