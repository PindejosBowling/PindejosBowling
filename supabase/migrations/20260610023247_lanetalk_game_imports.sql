-- Lanetalk game imports: one row per parsed game from a Lanetalk "shared session"
-- link. The full per-game payload (frames, throws, pin diagrams + the match
-- annotations) lives in `payload` jsonb; the scalar columns are denormalized
-- lookup/index keys. Rows are written exclusively by the `lanetalk-import` Edge
-- Function (service role), which fetches + parses the HTML, fuzzy-matches the
-- bowler to a slotted player for the week, and classifies each game Official
-- (its total matches a recorded official score for that team_slot) or
-- Recreational. See the function under supabase/functions/lanetalk-import.

CREATE TABLE public.lanetalk_game_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url     text NOT NULL,
  game_number    integer NOT NULL,
  classification text NOT NULL CHECK (classification IN ('official', 'recreational')),
  player_id      uuid REFERENCES public.players(id) ON DELETE SET NULL,
  team_slot_id   uuid REFERENCES public.team_slots(id) ON DELETE SET NULL,
  week_id        uuid REFERENCES public.weeks(id) ON DELETE SET NULL,
  score          integer,
  played_at      timestamptz,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lanetalk_game_imports_url_game_key UNIQUE (source_url, game_number)
);

CREATE INDEX lanetalk_game_imports_week_id_idx   ON public.lanetalk_game_imports (week_id);
CREATE INDEX lanetalk_game_imports_player_id_idx ON public.lanetalk_game_imports (player_id);

-- RLS: this table is written only by the Edge Function via the service-role key
-- (which bypasses RLS). The app side only reads, and only admins may read.
ALTER TABLE public.lanetalk_game_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can read all" ON public.lanetalk_game_imports
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
