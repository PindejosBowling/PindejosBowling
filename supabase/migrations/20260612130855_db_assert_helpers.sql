-- Shared assertion/lookup helpers (TODO_DB_FUNCTION_HYGIENE §1).
--
-- Four snippets are copy-pasted across the function layer (~20 admin checks,
-- ~9 player lookups, ~5 season lookups, ~8 balance sums). Define each once;
-- adoption happens in the upcoming CREATE OR REPLACE batches (loans → pvp →
-- bets/bounty → admin tools), and the RLS policy dedup consumes is_admin().
--
-- This migration only ADDS functions — no behavior changes yet.

-- Boolean form, for RLS policies (the ~80-policy dedup wraps it as
-- (SELECT public.is_admin())) and for IF-style checks.
CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
$$;

-- Raising form, for RPC guard clauses. Deliberate hardening over the inline
-- snippet it replaces: the old `IF (claim) <> 'admin' THEN RAISE` silently
-- PASSES when the role claim is absent (NULL <> 'admin' is NULL → no raise).
-- The JWT hook always stamps a role today, so behavior is unchanged in
-- practice, but the helper fails closed if a claimless token ever appears.
CREATE FUNCTION public.assert_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
END;
$$;

-- The player linked to the calling auth user; raises like every inline copy.
CREATE FUNCTION public.current_player_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.players WHERE user_id = (SELECT auth.uid());
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;
  RETURN v_id;
END;
$$;

-- The current season: is_active AND NOT registration_open (never "highest
-- number" — see AGENTS.md hard rule 5). Raises like every inline copy.
CREATE FUNCTION public.current_season_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;
  RETURN v_id;
END;
$$;

-- A player's pin balance for a season — the hottest snippet in the schema.
CREATE FUNCTION public.pin_balance(p_player_id uuid, p_season_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT COALESCE(SUM(amount), 0)::integer
  FROM public.pin_ledger
  WHERE player_id = p_player_id AND season_id = p_season_id;
$$;

-- Grants: the SECURITY DEFINER RPCs that will adopt these run as owner
-- (postgres) and need no grants. Only is_admin() is callable by
-- authenticated — RLS policies evaluate it as the calling role.
REVOKE EXECUTE ON FUNCTION
  public.is_admin(),
  public.assert_admin(),
  public.current_player_id(),
  public.current_season_id(),
  public.pin_balance(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;