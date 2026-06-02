-- Add role directly to players, replacing the standalone user_roles table.
ALTER TABLE players
  ADD COLUMN role text NOT NULL DEFAULT 'player'
  CHECK (role IN ('player', 'admin'));

-- Backfill any existing admin assignments before dropping user_roles.
UPDATE players p
SET role = 'admin'
FROM user_roles ur
WHERE ur.user_id = p.user_id
  AND ur.role = 'admin';

-- Update the JWT hook to read role from players instead of user_roles.
CREATE OR REPLACE FUNCTION public.custom_access_token(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims     jsonb;
  user_role  text;
BEGIN
  SELECT role INTO user_role
  FROM players
  WHERE user_id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::jsonb)
      || jsonb_build_object('role', COALESCE(user_role, 'player'))
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

DROP TABLE user_roles;
