-- Expose the weeks table over Supabase Realtime (postgres_changes) so every
-- device learns the moment the week clock ticks (archive creates week N+1,
-- unarchive deletes it / unlocks week N). Clients subscribe at app root and
-- refetch the current week on any weeks event; RLS governs row visibility.
alter publication supabase_realtime add table public.weeks;
