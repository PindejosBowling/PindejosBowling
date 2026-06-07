-- ============================================================================
-- Activity Feed ("Market Moves") — the activity_feed_events table.
-- ============================================================================
-- The public economic newswire (economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md;
-- economy/ACTIVITY_FEED_DB.md §1). One narrative row per feed-worthy economic
-- action, relationally anchored to concrete source tables via nullable FKs
-- (NO polymorphic source_type/source_action_id pair — §3.2).
--
-- The feed is NOT the ledger: it never moves pins and never participates in the
-- conservation invariant. No rendered text is stored — copy is rendered in the
-- app from template_key + public_payload (§3.7, §9).
--
-- Audit columns: created_at + updated_at only; the enforce_audit_columns event
-- trigger auto-attaches set_updated_at (do NOT declare it here — it would collide).
--
-- Controlled strings (source_feature, event_type, visibility, importance, status)
-- are enforced by CHECK constraints on the column (§23-Q7), not enums/lookups.
-- ============================================================================

CREATE TABLE public.activity_feed_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id              uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  week_id                uuid REFERENCES public.weeks(id) ON DELETE SET NULL,

  -- Source feature + event type — controlled vocabularies (§6.1, §6.2).
  source_feature         text NOT NULL CHECK (source_feature IN ('sportsbook','loan_shark','system','admin')),
  event_type             text NOT NULL CHECK (event_type IN (
                           'sportsbook_bet_placed',
                           'sportsbook_parlay_placed',
                           'sportsbook_big_ticket_placed',
                           'sportsbook_big_win',
                           'sportsbook_parlay_hit',
                           'sportsbook_weekly_house_result',
                           'loan_shark_loan_taken',
                           'loan_shark_loan_repaid',
                           'loan_shark_special_offer')),

  -- Players involved (all nullable; SET NULL on player delete so the row survives).
  actor_player_id        uuid REFERENCES public.players(id) ON DELETE SET NULL,  -- who the story is about
  subject_player_id      uuid REFERENCES public.players(id) ON DELETE SET NULL,  -- e.g. a bet's market subject (§10.2)
  secondary_player_id    uuid REFERENCES public.players(id) ON DELETE SET NULL,  -- reserved for future two-party events (PvP)

  -- Concrete source FKs (§3.2/§3.3) — destructive cancel of the source deletes the
  -- feed row via ON DELETE CASCADE. Future features add their own nullable column.
  sportsbook_bet_id      uuid REFERENCES public.bets(id) ON DELETE CASCADE,
  loan_id                uuid REFERENCES public.loans(id) ON DELETE CASCADE,

  visibility             text NOT NULL DEFAULT 'public'    CHECK (visibility IN ('public','admin_only')),
  importance             text NOT NULL DEFAULT 'normal'    CHECK (importance IN ('low','normal','highlight','major')),
  status                 text NOT NULL DEFAULT 'published'  CHECK (status IN ('published','suppressed')),

  template_key           text NOT NULL,                              -- controlled rendering key (§9)
  public_payload         jsonb NOT NULL DEFAULT '{}'::jsonb,         -- league-safe snapshot values (§8.1, §8.3)
  admin_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,         -- operational details, never rendered publicly (§8.2)

  occurred_at            timestamptz NOT NULL,                       -- when the source action happened (stamped by publisher)
  published_at           timestamptz NOT NULL DEFAULT now(),         -- feed-ordering key

  -- Admin suppression metadata (§18.1).
  suppressed_by_admin_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  suppressed_at          timestamptz,
  suppression_reason     text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- A row references at most one concrete source FK (zero allowed for
  -- system/admin aggregates, §5.3). Future publishers extend this CHECK by one
  -- "+ (<new>_id IS NOT NULL)::int" term.
  CONSTRAINT activity_feed_one_source_check CHECK (
    (sportsbook_bet_id IS NOT NULL)::int +
    (loan_id           IS NOT NULL)::int
    <= 1
  )
);

-- ============================================================================
-- Indexes (design §15.3).
-- ============================================================================
-- Feed-ordering composite indexes — the public feed, per-feature, and importance
-- filtered views. published_at DESC, id DESC is the stable ordering key.
CREATE INDEX activity_feed_events_feed_idx
  ON public.activity_feed_events (season_id, status, visibility, published_at DESC, id DESC);
CREATE INDEX activity_feed_events_feature_idx
  ON public.activity_feed_events (season_id, source_feature, status, visibility, published_at DESC, id DESC);
CREATE INDEX activity_feed_events_importance_idx
  ON public.activity_feed_events (season_id, importance, status, visibility, published_at DESC, id DESC);

-- Partial FK indexes for the source-cancel cascade lookups.
CREATE INDEX activity_feed_events_sportsbook_bet_idx
  ON public.activity_feed_events (sportsbook_bet_id) WHERE sportsbook_bet_id IS NOT NULL;
CREATE INDEX activity_feed_events_loan_idx
  ON public.activity_feed_events (loan_id) WHERE loan_id IS NOT NULL;

-- Remaining FK columns — plain b-tree (FK-advisor requirement).
CREATE INDEX activity_feed_events_week_id_idx              ON public.activity_feed_events (week_id);
CREATE INDEX activity_feed_events_actor_player_id_idx      ON public.activity_feed_events (actor_player_id);
CREATE INDEX activity_feed_events_subject_player_id_idx    ON public.activity_feed_events (subject_player_id);
CREATE INDEX activity_feed_events_secondary_player_id_idx  ON public.activity_feed_events (secondary_player_id);
CREATE INDEX activity_feed_events_suppressed_by_admin_idx  ON public.activity_feed_events (suppressed_by_admin_id);

-- Partial unique indexes for dedup (§13.3) — make publish_activity_event's
-- ON CONFLICT DO NOTHING idempotent so a retried/re-run RPC never double-posts.
CREATE UNIQUE INDEX activity_feed_unique_bet_event
  ON public.activity_feed_events (sportsbook_bet_id, event_type) WHERE sportsbook_bet_id IS NOT NULL;
CREATE UNIQUE INDEX activity_feed_unique_loan_event
  ON public.activity_feed_events (loan_id, event_type) WHERE loan_id IS NOT NULL;

-- ============================================================================
-- RLS — reads are tightened (NOT USING(true)); direct writes are admin-only.
-- ============================================================================
-- anon + authenticated may read ONLY published + public rows, so suppressed and
-- admin_only rows never leak to clients (§6.3, §6.4). Admins (authenticated with
-- the admin role) get an additional policy to read every row. All non-admin
-- writes go through SECURITY DEFINER RPCs (which bypass RLS); players never write
-- this table and the publish helper is internal (§2).
ALTER TABLE public.activity_feed_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read public published" ON public.activity_feed_events
  FOR SELECT TO anon
  USING (status = 'published' AND visibility = 'public');

CREATE POLICY "authenticated can read public published" ON public.activity_feed_events
  FOR SELECT TO authenticated
  USING (status = 'published' AND visibility = 'public');

CREATE POLICY "admin can read all" ON public.activity_feed_events
  FOR SELECT TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can insert" ON public.activity_feed_events
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can update" ON public.activity_feed_events
  FOR UPDATE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin can delete" ON public.activity_feed_events
  FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
