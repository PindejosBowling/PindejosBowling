-- Hook called by Supabase Auth when issuing/refreshing JWTs.
-- Embeds the user's role from user_roles into app_metadata so downstream
-- code can read it from the token without an extra DB round-trip.
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
  FROM user_roles
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

-- Auth service must be able to invoke this hook.
GRANT EXECUTE ON FUNCTION public.custom_access_token(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token(jsonb) FROM PUBLIC, anon, authenticated;
