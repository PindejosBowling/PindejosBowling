-- Persist the league game ordering on official imported games. The importer
-- aligns a session's games (in play order) against the matched team_slot's
-- recorded official scores (ordered by the league's games.game_number) as an
-- in-order subsequence, so each Official game maps deterministically to a real
-- league game. `league_game_number` is that league game number for Official
-- games, and NULL for Recreational games (which the app numbers sequentially).
--
-- `game_number` is unchanged — it remains the Lanetalk session position and the
-- per-source_url unique key. This column is display/ordering metadata only.

ALTER TABLE public.lanetalk_game_imports
  ADD COLUMN league_game_number integer;
