-- Activity event catalog (TODO_DB_CONSOLIDATION §5).
--
-- publish_activity_event hardcoded per-event metadata in a 16-branch CASE,
-- duplicated by the activity_feed_events.event_type CHECK — every new event
-- meant a function edit + a constraint edit. Now: one catalog row per event
-- type; the CHECK becomes an FK; adding an event = INSERT a catalog row (+
-- the app template). source_feature on the catalog is informational (the
-- publisher's own source list stays the validation, unchanged).

CREATE TABLE public.activity_event_catalog (
  event_type         text PRIMARY KEY,
  source_feature     text NOT NULL,
  template_key       text NOT NULL,
  requires_actor     boolean NOT NULL,
  allowed_fk         text NOT NULL CHECK (allowed_fk IN
    ('sportsbook_bet_id', 'loan_id', 'pvp_challenge_id', 'bounty_post_id', 'none')),
  default_visibility text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- No explicit set_updated_at trigger: the enforce_audit_columns event trigger
-- auto-attaches it to every new public table at CREATE TABLE time (an explicit
-- CREATE TRIGGER here collides with it — 42710).

ALTER TABLE public.activity_event_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read" ON public.activity_event_catalog
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin can write" ON public.activity_event_catalog
  AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin())) WITH CHECK (( SELECT public.is_admin()));

-- Seed: the 16 rows the CASE encoded, verbatim.
INSERT INTO public.activity_event_catalog
  (event_type, source_feature, template_key, requires_actor, allowed_fk, default_visibility) VALUES
  ('sportsbook_bet_placed',         'sportsbook',   'sportsbook.bet_placed',          true,  'sportsbook_bet_id', 'public'),
  ('sportsbook_parlay_placed',      'sportsbook',   'sportsbook.parlay_placed',       true,  'sportsbook_bet_id', 'public'),
  ('sportsbook_big_ticket_placed',  'sportsbook',   'sportsbook.big_ticket_placed',   true,  'sportsbook_bet_id', 'public'),
  ('sportsbook_big_win',            'sportsbook',   'sportsbook.big_win',             true,  'sportsbook_bet_id', 'public'),
  ('sportsbook_parlay_hit',         'sportsbook',   'sportsbook.parlay_hit',          true,  'sportsbook_bet_id', 'public'),
  ('sportsbook_weekly_house_result','system',       'sportsbook.weekly_house_result', false, 'none',              'public'),
  ('loan_shark_loan_taken',         'loan_shark',   'loan_shark.loan_taken',          true,  'loan_id',           'public'),
  ('loan_shark_loan_repaid',        'loan_shark',   'loan_shark.loan_repaid',         true,  'loan_id',           'public'),
  ('loan_shark_special_offer',      'loan_shark',   'loan_shark.special_offer',       false, 'none',              'public'),
  ('pvp_challenge_accepted',        'pvp',          'pvp.challenge_accepted',         true,  'pvp_challenge_id',  'public'),
  ('pvp_challenge_settled',         'pvp',          'pvp.challenge_settled',          true,  'pvp_challenge_id',  'public'),
  ('bounty_board_bounty_posted',    'bounty_board', 'bounty_board.bounty_posted',     false, 'bounty_post_id',    'public'),
  ('bounty_board_hunter_joined',    'bounty_board', 'bounty_board.hunter_joined',     true,  'bounty_post_id',    'public'),
  ('bounty_board_bounty_closed',    'bounty_board', 'bounty_board.bounty_closed',     false, 'bounty_post_id',    'public'),
  ('bounty_board_sponsor_won',      'bounty_board', 'bounty_board.sponsor_won',       false, 'bounty_post_id',    'public'),
  ('bounty_board_hunters_won',      'bounty_board', 'bounty_board.hunters_won',       false, 'bounty_post_id',    'public');

-- The CHECK is superseded by an FK into the catalog.
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_event_type_check;
ALTER TABLE public.activity_feed_events
  ADD CONSTRAINT activity_feed_events_event_type_fkey
  FOREIGN KEY (event_type) REFERENCES public.activity_event_catalog(event_type);

