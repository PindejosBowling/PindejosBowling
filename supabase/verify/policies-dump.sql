-- Canonical RLS policy dump — everything that determines policy behavior,
-- deterministically ordered. Capture before and after a policy migration and
-- diff; used by the rls_is_admin_dedup verification (TODO_DB_SECURITY §2).
SELECT COALESCE(json_agg(p ORDER BY p.tablename, p.policyname, p.cmd), '[]'::json) AS policies
FROM (
  SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
) p;
