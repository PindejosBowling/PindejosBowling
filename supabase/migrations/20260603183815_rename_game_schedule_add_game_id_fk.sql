-- Rename game_schedule to games — it IS the games entity, not just a schedule
ALTER TABLE game_schedule RENAME TO games;

-- Add game_id FK to scores (nullable initially so we can backfill)
ALTER TABLE scores ADD COLUMN game_id uuid REFERENCES games(id);

-- Backfill: join scores → team_slots → games on (week_id, game_number)
-- Note: comma-separated FROM required — target table alias can't appear in a JOIN condition
UPDATE scores s
SET game_id = g.id
FROM team_slots ts, games g
WHERE s.team_slot_id = ts.id
  AND g.week_id = ts.week_id
  AND g.game_number = s.game_number;

-- Enforce NOT NULL now that all rows are backfilled
ALTER TABLE scores ALTER COLUMN game_id SET NOT NULL;

-- Unique constraint mirrors the old (team_slot_id, game_number) upsert key
ALTER TABLE scores
  ADD CONSTRAINT scores_team_slot_id_game_id_key UNIQUE (team_slot_id, game_id);

-- game_number remains on scores intentionally — drop it only after UI validation
