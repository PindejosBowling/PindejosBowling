-- Custom bet lines ("Specials"): admin-authored templates that bundle existing
-- bet_selections under a custom title/description. Taking one places an
-- ORDINARY single/parlay via the unchanged place_house_bet — no settlement
-- machinery lives here; the bet rides the existing rails (settlement, refunds,
-- archive, unarchive) untouched.
--
-- Legs are ABSTRACT specs (not selection FKs) because teams/markets are
-- regenerated weekly; the app resolves specs against each week's markets:
--   [{ "kind": "over_under" | "moneyline",
--      "player_id":   "<uuid>",   -- O/U subject, or moneyline team anchor
--      "game_number": 1,
--      "pick":        "over" | "under" | "win" }]
-- A moneyline leg means "the team containing player_id wins game_number".
--
-- week_ids: NULL = permanent (offered every week while is_active); otherwise
-- the line is offered only in the listed weeks. No FK integrity on the array
-- by design — a deleted week's id simply never matches again.

CREATE TABLE public.custom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'default' CHECK (category IN ('default', 'special')),
  legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  week_ids uuid[],
  is_active boolean NOT NULL DEFAULT true,
  created_by_player_id uuid REFERENCES public.players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX custom_lines_created_by_idx ON public.custom_lines(created_by_player_id);

-- RLS: read-all, admin-only writes (same policy set as bet_markets).
ALTER TABLE public.custom_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read" ON public.custom_lines FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can read" ON public.custom_lines FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "admin can insert" ON public.custom_lines FOR INSERT TO authenticated
  WITH CHECK ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.custom_lines FOR UPDATE TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.custom_lines FOR DELETE TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');