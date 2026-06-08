-- ============================================================================
-- Activity Feed — Bounty Board ("new publisher" wiring; Recipe B, design §24).
-- ============================================================================
-- Adds the new source feature 'bounty_board' with its own nullable source FK
-- column (bounty_post_id), five event types, the 16→17-arg publish_activity_event
-- rebuild, and publish calls wired into the five bounty RPCs.
--
-- Worked example: 20260607180200_activity_feed_pvp.sql (the pvp "new publisher").
-- cancel_bounty publishes nothing — the cascade delete removes any prior feed rows.
-- ============================================================================


-- ── 1. Schema: new source FK + relaxed controlled-string CHECKs ──────────────
ALTER TABLE public.activity_feed_events
  ADD COLUMN bounty_post_id uuid REFERENCES public.bounty_post(id) ON DELETE CASCADE;

CREATE INDEX activity_feed_events_bounty_idx
  ON public.activity_feed_events (bounty_post_id) WHERE bounty_post_id IS NOT NULL;
-- Dedup: one event of a given type per bounty → publish's ON CONFLICT DO NOTHING is
-- idempotent (and yields "first hunter join only" for free).
CREATE UNIQUE INDEX activity_feed_unique_bounty_event
  ON public.activity_feed_events (bounty_post_id, event_type) WHERE bounty_post_id IS NOT NULL;

-- source_feature now includes 'bounty_board'.
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_source_feature_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_source_feature_check
  CHECK (source_feature IN ('sportsbook','loan_shark','pvp','bounty_board','system','admin'));

-- event_type gains the five bounty events (re-add the full current list + these).
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_event_type_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_event_type_check
  CHECK (event_type IN (
    'sportsbook_bet_placed','sportsbook_parlay_placed','sportsbook_big_ticket_placed',
    'sportsbook_big_win','sportsbook_parlay_hit','sportsbook_weekly_house_result',
    'loan_shark_loan_taken','loan_shark_loan_repaid','loan_shark_special_offer',
    'pvp_challenge_accepted','pvp_challenge_settled',
    'bounty_board_bounty_posted','bounty_board_hunter_joined','bounty_board_bounty_closed',
    'bounty_board_sponsor_won','bounty_board_hunters_won'));

-- A row still references at most one concrete source FK (+ the new bounty term).
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_one_source_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_one_source_check CHECK (
  (sportsbook_bet_id IS NOT NULL)::int +
  (loan_id           IS NOT NULL)::int +
  (pvp_challenge_id  IS NOT NULL)::int +
  (bounty_post_id    IS NOT NULL)::int
  <= 1
);


-- ── 2. publish_activity_event — 16 → 17 args (add p_bounty_post_id) ──────────
-- Postgres can't CREATE OR REPLACE with a changed argument list, so DROP the live
-- 16-arg signature and recreate with a trailing p_bounty_post_id (DEFAULT NULL),
-- which keeps every existing 16-arg caller (sportsbook/loan/system/pvp) working.
DROP FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz, uuid);

