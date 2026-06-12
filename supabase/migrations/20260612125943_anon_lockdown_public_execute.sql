-- Anon lockdown follow-up: close the PUBLIC-inheritance path.
--
-- The posture assertion (anon-posture-assert.sql) caught 14 functions still
-- executable by anon after anon_lockdown: they never had a direct anon grant —
-- they inherit EXECUTE from PUBLIC (13 trigger/guard functions with the
-- Postgres default ACL, plus unarchive_week's explicit "=X" entry), so
-- `REVOKE … FROM anon` was a no-op for them. Revoke from PUBLIC instead.
--
-- Safe because nothing relies on PUBLIC inheritance: every RPC the app calls
-- already carries explicit authenticated + service_role grants (verified
-- against live proacl — unarchive_week matches archive_week's shape), and
-- trigger functions don't need EXECUTE at fire time (permission is checked at
-- CREATE TRIGGER, which runs as postgres).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;

-- Same fix for the future-functions default ACL: it still contained "=X"
-- (PUBLIC), which anon inherits. After this, functions created by postgres
-- (i.e. every migration) default to postgres + authenticated + service_role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Keep the single allowlisted anon entry point (unaffected by the PUBLIC
-- revoke — it holds a direct anon grant — but restated for clarity).
GRANT EXECUTE ON FUNCTION public.is_registered_player(text) TO anon;

-- Known residual, accepted: supabase_admin's default ACL for public-schema
-- objects still names anon, and postgres cannot alter another role's default
-- privileges. Objects created by supabase_admin in public are platform-managed
-- (extensions live in their own schema); if one ever appears, the posture
-- assertion in refresh-schema-snapshot.sh fails the push that introduced it.
