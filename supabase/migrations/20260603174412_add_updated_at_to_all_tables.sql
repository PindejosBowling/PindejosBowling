-- Add updated_at to tables that are missing it
ALTER TABLE app_credentials  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE seasons           ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE weeks             ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE team_slots        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE game_schedule     ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE season_champions  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE board_posts       ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE players           ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Shared trigger function that sets updated_at = now() on every update
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Attach trigger to all 10 tables (including rsvp and scores which already had the column)
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_credentials  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON seasons           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON weeks             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rsvp              FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON team_slots        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON game_schedule     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scores            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON season_champions  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON board_posts       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON players           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
