-- auth.users stores phone without the leading '+' (e.g. '17703552520')
-- players.phone stores E.164 with '+' (e.g. '+17703552520').
-- The original trigger compared them directly, so it never matched.
CREATE OR REPLACE FUNCTION public.link_auth_user_to_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    UPDATE players
    SET user_id = NEW.id
    WHERE phone = '+' || NEW.phone
      AND user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill the two auth users that already exist.
UPDATE players p
SET user_id = u.id
FROM auth.users u
WHERE p.phone = '+' || u.phone
  AND p.user_id IS NULL;
