-- Backfill the pin economy (pin_ledger) for Season 2.
--
-- The betting feature was added after Season 2 had already started, so the
-- ledger entries that would normally be written by the live admin flows were
-- never created. This migration reproduces those entries for data that already
-- exists:
--   1. champion_bonus: +100 pins to each Season 1 champion (mirrors
--      AdminOpenRegistrationModal — "Season N champion bonus").
--   2. score_credit: +score per non-fill game score for every archived Season 2
--      week (weeks 1-4; week 5 is live/un-archived and will be credited normally
--      when it is archived). Mirrors settleBettingForWeek in AdminArchiveModal —
--      "Week N Game G: SCORE pins".
--
-- Seasons are resolved by number (Season 1 = prior, Season 2 = current) rather
-- than hardcoded uuids. Each insert is guarded with NOT EXISTS so re-running is
-- a no-op and cannot double-credit.

-- 1. Champion bonus: +100 to each Season 1 champion, credited into Season 2.
INSERT INTO pin_ledger (player_id, season_id, amount, type, description)
SELECT sc.player_id,
       s2.id,
       100,
       'champion_bonus',
       'Season ' || s1.number || ' champion bonus'
FROM seasons s1
JOIN season_champions sc ON sc.season_id = s1.id
CROSS JOIN seasons s2
WHERE s1.number = 1
  AND s2.number = 2
  AND NOT EXISTS (
    SELECT 1 FROM pin_ledger pl
    WHERE pl.player_id = sc.player_id
      AND pl.season_id = s2.id
      AND pl.type = 'champion_bonus'
  );

-- 2. Score credits: +score per non-fill game score for archived Season 2 weeks.
INSERT INTO pin_ledger (player_id, season_id, amount, type, description)
SELECT ts.player_id,
       w.season_id,
       s.score,
       'score_credit',
       'Week ' || w.week_number || ' Game ' || g.game_number || ': ' || s.score || ' pins'
FROM scores s
JOIN team_slots ts ON ts.id = s.team_slot_id
JOIN teams t ON t.id = ts.team_id
JOIN weeks w ON w.id = t.week_id
JOIN seasons se ON se.id = w.season_id
JOIN games g ON g.id = s.game_id
WHERE se.number = 2
  AND w.is_archived = true
  AND ts.player_id IS NOT NULL
  AND s.score IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pin_ledger pl
    WHERE pl.player_id = ts.player_id
      AND pl.season_id = w.season_id
      AND pl.type = 'score_credit'
      AND pl.description = 'Week ' || w.week_number || ' Game ' || g.game_number || ': ' || s.score || ' pins'
  );
