-- Revert the short-lived league_game_number column. The league game ordering is
-- now written directly into game_number (official games take their league game
-- number; recreational games are numbered sequentially after them), so a
-- separate column is unnecessary. See 20260610140000_lanetalk_league_game_number.

ALTER TABLE public.lanetalk_game_imports
  DROP COLUMN IF EXISTS league_game_number;
