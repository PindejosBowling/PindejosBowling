-- Normalize the redundant `week_id` out of `team_slots` and `games`.
--
-- `teams` is the first-class team entity (id PK, week_id, team_number). A slot belongs to
-- exactly one team, and each matchup's teams belong to exactly one week, so `week_id` on
-- both tables is functionally dependent on the team reference and therefore redundant.
--
-- The app's READ path was already decoupled (it derives week via team_slots -> teams ->
-- weeks and games -> teams -> weeks), so dropping the columns here is safe.
--
-- Asymmetry handled below:
--   * team_slots.week_id is pure redundancy -> simple team_id FK replaces the composite FK.
--   * games.week_id additionally enforced "team_a and team_b share a week" via the two
--     composite FKs sharing week_id. CHECK can't subquery, so a trigger replaces it.
--   * scores FKs gain ON DELETE CASCADE so a week wipe is a single delete of the week's teams.

-- ---------------------------------------------------------------------------
-- 1. team_slots: drop week_id; collapse composite FK to a simple team_id FK.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_slots DROP CONSTRAINT team_slots_team_id_week_id_fkey;
ALTER TABLE public.team_slots DROP CONSTRAINT team_slots_week_id_fkey;
ALTER TABLE public.team_slots
  ADD CONSTRAINT team_slots_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.team_slots DROP COLUMN week_id;
-- UNIQUE (team_id, slot) is unchanged and already enforces one slot per team.

-- ---------------------------------------------------------------------------
-- 2. games: collapse both composite FKs to simple team FKs; move the unique key
--    (team_a_id already implies the week); drop week_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.games DROP CONSTRAINT games_team_a_id_week_id_fkey;
ALTER TABLE public.games DROP CONSTRAINT games_team_b_id_week_id_fkey;
ALTER TABLE public.games DROP CONSTRAINT game_schedule_week_id_fkey;
ALTER TABLE public.games
  ADD CONSTRAINT games_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  ADD CONSTRAINT games_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.games DROP CONSTRAINT games_week_id_game_number_team_a_id_key;
ALTER TABLE public.games
  ADD CONSTRAINT games_game_number_team_a_id_key UNIQUE (game_number, team_a_id);
ALTER TABLE public.games DROP COLUMN week_id;
-- games_distinct_teams_check (team_a_id IS DISTINCT FROM team_b_id) stays.

-- ---------------------------------------------------------------------------
-- 3. teams_id_week_id_key was ONLY the composite-FK target — now unused.
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams DROP CONSTRAINT teams_id_week_id_key;

-- ---------------------------------------------------------------------------
-- 4. Same-week guarantee for games, formerly enforced by the shared-week composite FKs.
--    SECURITY INVOKER (default); teams is readable by authenticated via RLS and writers
--    are admins. search_path pinned empty + schema-qualified per advisor guidance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.games_same_week() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE wa uuid; wb uuid;
BEGIN
  SELECT week_id INTO wa FROM public.teams WHERE id = NEW.team_a_id;
  SELECT week_id INTO wb FROM public.teams WHERE id = NEW.team_b_id;
  IF wa IS DISTINCT FROM wb THEN
    RAISE EXCEPTION 'games.team_a_id and team_b_id must belong to the same week (% vs %)', wa, wb;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER games_same_week_check
  BEFORE INSERT OR UPDATE OF team_a_id, team_b_id ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_same_week();

-- ---------------------------------------------------------------------------
-- 5. Cascade scores so wiping a week is a single delete of the week's teams
--    (teams -> team_slots/games -> scores all cascade).
-- ---------------------------------------------------------------------------
ALTER TABLE public.scores DROP CONSTRAINT scores_team_slot_id_fkey;
ALTER TABLE public.scores
  ADD CONSTRAINT scores_team_slot_id_fkey
    FOREIGN KEY (team_slot_id) REFERENCES public.team_slots(id) ON DELETE CASCADE;
ALTER TABLE public.scores DROP CONSTRAINT scores_game_id_fkey;
ALTER TABLE public.scores
  ADD CONSTRAINT scores_game_id_fkey
    FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;
