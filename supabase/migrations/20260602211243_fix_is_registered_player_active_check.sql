-- Allow inactive players to sign in — only check that the phone belongs to a player.
CREATE OR REPLACE FUNCTION public.is_registered_player(phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM players
    WHERE players.phone = is_registered_player.phone
  );
$$;