-- Rewrite: one catalog lookup replaces the CASE; FK exclusivity becomes a
-- single comparison. Steps 1, 4–7 unchanged. (Failure-path error text for
-- FK mismatches is consolidated into one message; success paths identical.)
CREATE OR REPLACE FUNCTION public.publish_activity_event(p_source_feature text, p_event_type text, p_season_id uuid, p_week_id uuid, p_actor_player_id uuid, p_subject_player_id uuid, p_secondary_player_id uuid, p_sportsbook_bet_id uuid, p_loan_id uuid, p_template_key text, p_public_payload jsonb, p_admin_payload jsonb, p_visibility text, p_occurred_at timestamp with time zone, p_pvp_challenge_id uuid DEFAULT NULL::uuid, p_bounty_post_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cat        public.activity_event_catalog;
  v_n_fks      integer;
  v_provided   text;
  v_visibility text;
  v_id         uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','pvp','bounty_board','system','admin') THEN
    RAISE EXCEPTION 'Unknown source_feature: %', p_source_feature;
  END IF;

  -- 2. Catalog lookup. RAISE on unknown event_type.
  SELECT * INTO v_cat FROM public.activity_event_catalog WHERE event_type = p_event_type;
  IF v_cat.event_type IS NULL THEN
    RAISE EXCEPTION 'Unknown event_type: %', p_event_type;
  END IF;

  -- 3. Source-FK ↔ feature consistency: exactly the catalog's allowed FK is
  --    set (all others NULL); 'none' means no FK at all.
  v_n_fks := (p_sportsbook_bet_id IS NOT NULL)::int + (p_loan_id IS NOT NULL)::int
           + (p_pvp_challenge_id IS NOT NULL)::int + (p_bounty_post_id IS NOT NULL)::int;
  v_provided := CASE
    WHEN p_sportsbook_bet_id IS NOT NULL THEN 'sportsbook_bet_id'
    WHEN p_loan_id           IS NOT NULL THEN 'loan_id'
    WHEN p_pvp_challenge_id  IS NOT NULL THEN 'pvp_challenge_id'
    WHEN p_bounty_post_id    IS NOT NULL THEN 'bounty_post_id'
    ELSE 'none' END;
  IF v_n_fks > 1 OR v_provided <> v_cat.allowed_fk THEN
    RAISE EXCEPTION 'Event % requires source FK % only (got %, % set)',
      p_event_type, v_cat.allowed_fk, v_provided, v_n_fks;
  END IF;

  -- 4. Actor requirement.
  IF v_cat.requires_actor AND p_actor_player_id IS NULL THEN
    RAISE EXCEPTION 'Event % requires an actor_player_id', p_event_type;
  END IF;

  -- 5. template_key must match the catalog (keeps copy controlled).
  IF p_template_key IS DISTINCT FROM v_cat.template_key THEN
    RAISE EXCEPTION 'template_key % does not match catalog template % for event %',
      p_template_key, v_cat.template_key, p_event_type;
  END IF;

  -- 6. Apply catalog default visibility.
  v_visibility := COALESCE(p_visibility, v_cat.default_visibility);

  -- 7. Insert (idempotent via the partial unique dedup indexes).
  INSERT INTO public.activity_feed_events (
    season_id, week_id, source_feature, event_type,
    actor_player_id, subject_player_id, secondary_player_id,
    sportsbook_bet_id, loan_id, pvp_challenge_id, bounty_post_id,
    visibility, status,
    template_key, public_payload, admin_payload, occurred_at
  ) VALUES (
    p_season_id, p_week_id, p_source_feature, p_event_type,
    p_actor_player_id, p_subject_player_id, p_secondary_player_id,
    p_sportsbook_bet_id, p_loan_id, p_pvp_challenge_id, p_bounty_post_id,
    v_visibility, 'published',
    v_cat.template_key, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;
