-- players.name: DEFAULT → GENERATED ALWAYS … STORED (TODO_DB_SECURITY §4).
--
-- The old DEFAULT computed the display name only at INSERT — editing
-- first/last name left players.name stale unless the app remembered to
-- rewrite it (it didn't: the admin edit screen writes only first/last —
-- live stale-data bug). A generated column recomputes on every write.
--
-- Pre-checked: nothing writes players.name (app or DB function); the only
-- DB references are reads in the market-sync title builders; no index,
-- policy, or view depends on it. Postgres can't convert DEFAULT → GENERATED
-- in place, so recreate. After this, name is read-only at the type level too
-- (absent from Insert/Update in regenerated database.types.ts).

ALTER TABLE public.players DROP COLUMN name;
ALTER TABLE public.players ADD COLUMN name text GENERATED ALWAYS AS (
  CASE WHEN last_name = '' THEN first_name
       ELSE first_name || ' ' || last_name END
) STORED;
