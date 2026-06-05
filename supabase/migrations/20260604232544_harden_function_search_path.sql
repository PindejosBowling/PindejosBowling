-- Resolve the `function_search_path_mutable` security-advisor warnings.
--
-- A function without a pinned search_path resolves unqualified object names
-- against the *caller's* session search_path. A user who can create objects in
-- an earlier schema on that path could shadow a table/function the body relies
-- on — most dangerous for SECURITY DEFINER functions, which run with elevated
-- privileges. The fix is to pin search_path on each flagged function.
--
-- The two betting RPCs added alongside this work (place_bet,
-- sync_bet_lines_for_week) already set `search_path = public`; these are the
-- remaining pre-existing functions the advisor flags.

-- These three only reference pg_catalog objects (implicitly available) or
-- already public-qualified objects, so an empty search_path is safe with no
-- body change:
ALTER FUNCTION public.set_updated_at()         SET search_path = '';
ALTER FUNCTION public.prevent_self_under_bet() SET search_path = '';
ALTER FUNCTION public.enforce_audit_columns()  SET search_path = '';

-- is_registered_player is SECURITY DEFINER and references `players` unqualified,
-- which would not resolve under an empty search_path. Qualify the table and pin
-- the path (the recommended hardening for SECURITY DEFINER functions).
CREATE OR REPLACE FUNCTION public.is_registered_player(phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players
    WHERE players.phone = is_registered_player.phone
  );
$$;
