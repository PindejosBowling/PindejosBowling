-- Companion to …193032_single_mode_unarchive: the single-mode unarchive_week
-- records reversed_mode = 'unarchive', but the check constraint still only
-- allowed the old soft|hard values, so every unarchive failed. Keep the legacy
-- values valid — historical runs reference them.
ALTER TABLE public.week_archive_runs
  DROP CONSTRAINT week_archive_runs_reversed_mode_check;
ALTER TABLE public.week_archive_runs
  ADD CONSTRAINT week_archive_runs_reversed_mode_check
  CHECK (reversed_mode = ANY (ARRAY['soft'::text, 'hard'::text, 'unarchive'::text]));
