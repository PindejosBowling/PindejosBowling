-- ============================================================================
-- Moneyline betting · 1/3 — attach a market to a game (matchup).
-- ============================================================================
-- Over/under markets are about a player (subject_player_id). A moneyline is about
-- a *game* (which team wins a single team-vs-team matchup), so markets need to
-- point at a games row. Mirrors subject_player_id: nullable, one or the other set.
--   • over_under  → subject_player_id set, subject_game_id null
--   • moneyline   → subject_game_id set,   subject_player_id null
-- A "game" row is one matchup (games has team_a_id/team_b_id, one row per matchup
-- within a game_number round), so one moneyline market = one games row.

ALTER TABLE public.bet_markets
  ADD COLUMN subject_game_id uuid REFERENCES public.games(id) ON DELETE CASCADE;

-- FKs must be indexed (perf advisor; PIN_ECONOMY_SCHEMA.md §6).
CREATE INDEX idx_bet_markets_subject_game ON public.bet_markets (subject_game_id);
