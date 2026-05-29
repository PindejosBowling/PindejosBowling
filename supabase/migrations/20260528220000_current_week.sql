-- Adds the current (upcoming) week for Season 2 so that getCurrent() always
-- finds a non-archived row. bowled_at and is_confirmed start false; the admin
-- flow will flip them when the week is locked in and scored.
INSERT INTO weeks (id, season_id, week_number, bowled_at, is_confirmed, is_archived)
VALUES ('e1f2a3b4-c5d6-7890-abcd-ef1234567890', 2, 4, NULL, FALSE, FALSE)
ON CONFLICT DO NOTHING;
