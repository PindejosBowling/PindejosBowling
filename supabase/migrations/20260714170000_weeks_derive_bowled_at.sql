-- PR1 — bowled_at semantics: make bowled_at the *scheduled bowl-Monday*, set at
-- week creation, never the archive date.
--
-- Why: the LaneTalk import binds a session to a week by weeks.bowled_at =
-- session.date, where session.date is Monday-normalized (parseLanetalk.toMonday).
-- But archive_week stamps bowled_at = current_date, so the next-day import only
-- resolves when the admin happened to archive on that Monday; otherwise it fails
-- with week_not_found. Deriving bowled_at from the season schedule at creation
-- (and leaving it immutable through archive/unarchive — those writes are removed
-- in a later PR) makes the scheduled Monday reliably present before the bowl
-- night, so the import always resolves.
--
-- This migration is the low-risk first chunk: it changes only how bowled_at is
-- POPULATED (a BEFORE INSERT trigger + a re-assert of live open weeks). It does
-- NOT yet touch archive_week / unarchive_week, so the current archive-time
-- bowled_at=current_date overwrite still happens — that removal lands with the
-- advance/settle split. Reproduces the existing hand-authored backfill
-- (20260602143542_backfill_bowled_at) as a rule: season.start_date is a Monday
-- and weeks map to consecutive Mondays.

-- ---------------------------------------------------------------------------
-- Derivation trigger — covers BOTH creation paths (SeasonRegistrationScreen's
-- week-1 insert and the N+1 insert inside archive/advance) with no app change.
-- Only fills a NULL bowled_at, so an explicit value (e.g. a custom playoff date)
-- is never clobbered.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.weeks_derive_bowled_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_start_date    date;
  v_bowling_night text;
BEGIN
  IF NEW.bowled_at IS NOT NULL THEN
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

  -- Scheduled bowl day = the season's start Monday plus one week per week_number.
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
$function$
;

DROP TRIGGER IF EXISTS weeks_derive_bowled_at ON public.weeks;
CREATE TRIGGER weeks_derive_bowled_at
  BEFORE INSERT ON public.weeks
  FOR EACH ROW
  EXECUTE FUNCTION public.weeks_derive_bowled_at();

-- ---------------------------------------------------------------------------
-- Backfill: re-assert bowled_at from the formula for any live (non-archived,
-- non-playoff) week so live data is consistent before code starts trusting it.
-- Archived weeks keep whatever bowled_at they already have (their real bowl
-- date / prior backfill); playoff weeks may carry a custom schedule and are
-- left alone. Only rows that would actually change are updated.
--
-- NOTE: the settled_at backfill described in the plan's §6b rides with the
-- weeks.settled_at column addition in PR2, not here (the column does not exist
-- yet).
-- ---------------------------------------------------------------------------
UPDATE public.weeks w
   SET bowled_at = s.start_date + ((w.week_number - 1) * 7)
  FROM public.seasons s
 WHERE s.id = w.season_id
   AND w.is_archived = false
   AND w.is_playoff = false
   AND w.bowled_at IS DISTINCT FROM (s.start_date + ((w.week_number - 1) * 7));
