-- Make updated_at actually update on the betting tables, and stop this class of
-- bug from recurring on future tables.
--
-- Every other table has a `set_updated_at` BEFORE UPDATE trigger (added in
-- 20260603174412). bet_lines / placed_bets / pin_ledger were created afterward
-- and never got one, so their updated_at column froze at the insert value. The
-- existing `enforce_audit_columns` event trigger only *verifies* that created_at
-- and updated_at exist on new tables — it does not attach the trigger, which is
-- why the gap was silent.
--
-- Fix both: (1) backfill the trigger on the three betting tables, and (2) upgrade
-- the event trigger so any future CREATE TABLE in public with an updated_at
-- column gets the set_updated_at trigger automatically.

-- 1. Backfill the three betting tables.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bet_lines   FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.placed_bets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pin_ledger  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Upgrade the audit-column event trigger to also auto-attach set_updated_at.
--    Still enforces that created_at + updated_at exist; now additionally creates
--    the BEFORE UPDATE trigger when updated_at is present and the trigger isn't
--    already there (idempotent). Running CREATE TRIGGER here does not re-fire the
--    CREATE TABLE event trigger, so there is no recursion.
CREATE OR REPLACE FUNCTION public.enforce_audit_columns()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj record;
  tbl_name text;
  has_updated_at boolean;
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

    has_updated_at := EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = obj.schema_name
        AND table_name  = tbl_name
        AND column_name = 'updated_at'
    );

    IF NOT has_updated_at THEN
      RAISE EXCEPTION 'Table % must include an updated_at column', obj.object_identity;
    END IF;

    -- Auto-attach the shared updated_at trigger if it isn't already present.
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = obj.objid
        AND tgname  = 'set_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        tbl_name
      );
    END IF;
  END LOOP;
END;
$$;
