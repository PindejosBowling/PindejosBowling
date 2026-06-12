-- RECONSTRUCTED FILE — this migration was already applied to the remote DB
-- (supabase_migrations.schema_migrations version 20260612000000) but its .sql
-- file was never committed to this repo (pushed from an uncommitted worktree).
-- Content recovered 2026-06-12 from the live pg_policy state so local history
-- matches remote: lanetalk_game_imports SELECT opened from admin-only to all
-- authenticated users ("admin can read all" → "authenticated can read").

DROP POLICY "admin can read all" ON public.lanetalk_game_imports;

CREATE POLICY "authenticated can read" ON public.lanetalk_game_imports
  FOR SELECT TO authenticated
  USING (true);
