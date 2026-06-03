-- Replace the created_at-only trigger with one that enforces both audit columns
DROP EVENT TRIGGER IF EXISTS enforce_created_at_trigger;
DROP FUNCTION IF EXISTS public.enforce_created_at();

CREATE OR REPLACE FUNCTION public.enforce_audit_columns()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj record;
  tbl_name text;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE'
  LOOP
    IF obj.schema_name <> 'public' THEN CONTINUE; END IF;
    tbl_name := (SELECT relname FROM pg_class WHERE oid = obj.objid);

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = obj.schema_name
        AND table_name  = tbl_name
        AND column_name = 'created_at'
    ) THEN
      RAISE EXCEPTION 'Table % must include a created_at column', obj.object_identity;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = obj.schema_name
        AND table_name  = tbl_name
        AND column_name = 'updated_at'
    ) THEN
      RAISE EXCEPTION 'Table % must include an updated_at column', obj.object_identity;
    END IF;
  END LOOP;
END;
$$;

CREATE EVENT TRIGGER enforce_audit_columns_trigger
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION public.enforce_audit_columns();
