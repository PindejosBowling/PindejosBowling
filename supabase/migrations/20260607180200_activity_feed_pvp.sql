-- ============================================================================
-- Activity Feed — PvP Challenge outcomes (accept + settle).
-- ============================================================================
-- Adds a new source feature 'pvp' with its own nullable source FK column
-- (pvp_challenge_id), two event types, and publish calls wired into
-- accept_pvp_challenge + settle_pvp_challenge. Contract CREATION is intentionally
-- NOT an event — only an accepted (locked) contract and its settlement post.
--
-- Settled events make the WINNER the actor (so their avatar + name lead the card);
-- a push posts a "draw" with both parties. Voids post nothing (no contest). Stakes
-- are already public on the Challenge Board, so the pot is exposed.
-- ============================================================================

-- ── 1. Schema: new source FK + relaxed controlled-string CHECKs ──────────────
ALTER TABLE public.activity_feed_events
  ADD COLUMN pvp_challenge_id uuid REFERENCES public.pvp_challenges(id) ON DELETE CASCADE;

-- source_feature now includes 'pvp'.
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_source_feature_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_source_feature_check
  CHECK (source_feature IN ('sportsbook','loan_shark','pvp','system','admin'));

-- event_type gains the two PvP outcomes.
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_event_type_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_event_type_check
  CHECK (event_type IN (
    'sportsbook_bet_placed',
    'sportsbook_parlay_placed',
    'sportsbook_big_ticket_placed',
    'sportsbook_big_win',
    'sportsbook_parlay_hit',
    'sportsbook_weekly_house_result',
    'loan_shark_loan_taken',
    'loan_shark_loan_repaid',
    'loan_shark_special_offer',
    'pvp_challenge_accepted',
    'pvp_challenge_settled'));

-- A row still references at most one concrete source FK (+ the new pvp term).
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_one_source_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_one_source_check CHECK (
  (sportsbook_bet_id IS NOT NULL)::int +
  (loan_id           IS NOT NULL)::int +
  (pvp_challenge_id  IS NOT NULL)::int
  <= 1
);

-- ── 2. Indexes (mirror the sportsbook/loan source-FK pattern) ────────────────
CREATE INDEX activity_feed_events_pvp_challenge_idx
  ON public.activity_feed_events (pvp_challenge_id) WHERE pvp_challenge_id IS NOT NULL;
-- Dedup: one event of a given type per challenge → publish's ON CONFLICT DO NOTHING
-- is idempotent against retries / re-settlement.
CREATE UNIQUE INDEX activity_feed_unique_pvp_event
  ON public.activity_feed_events (pvp_challenge_id, event_type) WHERE pvp_challenge_id IS NOT NULL;

