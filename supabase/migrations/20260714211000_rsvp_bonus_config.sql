-- RSVP self-submit bonus — configuration table.
-- ===========================================================================
-- Admin-editable config for the "thank you from the House" RSVP bonus: whether
-- it is on, how much it pays, and the weekly deadline after which self-submits
-- stop earning it. Follows the loan_products convention (feature-owned config
-- rows, season_id NULL = global default) — there is no generic settings table
-- in this codebase.
--
-- The deadline is a time-of-day (+ timezone); the concrete per-week cutoff is
-- computed in submit_own_rsvp as (weeks.bowled_at + deadline_time) AT TIME ZONE
-- timezone. Resolution order everywhere: current-season row if present, else
-- the global (season_id IS NULL) row.
--
-- Audit columns: created_at + updated_at only; the enforce_audit_columns event
-- trigger auto-attaches set_updated_at — do NOT declare it here.

CREATE TABLE public.rsvp_bonus_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid REFERENCES public.seasons(id) ON DELETE CASCADE,  -- NULL = global default
  is_enabled    boolean NOT NULL DEFAULT true,
  bonus_amount  integer NOT NULL DEFAULT 50 CHECK (bonus_amount > 0),
  deadline_time time NOT NULL DEFAULT '18:00',
  timezone      text NOT NULL DEFAULT 'America/New_York',
  updated_by    uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- At most one global row and at most one row per season.
CREATE UNIQUE INDEX rsvp_bonus_config_global_uniq
  ON public.rsvp_bonus_config ((true)) WHERE season_id IS NULL;
CREATE UNIQUE INDEX rsvp_bonus_config_season_uniq
  ON public.rsvp_bonus_config (season_id) WHERE season_id IS NOT NULL;

-- Seed the global default row (6:00pm ET, 50 pins, enabled).
INSERT INTO public.rsvp_bonus_config (season_id) VALUES (NULL);

-- ---------------------------------------------------------------------------
-- RLS — reads open (admin editor + player-facing deadline banner); direct
-- writes admin-only. The award path (submit_own_rsvp) reads this table as a
-- SECURITY DEFINER function and needs no policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rsvp_bonus_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read" ON public.rsvp_bonus_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin can manage" ON public.rsvp_bonus_config
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
