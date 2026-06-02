UPDATE public.weeks w
SET bowled_at = v.bowled_at
FROM (VALUES
  (1, 1, '2026-03-16'::date),
  (1, 2, '2026-03-23'::date),
  (1, 3, '2026-03-30'::date),
  (1, 4, '2026-04-06'::date),
  (1, 5, '2026-04-13'::date),
  (1, 6, '2026-04-20'::date),
  (1, 7, '2026-04-27'::date),
  (1, 8, '2026-05-04'::date),
  (2, 1, '2026-05-11'::date),
  (2, 2, '2026-05-18'::date),
  (2, 3, '2026-05-25'::date),
  (2, 4, '2026-06-01'::date)
) AS v(season_number, week_number, bowled_at)
JOIN public.seasons s ON s.number = v.season_number
WHERE w.season_id = s.id
  AND w.week_number = v.week_number;
