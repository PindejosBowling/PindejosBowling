-- Anon posture assertion — run by refresh-schema-snapshot.sh after every push.
--
-- Contract (anon_lockdown migration, 2026-06-12): anon's ONLY capability is
-- EXECUTE on public.is_registered_player(text). Zero policies target anon,
-- zero table/sequence privileges, zero other executable functions.
--
-- Returns one row per violation; an empty result means the posture holds.

SELECT 'policy targets anon' AS violation,
       format('%I.%I — policy %I', schemaname, tablename, policyname) AS detail
FROM pg_policies
WHERE schemaname = 'public' AND 'anon' = ANY(roles)

UNION ALL

-- has_table_privilege (not role_table_grants) so PUBLIC-inherited grants are
-- caught too — anon is a member of PUBLIC.
SELECT 'table privilege held by anon',
       format('%I.%I', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege('anon', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')

UNION ALL

SELECT 'sequence privilege granted to anon',
       format('%I.%I — %s', sequence_schema, sequence_name, 'USAGE/SELECT/UPDATE')
FROM information_schema.sequences s
WHERE sequence_schema = 'public'
  AND (has_sequence_privilege('anon', format('%I.%I', sequence_schema, sequence_name), 'USAGE,SELECT,UPDATE'))

UNION ALL

SELECT 'function executable by anon (not allowlisted)',
       p.oid::regprocedure::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname <> 'is_registered_player'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
