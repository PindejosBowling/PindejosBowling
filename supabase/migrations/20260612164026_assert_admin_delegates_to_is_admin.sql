-- assert_admin() delegates to is_admin() (HYGIENE §1 follow-up).
--
-- Both helpers carried their own copy of the JWT role expression — two places
-- defining what "admin" means. is_admin() is now the single definition;
-- assert_admin() is just the raising adapter for RPC guard clauses.
--
-- IS DISTINCT FROM true preserves the fail-closed behavior: a missing role
-- claim makes is_admin() return NULL, which still raises. Grant profiles are
-- unchanged (is_admin: authenticated, for RLS; assert_admin: owner-only).

CREATE OR REPLACE FUNCTION public.assert_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
END;
$$;
