-- Frame data is league-visible, not admin-only: every authenticated player can
-- read imported LaneTalk games (same posture as `games`/`scores`). The screen
-- entry point on PlayerDetail gates purely on row existence, so non-admins were
-- locked out solely by the old admin-only SELECT policy. Writes stay admin-only.

DROP POLICY "admin can read all" ON public.lanetalk_game_imports;

CREATE POLICY "authenticated can read" ON public.lanetalk_game_imports
  FOR SELECT TO authenticated
  USING (true);
