-- Add first_name and last_name columns with temporary defaults to allow backfill
ALTER TABLE public.players ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.players ADD COLUMN last_name  TEXT NOT NULL DEFAULT '';

-- Backfill: first word → first_name, remainder → last_name
UPDATE public.players
SET
  first_name = TRIM((regexp_match(name, '^(\S+)'))[1]),
  last_name  = TRIM(regexp_replace(name, '^\S+\s*', ''));

-- Remove temporary defaults
ALTER TABLE public.players ALTER COLUMN first_name DROP DEFAULT;
ALTER TABLE public.players ALTER COLUMN last_name  DROP DEFAULT;

-- Drop the old plain name column
ALTER TABLE public.players DROP COLUMN name;

-- Re-add name as a generated stored column so all existing reads continue to work
ALTER TABLE public.players ADD COLUMN name TEXT GENERATED ALWAYS AS (
  CASE WHEN last_name = '' THEN first_name
       ELSE first_name || ' ' || last_name
  END
) STORED;
