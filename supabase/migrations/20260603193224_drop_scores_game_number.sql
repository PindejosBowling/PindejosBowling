-- game_number on scores is now dead data — game_id FK to games table is the canonical reference
ALTER TABLE scores DROP COLUMN game_number;
