-- Security hardening: drop anon write access, restrict mutations to admin role,
-- fix duplicate policies, fix auth_rls_initplan on rsvp, revoke unnecessary
-- EXECUTE on trigger function.

-- ============================================================
-- board_posts
-- Drop blanket anon/authenticated write policies; replace with:
--   - authenticated INSERT (any signed-in player can post)
--   - authenticated DELETE own posts + admin can delete any
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.board_posts;
DROP POLICY IF EXISTS "anon can delete"          ON public.board_posts;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.board_posts;
DROP POLICY IF EXISTS "authenticated can delete"  ON public.board_posts;

CREATE POLICY "authenticated can insert" ON public.board_posts
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can delete own" ON public.board_posts
  FOR DELETE TO authenticated
  USING (
    player_id = (SELECT id FROM public.players WHERE user_id = (SELECT auth.uid()))
    OR ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ============================================================
-- game_schedule — admin only writes
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.game_schedule;
DROP POLICY IF EXISTS "anon can delete"          ON public.game_schedule;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.game_schedule;
DROP POLICY IF EXISTS "authenticated can delete"  ON public.game_schedule;

CREATE POLICY "admin can insert" ON public.game_schedule
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.game_schedule
  FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- players — admin only writes; drop duplicate SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"           ON public.players;
DROP POLICY IF EXISTS "anon can update"           ON public.players;
DROP POLICY IF EXISTS "authenticated can insert"   ON public.players;
DROP POLICY IF EXISTS "authenticated can update"   ON public.players;
DROP POLICY IF EXISTS "authenticated_read_players" ON public.players;

CREATE POLICY "admin can insert" ON public.players
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.players
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- scores — admin only writes
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.scores;
DROP POLICY IF EXISTS "anon can update"          ON public.scores;
DROP POLICY IF EXISTS "anon can delete"          ON public.scores;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.scores;
DROP POLICY IF EXISTS "authenticated can update"  ON public.scores;
DROP POLICY IF EXISTS "authenticated can delete"  ON public.scores;

CREATE POLICY "admin can insert" ON public.scores
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.scores
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.scores
  FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- season_champions — admin only writes
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.season_champions;
DROP POLICY IF EXISTS "anon can delete"          ON public.season_champions;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.season_champions;
DROP POLICY IF EXISTS "authenticated can delete"  ON public.season_champions;

CREATE POLICY "admin can insert" ON public.season_champions
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.season_champions
  FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- seasons — admin only writes
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.seasons;
DROP POLICY IF EXISTS "anon can update"          ON public.seasons;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.seasons;
DROP POLICY IF EXISTS "authenticated can update"  ON public.seasons;

CREATE POLICY "admin can insert" ON public.seasons
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.seasons
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- team_slots — admin only writes
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.team_slots;
DROP POLICY IF EXISTS "anon can update"          ON public.team_slots;
DROP POLICY IF EXISTS "anon can delete"          ON public.team_slots;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.team_slots;
DROP POLICY IF EXISTS "authenticated can update"  ON public.team_slots;
DROP POLICY IF EXISTS "authenticated can delete"  ON public.team_slots;

CREATE POLICY "admin can insert" ON public.team_slots
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.team_slots
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.team_slots
  FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- weeks — admin only writes
-- ============================================================
DROP POLICY IF EXISTS "anon can insert"          ON public.weeks;
DROP POLICY IF EXISTS "anon can update"          ON public.weeks;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.weeks;
DROP POLICY IF EXISTS "authenticated can update"  ON public.weeks;

CREATE POLICY "admin can insert" ON public.weeks
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.weeks
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- rsvp — fix auth_rls_initplan: wrap auth.jwt() in SELECT
-- ============================================================
DROP POLICY IF EXISTS "admin can manage rsvp" ON public.rsvp;

CREATE POLICY "admin can manage rsvp" ON public.rsvp
  FOR ALL TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================
-- link_auth_user_to_player — revoke EXECUTE from public roles
-- Trigger function; must not be callable as an RPC.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.link_auth_user_to_player() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_auth_user_to_player() FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_auth_user_to_player() FROM authenticated;
