-- Fix Season 1 win/loss records corrupted by mis-linked score game_ids.
--
-- Root cause: for Season 1 weeks 1–5 and week 8 (playoffs), all teams' scores
-- for a given game number were collapsed onto a single matchup row instead of
-- being split across that round's two matchups. The correct (empty) matchup rows
-- already exist in `games`. The win/loss compute skips any game whose matchup
-- does not include the score's own team, so those games dropped out of the
-- record (but not the average) — undercounting W/L.
--
-- Fix: re-point each mismatched score to the game in the SAME week with the SAME
-- game_number whose matchup includes the score's own team. Pure game_id re-link —
-- no inserts, deletes, or score-value changes; averages unaffected.
--
-- Verified before authoring:
--   * 66 mismatched scores; each resolves to exactly 1 correct target game (0 ambiguous).
--   * 0 unique-constraint (team_slot_id, game_id) conflicts — target rows hold no
--     score for these slots.
--   * Post-repair W/L simulation matches the Season 1 Summary CSV for all 12 players.

UPDATE scores sc
SET game_id = correctg.id
FROM team_slots ts,
     teams tm,
     games gcur,
     games correctg,
     teams cca
WHERE sc.team_slot_id = ts.id
  AND tm.id = ts.team_id
  AND gcur.id = sc.game_id
  AND correctg.game_number = gcur.game_number
  AND (correctg.team_a_id = ts.team_id OR correctg.team_b_id = ts.team_id)
  AND cca.id = correctg.team_a_id
  AND cca.week_id = tm.week_id
  -- only rows whose current game does NOT contain the score's own team
  AND ts.team_id <> gcur.team_a_id
  AND (gcur.team_b_id IS NULL OR ts.team_id <> gcur.team_b_id);
-- Expected: 66 rows updated.
