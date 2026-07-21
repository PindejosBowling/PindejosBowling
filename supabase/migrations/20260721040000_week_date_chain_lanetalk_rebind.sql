-- Week-date chaining + tonight's LaneTalk rebind fix.
--
-- Incident (2026-07-20, season 3 week 2 bowl night): season 3's start_date
-- (2026-07-06) is one week ahead of when the league actually started bowling
-- (2026-07-13) — the schedule slipped and weeks 1–2 got correct bowled_at
-- values manually. When advance_week opened week 3, weeks_derive_bowled_at
-- derived its date from the stale formula start_date + (week_number-1)*7 =
-- 2026-07-20, COLLIDING with week 2's real date. The lanetalk-import edge
-- function resolves the week by bowled_at and, on the tie, picked the higher
-- week_number — binding tonight's imports to the empty week 3, where zero
-- roster candidates meant every game was written unmatched/recreational.
--
-- Fix, in three parts:
--   1. weeks_derive_bowled_at now chains off the PREVIOUS week's actual
--      bowled_at (+7 days) when that week exists, falling back to the
--      start_date formula only when there is no prior week (week 1 / bulk
--      season setup). Advancing is now self-correcting: week N+1 always lands
--      seven days after whatever date week N really carries, so bowl night's
--      date uniquely resolves to the just-bowled week.
--   2. Data repair: week 3 → its real Monday (2026-07-27); season 3
--      start_date → 2026-07-13 so the fallback formula matches reality
--      (start_date is otherwise only displayed on registration screens).
--   3. Delete tonight's two mis-bound import rows (recreational, player_id
--      NULL — no bets/props reference them) so the links can be re-imported
--      cleanly past the (source_url, game_number) unique key.

-- 1 ─ Chain the derived date off the previous week.
CREATE OR REPLACE FUNCTION public.weeks_derive_bowled_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_prev_bowled   date;
  v_start_date    date;
  v_bowling_night text;
BEGIN
  IF NEW.bowled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Chain: the previous week's actual date + 7. Survives schedule slips the
  -- season-start formula below cannot see (the 2026-07-20 collision incident).
  SELECT bowled_at INTO v_prev_bowled
    FROM public.weeks
   WHERE season_id = NEW.season_id AND week_number = NEW.week_number - 1;
  IF v_prev_bowled IS NOT NULL THEN
    NEW.bowled_at := v_prev_bowled + 7;
    RETURN NEW;
  END IF;

  SELECT start_date, bowling_night
    INTO v_start_date, v_bowling_night
    FROM public.seasons
   WHERE id = NEW.season_id;

  -- No season row yet (shouldn't happen — season_id is NOT NULL FK) → leave NULL.
  IF v_start_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- No prior week to chain from: scheduled bowl day = the season's start
  -- Monday plus one week per week_number.
  NEW.bowled_at := v_start_date + ((NEW.week_number - 1) * 7);

  -- The formula (and parseLanetalk.toMonday) assume a Monday cadence. Flag any
  -- season whose start weekday disagrees with its declared bowling_night as a
  -- latent mismatch the LaneTalk parser would need generalized for — a warning,
  -- not a block, so week creation always succeeds.
  IF v_bowling_night IS NOT NULL
     AND lower(trim(to_char(v_start_date, 'FMDay'))) IS DISTINCT FROM lower(trim(v_bowling_night)) THEN
    RAISE WARNING 'Season start_date weekday (%) != bowling_night (%) — bowled_at derivation and LaneTalk toMonday assume Monday; the import parser needs generalizing for this season',
      to_char(v_start_date, 'FMDay'), v_bowling_night;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2 ─ Data repair: uncollide week 3, realign season 3's start_date.
UPDATE public.weeks
   SET bowled_at = DATE '2026-07-27'
 WHERE id = '56bcdd4c-5752-41e4-8a22-372f0fbfe778'
   AND bowled_at = DATE '2026-07-20';

UPDATE public.seasons
   SET start_date = DATE '2026-07-13'
 WHERE id = 'ecd29892-931a-4ba9-808d-ac2a840166d1'
   AND start_date = DATE '2026-07-06';

-- 3 ─ Remove the two mis-bound import rows so the links re-import cleanly.
DELETE FROM public.lanetalk_game_imports
 WHERE id IN ('239fe380-d076-45aa-91f6-4aac017d6f67',
              'a09a4a39-1b60-4fa6-b103-5fc865ba68d4')
   AND classification = 'recreational'
   AND player_id IS NULL;
