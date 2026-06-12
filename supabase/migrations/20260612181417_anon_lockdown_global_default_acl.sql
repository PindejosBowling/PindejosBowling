-- Anon lockdown, third layer: GLOBAL default privileges (posture-assertion catch #2).
--
-- The assertion flagged trg_lanetalk_import_stats() as anon-executable the
-- moment it was created. Root cause: per-schema ALTER DEFAULT PRIVILEGES
-- entries only ADD to the global defaults — they cannot remove the built-in
-- "EXECUTE to PUBLIC" grant that every new function gets (PostgreSQL docs:
-- "There is no way to change the per-schema entries to remove rights granted
-- by global defaults"). Our IN SCHEMA revoke rows were inert against it.
--
-- Fix: revoke at the GLOBAL level (no IN SCHEMA), which CAN override the
-- built-in default. Applies to functions created by postgres (= every
-- migration) in any schema; other roles' objects are platform-managed and
-- covered by the assertion.

REVOKE EXECUTE ON FUNCTION public.trg_lanetalk_import_stats() FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM anon;
