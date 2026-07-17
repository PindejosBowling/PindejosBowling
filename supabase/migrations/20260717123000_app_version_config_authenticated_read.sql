-- app_version_config: authenticated-only reads.
-- ===========================================================================
-- The original policy granted SELECT to anon so the update gate could check
-- before sign-in — but that violates the repo's anon posture invariant (anon
-- holds ONLY EXECUTE on is_registered_player; enforced by
-- refresh-schema-snapshot.sh). Signed-in-only is effectively equivalent: every
-- screen requires a session, and the gate FAILS OPEN pre-auth (an anon fetch
-- returns no row ⇒ no block), closing again the moment the user is signed in.

DROP POLICY "anyone can read" ON public.app_version_config;

CREATE POLICY "authenticated can read" ON public.app_version_config
  FOR SELECT TO authenticated USING (true);
