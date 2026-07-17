-- App version gate — configuration table.
-- ===========================================================================
-- Backs the launch-time "update required" gate: builds whose native version is
-- below min_supported_version show a blocking update screen instead of the app.
-- The point is remote reach into installs that can no longer receive OTA
-- updates *from this point forward* — when a future native change strands old
-- binaries (a new runtime fingerprint), the gate tells those users to update
-- instead of letting them silently run stale JS (the failure mode that dropped
-- an RSVP bonus: a pre-feature build took the no-bonus write path).
--
-- Single global row (no per-season concept — this is an app-platform config,
-- not a league feature). Version strings are dotted numerics ('1.0.23');
-- comparison is client-side segment-by-segment. The gate FAILS OPEN client-side
-- (offline / fetch error ⇒ no block), so this config can never brick the app.
--
-- Audit columns: created_at + updated_at only; the enforce_audit_columns event
-- trigger auto-attaches set_updated_at — do NOT declare it here.

CREATE TABLE public.app_version_config (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_supported_version  text NOT NULL DEFAULT '1.0.23'
    CHECK (min_supported_version ~ '^[0-9]+(\.[0-9]+)*$'),
  message                text NOT NULL DEFAULT 'A new version of the app is required. Update on TestFlight to keep playing.',
  updated_by             uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Exactly one row, by construction.
CREATE UNIQUE INDEX app_version_config_singleton ON public.app_version_config ((true));

-- Seed: the current TestFlight version at introduction time.
INSERT INTO public.app_version_config DEFAULT VALUES;

-- ---------------------------------------------------------------------------
-- RLS — the gate runs at launch, BEFORE sign-in, so anon must be able to read
-- it (a minimum version string + a message is harmless). Writes admin-only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_version_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read" ON public.app_version_config
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admin can manage" ON public.app_version_config
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
