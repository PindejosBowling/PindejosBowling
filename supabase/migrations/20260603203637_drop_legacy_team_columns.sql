-- Phase 2 of the `teams` rollout: enforce NOT NULL on the UUID columns, swap the
-- unique constraints onto them, and drop the deprecated legacy integer columns
-- (team_slots.team_number, games.team_a, games.team_b).
--
-- Reversible: the dropped columns are fully derivable from the kept UUID columns
-- (team_number = teams.team_number via team_id; team_a/team_b = the referenced
-- teams' team_number via team_a_id/team_b_id).

-- ---------------------------------------------------------------------------
-- 1. The UUID columns are now the source of truth — require them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_slots ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE public.games
  ALTER COLUMN team_a_id SET NOT NULL,
  ALTER COLUMN team_b_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Move the unique constraints from the integer columns to the UUID columns.
--    team_id implies (week_id, team_number), so (team_id, slot) is equivalent
--    to the old (week_id, team_number, slot).
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_slots
  DROP CONSTRAINT team_slots_week_id_team_number_slot_key,
  ADD CONSTRAINT team_slots_team_id_slot_key UNIQUE (team_id, slot);

ALTER TABLE public.games
  DROP CONSTRAINT game_schedule_week_id_game_number_team_a_key,
  ADD CONSTRAINT games_week_id_game_number_team_a_id_key UNIQUE (week_id, game_number, team_a_id);

-- ---------------------------------------------------------------------------
-- 3. Drop the legacy integer columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_slots DROP COLUMN team_number;
ALTER TABLE public.games
  DROP COLUMN team_a,
  DROP COLUMN team_b;