-- ── 3. publish_activity_event — add the pvp_challenge_id FK + catalog entries ─
-- The signature gains a trailing p_pvp_challenge_id (DEFAULT NULL) so every
-- existing 15-arg caller (sportsbook / loan / system) keeps working unchanged.
DROP FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz);

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
  p_pvp_challenge_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_def_importance text;
  v_def_visibility text;
  v_requires_actor boolean;
  v_allowed_fk     text;   -- 'sportsbook_bet_id' | 'loan_id' | 'pvp_challenge_id' | 'none'
  v_template       text;
  v_importance     text;
  v_visibility     text;
  v_id             uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','pvp','system','admin') THEN
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
    ELSE
      RAISE EXCEPTION 'Unknown event_type: %', p_event_type;
  END CASE;

  -- 3. Source-FK ↔ feature consistency. The catalog's allowed_source_fk must match
  --    exactly which FK arg is non-NULL (all others must be NULL).
  IF v_allowed_fk = 'sportsbook_bet_id' THEN
    IF p_sportsbook_bet_id IS NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires sportsbook_bet_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'loan_id' THEN
    IF p_loan_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires loan_id only', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'pvp_challenge_id' THEN
    IF p_pvp_challenge_id IS NULL OR p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires pvp_challenge_id only', p_event_type;
    END IF;
  ELSE  -- 'none' → no source FK permitted
    IF p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL OR p_pvp_challenge_id IS NOT NULL THEN
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
    sportsbook_bet_id, loan_id, pvp_challenge_id,
    visibility, importance, status,
    template_key, public_payload, admin_payload, occurred_at
  ) VALUES (
    p_season_id, p_week_id, p_source_feature, p_event_type,
    p_actor_player_id, p_subject_player_id, p_secondary_player_id,
    p_sportsbook_bet_id, p_loan_id, p_pvp_challenge_id,
    v_visibility, v_importance, 'published',
    v_template, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;

-- ── 4. accept_pvp_challenge — post the "locked in" event (CREATE OR REPLACE) ──
CREATE OR REPLACE FUNCTION public.accept_pvp_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id      uuid;
  v_challenge      public.pvp_challenges;
  v_offer          record;
  v_creator_bal    int;
  v_cparty_bal     int;
  v_pin_p1_player  uuid;
  v_pin_p1_house   uuid;
  v_pin_p2_player  uuid;
  v_pin_p2_house   uuid;
  v_pvp_stake1     uuid;
  v_pvp_stake2     uuid;
  v_counterparty   uuid;
BEGIN
  SELECT id INTO v_caller_id FROM public.players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('pending', 'countered') THEN
    RAISE EXCEPTION 'Challenge is not in an acceptable state';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot accept your own offer';
  END IF;

  IF v_challenge.counterparty_player_id IS NULL THEN
    v_counterparty := v_caller_id;
  ELSE
    IF v_caller_id <> v_challenge.counterparty_player_id
       AND v_caller_id <> v_challenge.creator_player_id THEN
      RAISE EXCEPTION 'You are not a party to this challenge';
    END IF;
    v_counterparty := v_challenge.counterparty_player_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.weeks WHERE id = v_challenge.week_id AND is_archived = true) THEN
    RAISE EXCEPTION 'Cannot accept a contract for an archived week';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_creator_bal
    FROM public.pin_ledger WHERE player_id = v_challenge.creator_player_id AND season_id = v_challenge.season_id;
  IF v_creator_bal < v_challenge.creator_stake THEN
    RAISE EXCEPTION 'Creator has insufficient balance';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_cparty_bal
    FROM public.pin_ledger WHERE player_id = v_counterparty AND season_id = v_challenge.season_id;
  IF v_cparty_bal < v_challenge.counterparty_stake THEN
    RAISE EXCEPTION 'Counterparty has insufficient balance';
  END IF;

  -- Escrow creator's stake (double-entry: player -stake, house +stake).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
            false, -v_challenge.creator_stake, 'pvp_stake', 'PvP challenge stake escrowed')
    RETURNING id INTO v_pin_p1_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, v_challenge.creator_stake, 'pvp_stake', 'PvP challenge stake escrowed (house)')
    RETURNING id INTO v_pin_p1_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
            -v_challenge.creator_stake, 'stake', 'Creator stake escrowed', v_pin_p1_player)
    RETURNING id INTO v_pvp_stake1;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_stake1 WHERE id IN (v_pin_p1_player, v_pin_p1_house);

  -- Escrow counterparty's stake.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_counterparty, v_challenge.season_id, v_challenge.week_id,
            false, -v_challenge.counterparty_stake, 'pvp_stake', 'PvP challenge stake escrowed')
    RETURNING id INTO v_pin_p2_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, v_challenge.counterparty_stake, 'pvp_stake', 'PvP challenge stake escrowed (house)')
    RETURNING id INTO v_pin_p2_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_counterparty, v_challenge.season_id, v_challenge.week_id,
            -v_challenge.counterparty_stake, 'stake', 'Counterparty stake escrowed', v_pin_p2_player)
    RETURNING id INTO v_pvp_stake2;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_stake2 WHERE id IN (v_pin_p2_player, v_pin_p2_house);

  IF v_challenge.contract_type = 'line_duel' THEN
    UPDATE public.pvp_challenges SET
      creator_line      = COALESCE(creator_line, public.pvp_player_line(v_challenge.creator_player_id, v_challenge.season_id)),
      counterparty_line = COALESCE(counterparty_line, public.pvp_player_line(v_counterparty, v_challenge.season_id))
    WHERE id = p_challenge_id;
  END IF;

  UPDATE public.pvp_challenge_offers SET accepted_at = now() WHERE id = v_offer.id;

  UPDATE public.pvp_challenges SET
    status                 = 'locked',
    counterparty_player_id = v_counterparty,
    accepted_at            = now(),
    locked_at              = now(),
    total_pot              = v_challenge.creator_stake + v_challenge.counterparty_stake,
    payout_amount          = v_challenge.creator_stake + v_challenge.counterparty_stake
  WHERE id = p_challenge_id;

  -- Activity Feed: the contract is locked between two players. Actor = creator,
  -- secondary = the opponent. Pot is public (shown on the Challenge Board).
  PERFORM public.publish_activity_event(
    'pvp', 'pvp_challenge_accepted',
    v_challenge.season_id, v_challenge.week_id,
    v_challenge.creator_player_id, NULL, v_counterparty,
    NULL, NULL,
    'pvp.challenge_accepted',
    jsonb_build_object('pot', v_challenge.creator_stake + v_challenge.counterparty_stake,
                       'contract_type', v_challenge.contract_type),
    jsonb_build_object('challenge_id', p_challenge_id),
    NULL, NULL, now(),
    p_challenge_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_pvp_challenge(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_pvp_challenge(uuid) TO authenticated;

-- ── 5. settle_pvp_challenge — post the outcome (CREATE OR REPLACE) ───────────
-- Identical to the live body (20260607110000) except for the two publish calls in
-- the push + winner paths. Void path posts nothing (it RETURNs via void_pvp).
CREATE OR REPLACE FUNCTION public.settle_pvp_challenge(
  p_challenge_id      uuid,
  p_source            text,
  p_winner_player_id  uuid,
  p_admin_note        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge      public.pvp_challenges;
  v_creator_score  int;
  v_cparty_score   int;
  v_creator_net    numeric;
  v_cparty_net     numeric;
  v_creator_adj    int;
  v_cparty_adj     int;
  v_winner_id      uuid;
  v_is_push        boolean := false;
  v_is_void        boolean := false;
  v_result_detail  jsonb;
  v_pin_player     uuid;
  v_pin_house      uuid;
  v_pvp_id         uuid;
  v_mkt_result     numeric;
  v_creator_sel    record;
  v_cparty_sel     record;
BEGIN
  IF p_source = 'admin' THEN
    IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
      RAISE EXCEPTION 'Admin only';
    END IF;
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status IN ('settled', 'pushed', 'voided', 'cancelled') THEN
    RETURN;
  END IF;
  IF v_challenge.status <> 'locked' THEN
    RAISE EXCEPTION 'Challenge is not locked — cannot settle';
  END IF;

  IF p_source = 'admin' AND p_winner_player_id IS NOT NULL THEN
    v_winner_id     := p_winner_player_id;
    v_result_detail := jsonb_build_object('source', 'admin', 'winner', p_winner_player_id);
  ELSE
    IF v_challenge.contract_type IN ('line_duel', 'head_to_head') THEN
      SELECT s.score INTO v_creator_score
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = v_challenge.week_id
          AND ts.player_id = v_challenge.creator_player_id
          AND ts.is_fill = false
          AND g.game_number = v_challenge.game_number
          AND s.score IS NOT NULL
        LIMIT 1;

      SELECT s.score INTO v_cparty_score
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = v_challenge.week_id
          AND ts.player_id = v_challenge.counterparty_player_id
          AND ts.is_fill = false
          AND g.game_number = v_challenge.game_number
          AND s.score IS NOT NULL
        LIMIT 1;

      IF v_creator_score IS NULL OR v_cparty_score IS NULL THEN
        v_is_void := true;
      ELSIF v_challenge.contract_type = 'line_duel' THEN
        v_creator_net := v_creator_score - v_challenge.creator_line;
        v_cparty_net  := v_cparty_score  - v_challenge.counterparty_line;
        v_result_detail := jsonb_build_object(
          'creator_score', v_creator_score, 'creator_line', v_challenge.creator_line, 'creator_net', v_creator_net,
          'counterparty_score', v_cparty_score, 'counterparty_line', v_challenge.counterparty_line, 'counterparty_net', v_cparty_net
        );
        IF v_creator_net > v_cparty_net THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_net > v_creator_net THEN
          v_winner_id := v_challenge.counterparty_player_id;
        ELSE
          v_is_push := true;
        END IF;
      ELSE
        v_creator_adj := v_creator_score + COALESCE(v_challenge.creator_handicap, 0);
        v_cparty_adj  := v_cparty_score  + COALESCE(v_challenge.counterparty_handicap, 0);
        v_result_detail := jsonb_build_object(
          'creator_score', v_creator_score, 'creator_handicap', COALESCE(v_challenge.creator_handicap, 0), 'creator_adjusted', v_creator_adj,
          'counterparty_score', v_cparty_score, 'counterparty_handicap', COALESCE(v_challenge.counterparty_handicap, 0), 'counterparty_adjusted', v_cparty_adj
        );
        IF v_creator_adj > v_cparty_adj THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_adj > v_creator_adj THEN
          v_winner_id := v_challenge.counterparty_player_id;
        ELSE
          v_is_push := true;
        END IF;
      END IF;

    ELSIF v_challenge.contract_type = 'prop_duel' THEN
      SELECT result_value INTO v_mkt_result
        FROM public.bet_markets WHERE id = v_challenge.prop_market_id;

      IF v_mkt_result IS NULL THEN
        v_is_void := true;
      ELSE
        SELECT s.key, s.line, s.result INTO v_creator_sel
          FROM public.bet_selections s
          WHERE s.market_id = v_challenge.prop_market_id AND s.key = v_challenge.creator_selection
          LIMIT 1;
        SELECT s.key, s.line, s.result INTO v_cparty_sel
          FROM public.bet_selections s
          WHERE s.market_id = v_challenge.prop_market_id AND s.key = v_challenge.counterparty_selection
          LIMIT 1;

        v_result_detail := jsonb_build_object(
          'market_result', v_mkt_result,
          'creator_selection', v_challenge.creator_selection,   'creator_result', v_creator_sel.result,
          'counterparty_selection', v_challenge.counterparty_selection, 'counterparty_result', v_cparty_sel.result
        );

        IF v_creator_sel.result = 'won' THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_sel.result = 'won' THEN
          v_winner_id := v_challenge.counterparty_player_id;
        ELSE
          v_is_push := true;
        END IF;
      END IF;

    ELSIF v_challenge.contract_type = 'custom' THEN
      RAISE EXCEPTION 'Custom contracts must be settled with an explicit winner, or voided';
    END IF;
  END IF;

  -- Void path: refund stakes (no feed event — no contest happened).
  IF v_is_void THEN
    PERFORM public.void_pvp_challenge(p_challenge_id, COALESCE(p_admin_note, 'Score unavailable — voided at settlement'));
    RETURN;
  END IF;

  -- Push path: refund stakes.
  IF v_is_push THEN
    DECLARE v_stake_row record;
    BEGIN
      FOR v_stake_row IN
        SELECT * FROM public.pvp_ledger
        WHERE challenge_id = p_challenge_id AND type = 'stake' AND player_id IS NOT NULL
      LOOP
        INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
          VALUES (v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
                  false, -v_stake_row.amount, 'pvp_refund', 'PvP push — stake refunded')
          RETURNING id INTO v_pin_player;
        INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
          VALUES (NULL, v_stake_row.season_id, v_stake_row.week_id,
                  true, v_stake_row.amount, 'pvp_refund', 'PvP push — stake refunded (house)')
          RETURNING id INTO v_pin_house;

        INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
          VALUES (p_challenge_id, v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
                  -v_stake_row.amount, 'refund', 'Push refund', v_pin_player)
          RETURNING id INTO v_pvp_id;

        UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
      END LOOP;
    END;

    UPDATE public.pvp_challenges SET
      status        = 'pushed',
      result_detail = COALESCE(v_result_detail, '{}'::jsonb),
      settled_at    = now(),
      admin_note    = p_admin_note
    WHERE id = p_challenge_id;

    -- Activity Feed: a draw — both parties named, no winner badge.
    PERFORM public.publish_activity_event(
      'pvp', 'pvp_challenge_settled',
      v_challenge.season_id, v_challenge.week_id,
      v_challenge.creator_player_id, NULL, v_challenge.counterparty_player_id,
      NULL, NULL,
      'pvp.challenge_settled',
      jsonb_build_object('outcome', 'push', 'pot', v_challenge.total_pot,
                         'contract_type', v_challenge.contract_type),
      jsonb_build_object('challenge_id', p_challenge_id, 'source', p_source),
      NULL, NULL, now(),
      p_challenge_id);
    RETURN;
  END IF;

  -- Winner path: pay the full pot to the winner (player +pot, house -pot).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_winner_id, v_challenge.season_id, v_challenge.week_id,
            false, v_challenge.total_pot, 'pvp_payout', 'PvP challenge won')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, -v_challenge.total_pot, 'pvp_payout', 'PvP challenge won (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_winner_id, v_challenge.season_id, v_challenge.week_id,
            v_challenge.total_pot, 'payout', 'Winner payout (full pot)', v_pin_player)
    RETURNING id INTO v_pvp_id;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);

  UPDATE public.pvp_challenges SET
    status           = 'settled',
    winner_player_id = v_winner_id,
    result_detail    = COALESCE(v_result_detail, '{}'::jsonb),
    settled_at       = now(),
    admin_note       = p_admin_note
  WHERE id = p_challenge_id;

  -- Activity Feed: the WINNER leads the card (actor = winner). Secondary = loser.
  PERFORM public.publish_activity_event(
    'pvp', 'pvp_challenge_settled',
    v_challenge.season_id, v_challenge.week_id,
    v_winner_id, NULL,
    CASE WHEN v_winner_id = v_challenge.creator_player_id
         THEN v_challenge.counterparty_player_id
         ELSE v_challenge.creator_player_id END,
    NULL, NULL,
    'pvp.challenge_settled',
    jsonb_build_object('outcome', 'win', 'pot', v_challenge.total_pot,
                       'contract_type', v_challenge.contract_type),
    jsonb_build_object('challenge_id', p_challenge_id, 'source', p_source),
    NULL, NULL, now(),
    p_challenge_id);
END;
$$;
