ALTER TABLE app_credentials    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE seasons            ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE weeks              ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE rsvp               ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE team_slots         ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE game_schedule      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE scores             ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE season_champions   ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Enforce created_at on all future public-schema tables
CREATE OR REPLACE FUNCTION public.enforce_created_at()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = obj.schema_name
        AND table_name   = (SELECT relname FROM pg_class WHERE oid = obj.objid)
        AND column_name  = 'created_at'
    ) AND obj.schema_name = 'public' THEN
      RAISE EXCEPTION 'Table % must include a created_at column', obj.object_identity;
    END IF;
  END LOOP;
END;
$$;

CREATE EVENT TRIGGER enforce_created_at_trigger
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION public.enforce_created_at();
