-- Link each player record to their Supabase Auth user.
-- user_id is nullable so existing rows aren't broken; it gets populated
-- automatically by the trigger below the first time a player logs in.
ALTER TABLE players
  ADD COLUMN user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- After an auth user is inserted or their phone is updated, find the matching
-- player by phone and stamp user_id. The check for user_id IS NULL prevents
-- overwriting an existing link if a player somehow re-registers.
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

CREATE OR REPLACE TRIGGER on_auth_user_linked
  AFTER INSERT OR UPDATE OF phone ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_auth_user_to_player();

-- Backfill any auth users that already exist.
UPDATE players p
SET user_id = u.id
FROM auth.users u
WHERE p.phone = '+' || u.phone
  AND p.user_id IS NULL;
