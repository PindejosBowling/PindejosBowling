-- Allow admins to correct a game's Official/Recreational designation from the
-- Lanetalk Import admin screen. Rows are still written exclusively by the
-- service-role Edge Function; this adds a client-side UPDATE path so an admin
-- can re-classify a game after the fact. Admin-only, mirroring the read policy.

CREATE POLICY "admin can update" ON public.lanetalk_game_imports
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
