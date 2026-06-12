-- Index tuning (TODO_DB_PERFORMANCE §2–§4).
--
-- §2 Covering index: every economic RPC computes SUM(amount) over
-- (player_id, season_id) — pin_balance() is the hottest query in the schema.
-- INCLUDE (amount) makes it index-only.
DROP INDEX public.idx_pin_ledger_player_season;
CREATE INDEX idx_pin_ledger_player_season
  ON public.pin_ledger (player_id, season_id) INCLUDE (amount);

-- §3 Redundant drops — evidence-gated (pg_stat_user_indexes, 2026-06-12):
-- both are prefix-redundant with their composite board indexes AND have
-- idx_scan = 0. The other candidates showed real use and are KEPT
-- (idx_bet_markets_status 378, idx_pin_ledger_house 304, idx_bets_status 5,
-- idx_pin_ledger_season 2).
DROP INDEX public.bounty_post_season_id_idx;   -- prefix of bounty_post_board_idx
DROP INDEX public.bounty_post_week_id_idx;     -- prefix of bounty_post_week_board_idx

-- §4 Missing FK indexes: matter when the referenced side deletes (week
-- teardown cascades games → scores; player merges scan team_slots/rsvp).
CREATE INDEX scores_game_id_idx       ON public.scores (game_id);
CREATE INDEX team_slots_player_id_idx ON public.team_slots (player_id);
CREATE INDEX rsvp_player_id_idx       ON public.rsvp (player_id);
