-- Introduce a first-class `teams` entity and re-point team_slots/games at it.
--
-- Phase 1 (this migration): additive only. New columns are NULLABLE and the old
-- integer columns (team_slots.team_number, games.team_a, games.team_b) are kept so
-- the already-deployed app bundle keeps working. Phase 2 drops the old columns and
-- enforces NOT NULL once the new bundle is verified in production.

-- ---------------------------------------------------------------------------
-- 1. teams table
--    created_at/updated_at are REQUIRED at CREATE TABLE time by the
--    enforce_audit_columns event trigger (20260603175119).
-- ---------------------------------------------------------------------------
CREATE TABLE public.teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id     uuid NOT NULL,
  team_number integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.teams
  ADD CONSTRAINT teams_week_id_fkey
    FOREIGN KEY (week_id) REFERENCES public.weeks(id) ON DELETE CASCADE,
  ADD CONSTRAINT teams_week_id_team_number_key UNIQUE (week_id, team_number),
  -- Composite-FK target so team_slots/games can be pinned to a team *in their own week*.
  ADD CONSTRAINT teams_id_week_id_key UNIQUE (id, week_id);

-- updated_at maintenance (shared trigger fn from 20260603174412)
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS + grants — mirror the existing games/team_slots policies
--    (read for any authenticated user; writes gated on the admin app_metadata role)
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;

CREATE POLICY "authenticated can read" ON public.teams
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "admin can insert" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.teams
  FOR UPDATE TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.teams
  FOR DELETE TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- 3. Seed teams from every (week, team_number) referenced by existing data
-- ---------------------------------------------------------------------------
INSERT INTO public.teams (week_id, team_number)
SELECT DISTINCT week_id, team_number FROM public.team_slots
UNION
SELECT DISTINCT week_id, team_a FROM public.games
UNION
SELECT DISTINCT week_id, team_b FROM public.games;

-- ---------------------------------------------------------------------------
-- 4. team_slots.team_id  (nullable in Phase 1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_slots ADD COLUMN team_id uuid;

UPDATE public.team_slots ts
SET team_id = t.id
FROM public.teams t
WHERE t.week_id = ts.week_id
  AND t.team_number = ts.team_number;

-- Composite FK pins a slot to a team in the SAME week (MATCH SIMPLE: skipped while team_id is null).
ALTER TABLE public.team_slots
  ADD CONSTRAINT team_slots_team_id_week_id_fkey
    FOREIGN KEY (team_id, week_id) REFERENCES public.teams (id, week_id) ON DELETE CASCADE;

CREATE INDEX team_slots_team_id_idx ON public.team_slots (team_id);

-- ---------------------------------------------------------------------------
-- 5. games.team_a_id / team_b_id  (nullable in Phase 1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.games
  ADD COLUMN team_a_id uuid,
  ADD COLUMN team_b_id uuid;

UPDATE public.games g
SET team_a_id = ta.id
FROM public.teams ta
WHERE ta.week_id = g.week_id
  AND ta.team_number = g.team_a;

UPDATE public.games g
SET team_b_id = tb.id
FROM public.teams tb
WHERE tb.week_id = g.week_id
  AND tb.team_number = g.team_b;

ALTER TABLE public.games
  ADD CONSTRAINT games_team_a_id_week_id_fkey
    FOREIGN KEY (team_a_id, week_id) REFERENCES public.teams (id, week_id) ON DELETE CASCADE,
  ADD CONSTRAINT games_team_b_id_week_id_fkey
    FOREIGN KEY (team_b_id, week_id) REFERENCES public.teams (id, week_id) ON DELETE CASCADE,
  -- A game can't play itself. (Passes while either id is null.)
  ADD CONSTRAINT games_distinct_teams_check CHECK (team_a_id IS DISTINCT FROM team_b_id);

CREATE INDEX games_team_a_id_idx ON public.games (team_a_id);
CREATE INDEX games_team_b_id_idx ON public.games (team_b_id);
