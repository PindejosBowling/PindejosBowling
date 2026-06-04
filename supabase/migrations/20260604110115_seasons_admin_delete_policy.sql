-- Allow admins to delete a season. seasons already has admin insert/update
-- policies but no delete; this enables removing an open (registration) season.
-- registrations cascade on delete; weeks/season_champions do not, so a season
-- with weeks or champions cannot be deleted (an open season has neither yet).
CREATE POLICY "admin can delete" ON public.seasons
  FOR DELETE TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'));
