-- Restrict board_posts INSERT so players can only post as themselves.
-- WITH CHECK (true) allowed any authenticated user to set any player_id.

DROP POLICY IF EXISTS "authenticated can insert" ON public.board_posts;

CREATE POLICY "authenticated can insert" ON public.board_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    player_id = (SELECT id FROM public.players WHERE user_id = (SELECT auth.uid()))
  );
