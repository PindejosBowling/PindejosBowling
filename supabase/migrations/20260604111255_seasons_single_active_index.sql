-- Enforce at most one active season at a time. All qualifying rows have
-- is_active = true, so a partial unique index on is_active (WHERE is_active)
-- rejects a second active season. Ending a season (is_active = false) or a
-- season still in registration is unaffected.
CREATE UNIQUE INDEX seasons_single_active ON public.seasons (is_active) WHERE is_active;
