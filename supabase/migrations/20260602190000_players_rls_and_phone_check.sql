-- Restrict direct reads on players to authenticated users only.
-- The login screen cannot use the table directly (user isn't authenticated yet),
-- so we expose a narrow boolean RPC instead.
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_players"
  ON players
  FOR SELECT
  TO authenticated
  USING (true);

-- Returns true if the given E.164 phone number belongs to an active player.
-- SECURITY DEFINER lets it bypass RLS so it works for the anon/unauthenticated
-- login check without exposing any PII — callers only learn a boolean.
CREATE OR REPLACE FUNCTION public.is_registered_player(phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM players
    WHERE players.phone = is_registered_player.phone
      AND players.is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_registered_player(text) TO anon;
REVOKE EXECUTE ON FUNCTION public.is_registered_player(text) FROM PUBLIC;