CREATE FUNCTION public.publish_activity_event(
  p_source_feature      text,
  p_event_type          text,
  p_season_id           uuid,
  p_week_id             uuid,
  p_actor_player_id     uuid,
  p_subject_player_id   uuid,
  p_secondary_player_id uuid,
  p_sportsbook_bet_id   uuid,
  p_loan_id             uuid,
  p_template_key        text,
  p_public_payload      jsonb,
  p_admin_payload       jsonb,
  p_importance          text,        -- NULL → catalog default
  p_visibility          text,        -- NULL → catalog default
  p_occurred_at         timestamptz,
  p_pvp_challenge_id    uuid DEFAULT NULL,
  p_bounty_post_id      uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_def_importance text;
  v_def_visibility text;
  v_requires_actor boolean;
  v_allowed_fk     text;   -- 'sportsbook_bet_id' | 'loan_id' | 'pvp_challenge_id' | 'bounty_post_id' | 'none'
  v_template       text;
  v_importance     text;
  v_visibility     text;
  v_id             uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','pvp','bounty_board','system','admin') THEN
    RAISE EXCEPTION 'Unknown source_feature: %', p_source_feature;
  END IF;

  -- 2. Event catalog lookup. RAISE on unknown event_type.
  CASE p_event_type
    WHEN 'sportsbook_bet_placed' THEN
      v_def_importance := 'low';       v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.bet_placed';
    WHEN 'sportsbook_parlay_placed' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_placed';
    WHEN 'sportsbook_big_ticket_placed' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_ticket_placed';
    WHEN 'sportsbook_big_win' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_win';
    WHEN 'sportsbook_parlay_hit' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_hit';
    WHEN 'sportsbook_weekly_house_result' THEN
      v_def_importance := 'major';     v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'sportsbook.weekly_house_result';
    WHEN 'loan_shark_loan_taken' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_taken';
    WHEN 'loan_shark_loan_repaid' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_repaid';
    WHEN 'loan_shark_special_offer' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'loan_shark.special_offer';
    WHEN 'pvp_challenge_accepted' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'pvp_challenge_id';  v_template := 'pvp.challenge_accepted';
    WHEN 'pvp_challenge_settled' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'pvp_challenge_id';  v_template := 'pvp.challenge_settled';
    WHEN 'bounty_board_bounty_posted' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.bounty_posted';
    WHEN 'bounty_board_hunter_joined' THEN
      v_def_importance := 'low';       v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.hunter_joined';
    WHEN 'bounty_board_bounty_closed' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.bounty_closed';
    WHEN 'bounty_board_sponsor_won' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.sponsor_won';
    WHEN 'bounty_board_hunters_won' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.hunters_won';
    ELSE
      RAISE EXCEPTION 'Unknown event_type: %', p_event_type;
  END CASE;

  -- 3. Source-FK ↔ feature consistency. The catalog's allowed_source_fk must match
  --    exactly which FK arg is non-NULL (all others must be NULL).
  IF v_allowed_fk = 'sportsbook_bet_id' THEN
    IF p_sportsbook_bet_id IS NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires sportsbook_bet_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'loan_id' THEN
    IF p_loan_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires loan_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'pvp_challenge_id' THEN
    IF p_pvp_challenge_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires pvp_challenge_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'bounty_post_id' THEN
    IF p_bounty_post_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires bounty_post_id only', p_event_type;
    END IF;
  ELSE  -- 'none' → no source FK permitted
    IF p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL OR p_bounty_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % must not carry a source FK', p_event_type;
    END IF;
  END IF;

  -- 4. Actor requirement.
  IF v_requires_actor AND p_actor_player_id IS NULL THEN
    RAISE EXCEPTION 'Event % requires an actor_player_id', p_event_type;
  END IF;

  -- 5. template_key must match the catalog (keeps copy controlled).
  IF p_template_key IS DISTINCT FROM v_template THEN
    RAISE EXCEPTION 'template_key % does not match catalog template % for event %',
      p_template_key, v_template, p_event_type;
  END IF;

  -- 6. Apply catalog defaults.
  v_importance := COALESCE(p_importance, v_def_importance);
  v_visibility := COALESCE(p_visibility, v_def_visibility);

  -- 7. Insert (idempotent via the partial unique dedup indexes).
  INSERT INTO public.activity_feed_events (
    season_id, week_id, source_feature, event_type,
    actor_player_id, subject_player_id, secondary_player_id,
    sportsbook_bet_id, loan_id, pvp_challenge_id, bounty_post_id,
    visibility, importance, status,
    template_key, public_payload, admin_payload, occurred_at
  ) VALUES (
    p_season_id, p_week_id, p_source_feature, p_event_type,
    p_actor_player_id, p_subject_player_id, p_secondary_player_id,
    p_sportsbook_bet_id, p_loan_id, p_pvp_challenge_id, p_bounty_post_id,
    v_visibility, v_importance, 'published',
    v_template, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Internal only: no client (anon/authenticated) may call the new 17-arg signature.
REVOKE EXECUTE ON FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated;


-- ── 3. create_sponsor_bounty — post the "bounty posted" event ────────────────
CREATE OR REPLACE FUNCTION public.create_sponsor_bounty(
  p_week_id               uuid,
  p_title                 text,
  p_description           text,
  p_sponsor_bounty_amount int,
  p_hunter_stake_amount   int,
  p_closes_at             timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sponsor_id uuid;
  v_season_id  uuid;
  v_balance    int;
  v_bounty_id  uuid;
BEGIN
  SELECT id INTO v_sponsor_id FROM public.players WHERE user_id = auth.uid();
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  IF p_week_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.weeks
      WHERE id = p_week_id AND season_id = v_season_id AND is_archived = false
    ) THEN
      RAISE EXCEPTION 'Invalid or archived week';
    END IF;
  END IF;

  IF length(coalesce(p_title, '')) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;
  IF length(coalesce(p_description, '')) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF p_sponsor_bounty_amount < 50 THEN
    RAISE EXCEPTION 'Sponsor bounty must be at least 50 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_sponsor_id AND season_id = v_season_id;
  IF v_balance < p_sponsor_bounty_amount THEN
    RAISE EXCEPTION 'Insufficient balance to sponsor this bounty';
  END IF;

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'sponsor_bounty', v_sponsor_id, p_title, p_description,
    p_sponsor_bounty_amount, p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (v_sponsor_id, v_season_id, p_week_id, false, -p_sponsor_bounty_amount,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed', v_bounty_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (NULL, v_season_id, p_week_id, true, p_sponsor_bounty_amount,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed (house)', v_bounty_id);

  -- Activity Feed: a sponsor bounty is on the board. Actor = sponsor (leads the card).
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    v_sponsor_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'sponsor_bounty_amount', p_sponsor_bounty_amount,
                       'hunter_stake_amount', p_hunter_stake_amount, 'bounty_type', 'sponsor_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_sponsor_bounty(uuid, text, text, int, int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_sponsor_bounty(uuid, text, text, int, int, timestamptz) TO authenticated;


-- ── 4. create_house_bounty — post the "bounty posted" event (actor = House) ──
CREATE OR REPLACE FUNCTION public.create_house_bounty(
  p_week_id               uuid,
  p_title                 text,
  p_description           text,
  p_sponsor_bounty_amount int,
  p_hunter_stake_amount   int,
  p_closes_at             timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id uuid;
  v_bounty_id uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  IF p_week_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.weeks
      WHERE id = p_week_id AND season_id = v_season_id AND is_archived = false
    ) THEN
      RAISE EXCEPTION 'Invalid or archived week';
    END IF;
  END IF;

  IF length(coalesce(p_title, '')) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;
  IF length(coalesce(p_description, '')) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF p_sponsor_bounty_amount < 50 THEN
    RAISE EXCEPTION 'Sponsor bounty must be at least 50 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'house_bounty', NULL, p_title, p_description,
    p_sponsor_bounty_amount, p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- Activity Feed: the Pinsino posted a bounty. No player actor (template renders
  -- "The Pinsino…"); requires_actor = false for this event.
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    NULL, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'sponsor_bounty_amount', p_sponsor_bounty_amount,
                       'hunter_stake_amount', p_hunter_stake_amount, 'bounty_type', 'house_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_house_bounty(uuid, text, text, int, int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_house_bounty(uuid, text, text, int, int, timestamptz) TO authenticated;


-- ── 5. enter_bounty_as_hunter — post the "hunter joined" event (first only) ──
CREATE OR REPLACE FUNCTION public.enter_bounty_as_hunter(p_bounty_post_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hunter_id    uuid;
  v_bounty       public.bounty_post;
  v_balance      int;
  v_entry_number int;
  v_protected    int;
  v_stake_id     uuid;
BEGIN
  SELECT id INTO v_hunter_id FROM public.players WHERE user_id = auth.uid();
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'Bounty is not open for entries';
  END IF;
  IF now() >= v_bounty.closes_at THEN
    RAISE EXCEPTION 'Bounty has closed';
  END IF;

  IF v_bounty.bounty_type = 'sponsor_bounty' AND v_bounty.sponsor_player_id = v_hunter_id THEN
    RAISE EXCEPTION 'You cannot hunt your own bounty';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bounty_hunter_stakes
    WHERE bounty_post_id = p_bounty_post_id AND player_id = v_hunter_id
  ) THEN
    RAISE EXCEPTION 'You have already entered this bounty';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_hunter_id AND season_id = v_bounty.season_id;
  IF v_balance < v_bounty.hunter_stake_amount THEN
    RAISE EXCEPTION 'Insufficient balance to enter this bounty';
  END IF;

  SELECT COALESCE(MAX(entry_number), 0) + 1 INTO v_entry_number
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_protected := v_bounty.sponsor_bounty_amount / v_entry_number;  -- floor (integer division)

  INSERT INTO public.bounty_hunter_stakes (
    bounty_post_id, player_id, stake_amount, entry_number, protected_hunter_profit, status
  ) VALUES (
    p_bounty_post_id, v_hunter_id, v_bounty.hunter_stake_amount, v_entry_number, v_protected, 'active'
  )
  RETURNING id INTO v_stake_id;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (v_hunter_id, v_bounty.season_id, v_bounty.week_id, false, -v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed', p_bounty_post_id, v_stake_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed (house)', p_bounty_post_id, v_stake_id);

  -- Activity Feed: a hunter joined. The partial unique index on
  -- (bounty_post_id, event_type) makes only the FIRST join publish (ON CONFLICT DO
  -- NOTHING drops the rest), so always calling yields "first hunter only" for free.
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_hunter_joined',
    v_bounty.season_id, v_bounty.week_id,
    v_hunter_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.hunter_joined',
    jsonb_build_object('bounty_title', v_bounty.title, 'entry_number', v_entry_number),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, NULL, now(),
    NULL, p_bounty_post_id);

  RETURN v_stake_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enter_bounty_as_hunter(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enter_bounty_as_hunter(uuid) TO authenticated;


-- ── 6. close_bounty — post the "bounty closed" event ─────────────────────────
CREATE OR REPLACE FUNCTION public.close_bounty(p_bounty_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bounty public.bounty_post;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'Only an open bounty can be closed';
  END IF;

  UPDATE public.bounty_post SET status = 'closed' WHERE id = p_bounty_post_id;

  -- Activity Feed: the bounty is locked for entries. No player actor.
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_closed',
    v_bounty.season_id, v_bounty.week_id,
    NULL, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_closed',
    jsonb_build_object('bounty_title', v_bounty.title),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, NULL, now(),
    NULL, p_bounty_post_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_bounty(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_bounty(uuid) TO authenticated;


-- ── 7. settle_bounty — post the outcome event (sponsor_won | hunters_won) ────
CREATE OR REPLACE FUNCTION public.settle_bounty(
  p_bounty_post_id            uuid,
  p_outcome                   text,
  p_admin_settlement_reasoning text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bounty         public.bounty_post;
  v_admin_id       uuid;
  v_hunter_count   int;
  v_S              int;
  v_total_stakes   int;
  v_total_protected int;
  v_total_seed     int;
  v_total_pot      int;
  v_settlement_id  uuid;
  v_payout_id      uuid;
  v_stake          record;
  v_payout         int;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  IF v_bounty.status = 'settled' THEN
    RETURN;
  END IF;
  IF v_bounty.status <> 'closed' THEN
    RAISE EXCEPTION 'Bounty must be closed before settling';
  END IF;

  IF p_outcome NOT IN ('sponsor_win', 'hunter_win') THEN
    RAISE EXCEPTION 'Invalid outcome';
  END IF;
  IF length(coalesce(p_admin_settlement_reasoning, '')) = 0 THEN
    RAISE EXCEPTION 'Settlement reasoning is required';
  END IF;

  SELECT count(*) INTO v_hunter_count
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  IF v_hunter_count < 1 THEN
    RAISE EXCEPTION 'Bounty has no hunters — cancel it instead of settling';
  END IF;

  v_S := v_bounty.sponsor_bounty_amount;
  SELECT COALESCE(SUM(stake_amount), 0), COALESCE(SUM(protected_hunter_profit), 0)
    INTO v_total_stakes, v_total_protected
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_total_seed := GREATEST(0, v_total_protected - v_S);
  v_total_pot  := v_S + v_total_stakes + v_total_seed;

  INSERT INTO public.bounty_settlements (
    bounty_post_id, settlement_outcome, settlement_source,
    total_sponsor_bounty, total_hunter_stakes, total_protected_hunter_profit,
    total_house_seed, total_pot, winner_count,
    settled_by_admin_id, admin_settlement_reasoning
  ) VALUES (
    p_bounty_post_id, p_outcome, 'admin',
    v_S, v_total_stakes, v_total_protected,
    v_total_seed, v_total_pot,
    CASE WHEN p_outcome = 'sponsor_win' THEN 1 ELSE v_hunter_count END,
    v_admin_id, p_admin_settlement_reasoning
  )
  RETURNING id INTO v_settlement_id;

  IF p_outcome = 'sponsor_win' THEN
    IF v_bounty.bounty_type = 'sponsor_bounty' THEN
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_bounty.sponsor_player_id, false, v_total_pot)
        RETURNING id INTO v_payout_id;

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_total_pot,
                'bounty_payout', 'Bounty sponsor won', p_bounty_post_id, v_settlement_id, v_payout_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_total_pot,
                'bounty_payout', 'Bounty sponsor won (house)', p_bounty_post_id, v_settlement_id, v_payout_id);
    ELSE
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, NULL, true, v_total_pot);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'lost', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;
  ELSE  -- hunter_win
    FOR v_stake IN
      SELECT * FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id
    LOOP
      v_payout := v_stake.stake_amount + v_stake.protected_hunter_profit;

      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_stake.player_id, false, v_payout)
        RETURNING id INTO v_payout_id;

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id, bounty_hunter_stake_id)
        VALUES (v_stake.player_id, v_bounty.season_id, v_bounty.week_id, false, v_payout,
                'bounty_payout', 'Bounty hunter won', p_bounty_post_id, v_settlement_id, v_payout_id, v_stake.id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id, bounty_hunter_stake_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_payout,
                'bounty_payout', 'Bounty hunter won (house)', p_bounty_post_id, v_settlement_id, v_payout_id, v_stake.id);
    END LOOP;

    UPDATE public.bounty_hunter_stakes
      SET status = 'won', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;
  END IF;

  UPDATE public.bounty_post SET status = 'settled' WHERE id = p_bounty_post_id;

  -- Activity Feed: the outcome. sponsor_win on a sponsor_bounty leads with the
  -- sponsor (actor); house/hunters_won have no player actor (requires_actor=false).
  IF p_outcome = 'sponsor_win' THEN
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_sponsor_won',
      v_bounty.season_id, v_bounty.week_id,
      CASE WHEN v_bounty.bounty_type = 'sponsor_bounty' THEN v_bounty.sponsor_player_id ELSE NULL END,
      NULL, NULL,
      NULL, NULL,
      'bounty_board.sponsor_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, NULL, now(),
      NULL, p_bounty_post_id);
  ELSE
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_hunters_won',
      v_bounty.season_id, v_bounty.week_id,
      NULL, NULL, NULL,
      NULL, NULL,
      'bounty_board.hunters_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, NULL, now(),
      NULL, p_bounty_post_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_bounty(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_bounty(uuid, text, text) TO authenticated;
