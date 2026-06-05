-- Index the foreign-key columns on the betting tables.
--
-- Postgres does NOT auto-create indexes for foreign keys. The betting tables
-- only had their PK and UNIQUE-constraint indexes, so every lookup and every
-- cascade delete on these columns was a sequential scan — fine at 4 weeks of
-- data, increasingly bad as the pin economy grows season over season.
--
-- Columns already covered (no index needed):
--   bet_lines (week_id, player_id, game_number) UNIQUE → week_id-leading
--   placed_bets (player_id, bet_line_id)         UNIQUE → player_id-leading
-- so bet_lines.week_id and placed_bets.player_id are already indexable.
--
-- The rest are not, and back the hottest queries + FK cascades:

-- pin_ledger: balance (player_id+season_id), leaderboard (season_id),
-- removeByPlacedBet / cancel-RPC join (placed_bet_id), and the FK cascades
-- from players/seasons/placed_bets.
CREATE INDEX IF NOT EXISTS idx_pin_ledger_player_season ON public.pin_ledger (player_id, season_id);
CREATE INDEX IF NOT EXISTS idx_pin_ledger_season        ON public.pin_ledger (season_id);
CREATE INDEX IF NOT EXISTS idx_pin_ledger_placed_bet    ON public.pin_ledger (placed_bet_id);

-- placed_bets.bet_line_id: not covered by the (player_id, bet_line_id) unique
-- index (wrong leading column). Backs listByLine (settlement), listByWeek's
-- bet_lines join, and the bet_lines → placed_bets cascade delete.
CREATE INDEX IF NOT EXISTS idx_placed_bets_bet_line ON public.placed_bets (bet_line_id);

-- bet_lines.player_id: backs the players → bet_lines cascade and player-scoped
-- line lookups (week_id is already the leading column of the unique index).
CREATE INDEX IF NOT EXISTS idx_bet_lines_player ON public.bet_lines (player_id);
