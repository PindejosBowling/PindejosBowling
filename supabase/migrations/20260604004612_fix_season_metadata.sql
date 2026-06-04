-- Correct season metadata that was wrong in the original seed data.
--   * The league bowls on Mondays, not Tuesdays.
--   * Season 1 ran 2026-03-16 through 2026-05-04.
--   * Season 2 starts 2026-05-11 (end_date 2026-06-29 already set).

update public.seasons set bowling_night = 'Monday';

update public.seasons
  set start_date = '2026-03-16', end_date = '2026-05-04'
  where number = 1;

update public.seasons
  set start_date = '2026-05-11'
  where number = 2;
