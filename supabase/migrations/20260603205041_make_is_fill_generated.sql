-- team_slots.is_fill was a redundant boolean: a fill slot is exactly a slot with
-- no player_id (verified: 0 rows ever disagreed). Replace the hand-maintained flag
-- with a generated column so the database derives it and the two can never drift.
--
-- A regular column can't be converted to GENERATED in place, so drop and re-add.
-- The recomputed values are identical to the existing data.

ALTER TABLE public.team_slots DROP COLUMN is_fill;

ALTER TABLE public.team_slots
  ADD COLUMN is_fill boolean GENERATED ALWAYS AS (player_id IS NULL) STORED;
