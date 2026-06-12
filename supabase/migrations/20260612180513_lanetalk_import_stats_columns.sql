-- LaneTalk per-import stats become columns (TODO_DB_PERFORMANCE §1, Migration A).
--
-- lanetalk_seed_lines re-parsed the frames JSONB of a player's ENTIRE official
-- import history on every call — and it's called per eligible player by
-- sync_lanetalk_prop_markets_for_week, which fires from four statement-level
-- resync triggers. Compute each import's stats ONCE at insert, store columns.
--
-- Plain columns + trigger (not GENERATED): lanetalk_game_stats() is a
-- set-returning function, which generated-column expressions can't call.
-- lanetalk_game_stats(jsonb) stays the single stat definition — SQL remains
-- authoritative for money (context/lanetalk-stat-bets.md); it now runs once
-- per import instead of per resync.

ALTER TABLE public.lanetalk_game_imports
  ADD COLUMN frames integer,
  ADD COLUMN strikes integer,
  ADD COLUMN spares integer,
  ADD COLUMN clean_pct numeric,
  ADD COLUMN first_ball_avg numeric;

-- Backfill from the single stat definition (self-join: UPDATE's FROM items
-- cannot laterally reference the update target).
UPDATE public.lanetalk_game_imports i SET
  frames         = jsonb_array_length(COALESCE(i.payload -> 'frames', '[]'::jsonb)),
  strikes        = st.strikes,
  spares         = st.spares,
  clean_pct      = st.clean_pct,
  first_ball_avg = st.first_ball_avg
FROM public.lanetalk_game_imports i2
CROSS JOIN LATERAL public.lanetalk_game_stats(i2.payload) st
WHERE i2.id = i.id;

-- Recompute on every payload write. The lanetalk-import Edge Function needs
-- no change — the trigger covers its inserts.
CREATE FUNCTION public.trg_lanetalk_import_stats() RETURNS trigger
LANGUAGE plpgsql SET search_path TO ''
AS $$
DECLARE st record;
BEGIN
  SELECT * INTO st FROM public.lanetalk_game_stats(NEW.payload);
  NEW.frames         := jsonb_array_length(COALESCE(NEW.payload -> 'frames', '[]'::jsonb));
  NEW.strikes        := st.strikes;
  NEW.spares         := st.spares;
  NEW.clean_pct      := st.clean_pct;
  NEW.first_ball_avg := st.first_ball_avg;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lanetalk_import_stats
  BEFORE INSERT OR UPDATE OF payload ON public.lanetalk_game_imports
  FOR EACH ROW EXECUTE FUNCTION public.trg_lanetalk_import_stats();
