-- Replace open rsvp write policies with role-aware ownership policies.
-- Players may only manage their own RSVP; admins can manage all.

-- Drop old open policies
DROP POLICY IF EXISTS "anon can insert"          ON rsvp;
DROP POLICY IF EXISTS "anon can update"          ON rsvp;
DROP POLICY IF EXISTS "anon can delete"          ON rsvp;
DROP POLICY IF EXISTS "authenticated can insert" ON rsvp;
DROP POLICY IF EXISTS "authenticated can update" ON rsvp;
DROP POLICY IF EXISTS "authenticated can delete" ON rsvp;

-- Admins: full write access to all rows
CREATE POLICY "admin can manage rsvp" ON rsvp
  FOR ALL TO authenticated
  USING  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Players: own RSVP only (player_id must match their players.id)
CREATE POLICY "player can manage own rsvp" ON rsvp
  FOR ALL TO authenticated
  USING  (player_id = (SELECT id FROM players WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (player_id = (SELECT id FROM players WHERE user_id = (SELECT auth.uid())));
