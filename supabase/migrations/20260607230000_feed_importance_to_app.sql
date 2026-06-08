-- ============================================================================
-- Activity Feed — move "importance" out of the database into the app layer.
-- ============================================================================
-- Importance (low/normal/highlight/major) was a stored column computed at publish
-- time by a hard-coded CASE on event_type. It is never used by RLS and is purely
-- a derived property of event_type, so the Market Moves feature now owns it in app
-- code (app/src/utils/activityFeedTemplates.ts → importanceForEvent / the
-- "Highlights" filter queries by event_type). This migration:
--   1. Recreates publish_activity_event WITHOUT p_importance (signature change) and
--      stops computing/storing importance.
--   2. Recreates every caller RPC to match the new signature (the importance arg is
--      dropped from each publish_activity_event call; bodies are otherwise the exact
--      live definitions, so no economic behavior changes).
--   3. Recreates create_system_activity_event WITHOUT p_importance.
--   4. Drops the importance column (which also drops activity_feed_events_importance_idx).
-- All caller recreations land in this one migration so no body ever calls the old
-- 17-arg signature.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. publish_activity_event — drop p_importance (signature change → DROP + CREATE).
--    The catalog CASE still sets visibility + actor requirement; it no longer sets
--    importance, and the INSERT no longer writes the column.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz, uuid, uuid
);

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
  v_def_visibility text;
  v_requires_actor boolean;
  v_allowed_fk     text;   -- 'sportsbook_bet_id' | 'loan_id' | 'pvp_challenge_id' | 'bounty_post_id' | 'none'
  v_template       text;
  v_visibility     text;
  v_id             uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','pvp','bounty_board','system','admin') THEN
    RAISE EXCEPTION 'Unknown source_feature: %', p_source_feature;
  END IF;

  -- 2. Event catalog lookup. RAISE on unknown event_type. (Importance is no longer
  --    set here — it is derived in the app from event_type.)
  CASE p_event_type
    WHEN 'sportsbook_bet_placed' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.bet_placed';
    WHEN 'sportsbook_parlay_placed' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_placed';
    WHEN 'sportsbook_big_ticket_placed' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_ticket_placed';
    WHEN 'sportsbook_big_win' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_win';
    WHEN 'sportsbook_parlay_hit' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_hit';
    WHEN 'sportsbook_weekly_house_result' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'sportsbook.weekly_house_result';
    WHEN 'loan_shark_loan_taken' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_taken';
    WHEN 'loan_shark_loan_repaid' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_repaid';
    WHEN 'loan_shark_special_offer' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'loan_shark.special_offer';
    WHEN 'pvp_challenge_accepted' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'pvp_challenge_id';  v_template := 'pvp.challenge_accepted';
    WHEN 'pvp_challenge_settled' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'pvp_challenge_id';  v_template := 'pvp.challenge_settled';
    WHEN 'bounty_board_bounty_posted' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.bounty_posted';
    WHEN 'bounty_board_hunter_joined' THEN
      v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.hunter_joined';
    WHEN 'bounty_board_bounty_closed' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.bounty_closed';
    WHEN 'bounty_board_sponsor_won' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'bounty_post_id';    v_template := 'bounty_board.sponsor_won';
    WHEN 'bounty_board_hunters_won' THEN
      v_def_visibility := 'public'; v_requires_actor := false;
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

  -- 6. Apply catalog default visibility.
  v_visibility := COALESCE(p_visibility, v_def_visibility);

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
    v_template, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Internal only: no client (anon/authenticated) may call the new 16-arg signature.
REVOKE EXECUTE ON FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Caller RPCs — recreated from their exact live definitions, with the dropped
--    p_importance argument removed from each publish_activity_event call. No other
--    changes (CREATE OR REPLACE preserves existing grants).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_pvp_challenge(p_challenge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    NULL, now(),
    p_challenge_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_bounty(p_bounty_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    NULL, now(),
    NULL, p_bounty_post_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_house_bounty(p_week_id uuid, p_title text, p_description text, p_reward_per_hunter integer, p_hunter_stake_amount integer, p_max_hunters integer, p_closes_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  IF p_reward_per_hunter < 25 THEN
    RAISE EXCEPTION 'Reward per hunter must be at least 25 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_max_hunters < 1 OR p_max_hunters > 100 THEN
    RAISE EXCEPTION 'Max hunters must be between 1 and 100';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, reward_per_hunter, max_hunters,
    hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'house_bounty', NULL, p_title, p_description,
    p_reward_per_hunter * p_max_hunters, p_reward_per_hunter, p_max_hunters,
    p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- No ledger movement — the House funds rewards only if hunters win (design §23.4).

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    NULL, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'reward_per_hunter', p_reward_per_hunter,
                       'hunter_stake_amount', p_hunter_stake_amount, 'max_hunters', p_max_hunters,
                       'bounty_type', 'house_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sponsor_bounty(p_week_id uuid, p_title text, p_description text, p_reward_per_hunter integer, p_hunter_stake_amount integer, p_max_hunters integer, p_closes_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sponsor_id uuid;
  v_season_id  uuid;
  v_balance    int;
  v_escrow     int;
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
  IF p_reward_per_hunter < 25 THEN
    RAISE EXCEPTION 'Reward per hunter must be at least 25 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_max_hunters < 1 OR p_max_hunters > 100 THEN
    RAISE EXCEPTION 'Max hunters must be between 1 and 100';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  v_escrow := p_reward_per_hunter * p_max_hunters;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_sponsor_id AND season_id = v_season_id;
  IF v_balance < v_escrow THEN
    RAISE EXCEPTION 'Insufficient balance: sponsoring up to % hunters at % each requires % pins',
      p_max_hunters, p_reward_per_hunter, v_escrow;
  END IF;

  -- sponsor_bounty_amount holds the TOTAL escrow (R*m) so the escrow plumbing and
  -- cancel/refund-by-bounty_post_id logic are unchanged.
  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, reward_per_hunter, max_hunters,
    hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'sponsor_bounty', v_sponsor_id, p_title, p_description,
    v_escrow, p_reward_per_hunter, p_max_hunters,
    p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- Escrow the full max liability (player -R*m, house +R*m). Both rows carry
  -- bounty_post_id so cancel deletes them together.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (v_sponsor_id, v_season_id, p_week_id, false, -v_escrow,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed', v_bounty_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (NULL, v_season_id, p_week_id, true, v_escrow,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed (house)', v_bounty_id);

  -- Activity Feed: a sponsor bounty is on the board. Actor = sponsor (leads the card).
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    v_sponsor_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'reward_per_hunter', p_reward_per_hunter,
                       'hunter_stake_amount', p_hunter_stake_amount, 'max_hunters', p_max_hunters,
                       'bounty_type', 'sponsor_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enter_bounty_as_hunter(p_bounty_post_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_hunter_id    uuid;
  v_bounty       public.bounty_post;
  v_balance      int;
  v_entry_number int;
  v_count        int;
  v_stake_id     uuid;
BEGIN
  SELECT id INTO v_hunter_id FROM public.players WHERE user_id = auth.uid();
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  -- Serialize concurrent entries so entry_number + capacity are deterministic.
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

  -- Capacity: the sponsor has only escrowed reward for max_hunters hunters.
  SELECT count(*) INTO v_count
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  IF v_count >= v_bounty.max_hunters THEN
    RAISE EXCEPTION 'Bounty is full';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_hunter_id AND season_id = v_bounty.season_id;
  IF v_balance < v_bounty.hunter_stake_amount THEN
    RAISE EXCEPTION 'Insufficient balance to enter this bounty';
  END IF;

  v_entry_number := v_count + 1;

  -- Every hunter is offered the same fixed reward (no dilution). protected_hunter_profit
  -- now snapshots the flat reward_per_hunter (kept on the row for settlement + display).
  INSERT INTO public.bounty_hunter_stakes (
    bounty_post_id, player_id, stake_amount, entry_number, protected_hunter_profit, status
  ) VALUES (
    p_bounty_post_id, v_hunter_id, v_bounty.hunter_stake_amount, v_entry_number,
    v_bounty.reward_per_hunter, 'active'
  )
  RETURNING id INTO v_stake_id;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (v_hunter_id, v_bounty.season_id, v_bounty.week_id, false, -v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed', p_bounty_post_id, v_stake_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed (house)', p_bounty_post_id, v_stake_id);

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_hunter_joined',
    v_bounty.season_id, v_bounty.week_id,
    v_hunter_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.hunter_joined',
    jsonb_build_object('bounty_title', v_bounty.title, 'entry_number', v_entry_number),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, now(),
    NULL, p_bounty_post_id);

  RETURN v_stake_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_balance   integer;
  v_odds      numeric := 1;
  v_payout    integer;
  v_bet_id    uuid;
  v_sel       record;
  v_n         integer;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  IF p_selection_ids IS NULL OR array_length(p_selection_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  -- Validate every selection, gather odds, resolve + assert a single season, and
  -- enforce anti-tanking. Each selection must belong to a distinct open market.
  v_n := 0;
  FOR v_sel IN
    SELECT s.id AS selection_id, s.key, s.odds, s.line,
           m.id AS market_id, m.status, m.subject_player_id, m.week_id
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = ANY (p_selection_ids)
  LOOP
    v_n := v_n + 1;
    IF v_sel.status <> 'open' THEN
      RAISE EXCEPTION 'A selected market is not open';
    END IF;

    DECLARE v_mseason uuid;
    BEGIN
      SELECT season_id INTO v_mseason FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Capture week_id from the first selection (all O/U legs share the same week).
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    END IF;

    -- Anti-tank (trigger is the backstop): no backing 'under' on your own market.
    IF v_sel.subject_player_id = v_player_id AND v_sel.key = 'under' THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own line';
    END IF;

    v_odds := v_odds * v_sel.odds;
  END LOOP;

  IF v_n <> array_length(p_selection_ids, 1) THEN
    RAISE EXCEPTION 'One or more selections not found';
  END IF;

  v_payout := FLOOR(p_stake * v_odds);

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger
    WHERE player_id = v_player_id AND season_id = v_season_id;
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  INSERT INTO public.bets (player_id, season_id, counterparty, stake, potential_payout, status)
    VALUES (v_player_id, v_season_id, 'house', p_stake, v_payout, 'pending')
    RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, s.id, 'back', s.odds, s.line
    FROM public.bet_selections s
    WHERE s.id = ANY (p_selection_ids);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bet_id) VALUES
    (v_player_id, v_season_id, v_week_id, false, -p_stake, 'bet_stake', 'Bet placed',         v_bet_id),
    (NULL,        v_season_id, v_week_id, true,   p_stake, 'bet_stake', 'Bet placed (house)', v_bet_id);

  -- Activity Feed: post at most ONE placement event by priority (§3, §10.3).
  -- v_balance here is the pre-bet balance; v_n is the leg count; v_payout is the
  -- total potential payout (the "to win" figure surfaced on the feed card).
  IF p_stake >= GREATEST(250, FLOOR(0.10 * v_balance)) THEN
    -- Big ticket.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_big_ticket_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.big_ticket_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repay_loan(p_loan_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id   uuid;
  v_loan        public.loans;
  v_week_id     uuid;
  v_outstanding integer;
  v_balance     integer;
  v_pin_player  uuid;
  v_pin_house   uuid;
  v_debt_id     uuid;
  v_risk_level  text;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;
  IF v_loan.id IS NULL THEN
    RAISE EXCEPTION 'Loan not found';
  END IF;
  IF v_loan.player_id <> v_player_id THEN
    RAISE EXCEPTION 'Not your loan';
  END IF;
  IF v_loan.status <> 'active' THEN
    RAISE EXCEPTION 'Loan is not active';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Repayment amount must be a positive integer';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
    FROM public.loan_ledger WHERE loan_id = p_loan_id;
  IF p_amount > v_outstanding THEN
    RAISE EXCEPTION 'Repayment exceeds outstanding debt';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger
    WHERE player_id = v_player_id AND season_id = v_loan.season_id;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Repayment exceeds your balance';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_loan.season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_loan.season_id, v_week_id, false, -p_amount, 'loan_manual_repayment', 'Loan repayment')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_loan.season_id, v_week_id, true, p_amount, 'loan_manual_repayment', 'Loan repayment (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_loan_id, v_player_id, v_loan.season_id, v_week_id, -p_amount, 'manual_repayment', 'Loan repayment', v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  IF v_outstanding - p_amount = 0 THEN
    UPDATE public.loans SET status = 'paid_off', paid_off_at = now() WHERE id = p_loan_id;

    -- Activity Feed: full payoff only (§11.1). Partial repayments post nothing.
    -- Vague — public_payload carries ONLY the risk tier (no amounts, §5.5) so the
    -- copy can vary by how dangerous the deal was. Actor = the borrower.
    SELECT risk_level INTO v_risk_level
      FROM public.loan_products WHERE id = v_loan.loan_product_id;

    PERFORM public.publish_activity_event(
      'loan_shark', 'loan_shark_loan_repaid',
      v_loan.season_id, v_week_id, v_player_id, NULL, NULL,
      NULL, p_loan_id,
      'loan_shark.loan_repaid',
      jsonb_build_object('risk_level', v_risk_level),
      jsonb_build_object('loan_id', p_loan_id),
      NULL, now());
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE season_id = v_season_id AND type = 'score_credit'
      AND description LIKE 'Week ' || v_week_number || ' %'
  ) THEN
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    SELECT ts.player_id, v_season_id, p_week_id, s.score, 'score_credit',
           'Week ' || v_week_number || ' Game ' || g.game_number || ': ' || s.score || ' pins'
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id IS NOT NULL
      AND ts.is_fill = false
      AND s.score IS NOT NULL;
  END IF;

  -- Settle every open/closed (non-settled) over_under market in the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    SELECT s.score INTO v_score
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id = v_mkt.subject_player_id
      AND ts.is_fill = false
      AND g.game_number = v_mkt.game_number
      AND s.score IS NOT NULL
    LIMIT 1;

    IF v_score IS NULL THEN
      -- No score -> close without a result (bets stay pending for manual handling).
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  SELECT COALESCE(SUM(amount), 0) INTO v_house_net
    FROM public.pin_ledger
    WHERE is_house = true AND week_id = p_week_id
      AND type IN ('bet_stake','bet_payout','bet_refund');

  -- Idempotency: no source FK exists, so guard on (season, week, event_type).
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_bounty(p_bounty_post_id uuid, p_outcome text, p_admin_settlement_reasoning text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bounty          public.bounty_post;
  v_admin_id        uuid;
  v_hunter_count    int;
  v_R               int;   -- reward per hunter
  v_escrow          int;   -- sponsor escrow held = R * max_hunters
  v_total_stakes    int;   -- SUM(stake_amount) = n * H
  v_total_reward    int;   -- SUM(protected_hunter_profit) = n * R
  v_unused_escrow   int;   -- (max_hunters - n) * R returned to sponsor
  v_total_house_seed int;
  v_total_pot       int;
  v_settlement_id   uuid;
  v_payout_id       uuid;
  v_stake           record;
  v_payout          int;
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
    RETURN;  -- idempotent
  END IF;
  -- Settle at any time: an 'open' or 'closed' bounty may be settled directly.
  IF v_bounty.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Bounty cannot be settled in its current state';
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

  v_R      := v_bounty.reward_per_hunter;
  v_escrow := v_bounty.sponsor_bounty_amount;  -- R * max_hunters
  SELECT COALESCE(SUM(stake_amount), 0), COALESCE(SUM(protected_hunter_profit), 0)
    INTO v_total_stakes, v_total_reward
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_unused_escrow := GREATEST(0, v_escrow - (v_hunter_count * v_R));

  -- House seed = the House subsidy when a House bounty loses to the hunters
  -- (it funds n*R out of pocket). Zero for sponsor bounties (sponsor-funded).
  v_total_house_seed := CASE
    WHEN v_bounty.bounty_type = 'house_bounty' AND p_outcome = 'hunter_win' THEN v_total_reward
    ELSE 0 END;

  -- total_pot = the headline winnings transferred to the winning side.
  v_total_pot := CASE
    WHEN p_outcome = 'hunter_win' THEN v_total_stakes + v_total_reward  -- n*(H+R)
    ELSE v_total_stakes END;                                            -- sponsor_win: n*H

  INSERT INTO public.bounty_settlements (
    bounty_post_id, settlement_outcome, settlement_source,
    total_sponsor_bounty, total_hunter_stakes, total_protected_hunter_profit,
    total_house_seed, total_pot, winner_count,
    settled_by_admin_id, admin_settlement_reasoning
  ) VALUES (
    p_bounty_post_id, p_outcome, 'admin',
    v_escrow, v_total_stakes, v_total_reward,
    v_total_house_seed, v_total_pot,
    CASE WHEN p_outcome = 'sponsor_win' THEN 1 ELSE v_hunter_count END,
    v_admin_id, p_admin_settlement_reasoning
  )
  RETURNING id INTO v_settlement_id;

  IF p_outcome = 'sponsor_win' THEN
    IF v_bounty.bounty_type = 'sponsor_bounty' THEN
      -- Sponsor collects every hunter stake and gets the full escrow back.
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_bounty.sponsor_player_id, false, v_total_stakes + v_escrow)
        RETURNING id INTO v_payout_id;

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_total_stakes + v_escrow,
                'bounty_payout', 'Bounty sponsor won', p_bounty_post_id, v_settlement_id, v_payout_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -(v_total_stakes + v_escrow),
                'bounty_payout', 'Bounty sponsor won (house)', p_bounty_post_id, v_settlement_id, v_payout_id);
    ELSE
      -- House bounty: the House keeps the hunter stakes (reporting-only payout row,
      -- no ledger movement — House-to-House is not ledgered, §22.3).
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, NULL, true, v_total_stakes);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'lost', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;

  ELSE  -- hunter_win
    FOR v_stake IN
      SELECT * FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id
    LOOP
      v_payout := v_stake.stake_amount + v_stake.protected_hunter_profit;  -- H + R (flat)

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

    -- Return the sponsor's unused escrow ((max_hunters - n) * R) for a sponsor bounty.
    IF v_bounty.bounty_type = 'sponsor_bounty' AND v_unused_escrow > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_unused_escrow,
                'bounty_payout', 'Bounty unused escrow returned', p_bounty_post_id, v_settlement_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_unused_escrow,
                'bounty_payout', 'Bounty unused escrow returned (house)', p_bounty_post_id, v_settlement_id);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'won', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;
  END IF;

  UPDATE public.bounty_post SET status = 'settled' WHERE id = p_bounty_post_id;

  IF p_outcome = 'sponsor_win' THEN
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_sponsor_won',
      v_bounty.season_id, v_bounty.week_id,
      CASE WHEN v_bounty.bounty_type = 'sponsor_bounty' THEN v_bounty.sponsor_player_id ELSE NULL END,
      NULL, NULL,
      NULL, NULL,
      'bounty_board.sponsor_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_house_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, now(),
      NULL, p_bounty_post_id);
  ELSE
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_hunters_won',
      v_bounty.season_id, v_bounty.week_id,
      NULL, NULL, NULL,
      NULL, NULL,
      'bounty_board.hunters_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_house_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, now(),
      NULL, p_bounty_post_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_market_internal(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market      public.bet_markets;
  v_bet         record;
  v_leg         record;
  v_odds        numeric;
  v_payout      integer;
  v_pre_balance integer;
  v_won_legs    integer;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type <> 'over_under' THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;

  -- Selection results: over wins above the line, under below; half-point lines
  -- never push, but equality is handled as push for completeness.
  UPDATE public.bet_selections s
    SET result = CASE
      WHEN s.key = 'over'  THEN CASE WHEN p_result_value > s.line THEN 'won'
                                     WHEN p_result_value < s.line THEN 'lost' ELSE 'push' END
      WHEN s.key = 'under' THEN CASE WHEN p_result_value < s.line THEN 'won'
                                     WHEN p_result_value > s.line THEN 'lost' ELSE 'push' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  UPDATE public.bet_markets
    SET result_value = p_result_value, status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  -- Finalize each pending bet that has a leg on this market.
  FOR v_bet IN
    SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake
    FROM public.bets b
    JOIN public.bet_legs       l ON l.bet_id = b.id
    JOIN public.bet_selections s ON s.id = l.selection_id
    WHERE s.market_id = p_market_id AND b.status = 'pending'
  LOOP
    -- Copy result onto every now-resolved leg of this bet (back/lay truth table).
    UPDATE public.bet_legs l
      SET result = CASE
        WHEN sel.result IN ('push', 'void') THEN sel.result
        WHEN l.side = 'back' THEN sel.result
        WHEN l.side = 'lay'  THEN CASE sel.result WHEN 'won' THEN 'lost' WHEN 'lost' THEN 'won' END
      END
      FROM public.bet_selections sel
      WHERE l.bet_id = v_bet.id AND l.selection_id = sel.id AND sel.result IS NOT NULL;

    -- A leg still unresolved (other market of a parlay) -> leave bet pending.
    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result IS NULL) THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') THEN
      -- Lost: stake already debited / house already holds it. No ledger.
      UPDATE public.bets SET status = 'lost', settled_at = now() WHERE id = v_bet.id;

    ELSIF NOT EXISTS (
      SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result NOT IN ('push', 'void')
    ) THEN
      -- All legs push/void -> refund the stake (double-entry).
      UPDATE public.bets SET status = 'push', settled_at = now() WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, v_market.week_id, false,  v_bet.stake, 'bet_refund', 'Push refund',         v_bet.id),
        (NULL,            v_bet.season_id, v_market.week_id, true,  -v_bet.stake, 'bet_refund', 'Push refund (house)', v_bet.id);

    ELSE
      -- Won: payout = floor(stake x product(won-leg odds)). Numeric multiply (no
      -- float error). Push/void legs drop out of the product.
      v_odds := 1;
      FOR v_leg IN
        SELECT odds_at_placement FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'won'
      LOOP
        v_odds := v_odds * v_leg.odds_at_placement;
      END LOOP;
      v_payout := FLOOR(v_bet.stake * v_odds);

      -- Capture pre-settlement balance BEFORE the payout pair is written (§3 big-win).
      SELECT COALESCE(SUM(amount), 0) INTO v_pre_balance
        FROM public.pin_ledger
        WHERE player_id = v_bet.player_id AND season_id = v_bet.season_id;

      UPDATE public.bets
        SET status = 'won', potential_payout = v_payout, settled_at = now()
        WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, v_market.week_id, false,  v_payout, 'bet_payout', 'Bet won',         v_bet.id),
        (NULL,            v_bet.season_id, v_market.week_id, true,  -v_payout, 'bet_payout', 'Bet won (house)', v_bet.id);

      -- Activity Feed: post at most ONE win event (§3, §10.3). Parlay-hit takes
      -- priority over big-win; an ordinary single-leg win posts nothing.
      SELECT count(*) INTO v_won_legs
        FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'won';

      IF v_won_legs > 1 THEN
        PERFORM public.publish_activity_event(
          'sportsbook', 'sportsbook_parlay_hit',
          v_bet.season_id, v_market.week_id, v_bet.player_id, NULL, NULL,
          v_bet.id, NULL,
          'sportsbook.parlay_hit',
          jsonb_build_object('stake', v_bet.stake, 'payout', v_payout,
                             'profit', v_payout - v_bet.stake, 'legs', v_won_legs),
          jsonb_build_object('bet_id', v_bet.id, 'market_id', p_market_id),
          NULL, now());
      ELSIF v_payout >= 500 OR (v_payout - v_bet.stake) >= FLOOR(0.20 * v_pre_balance) THEN
        PERFORM public.publish_activity_event(
          'sportsbook', 'sportsbook_big_win',
          v_bet.season_id, v_market.week_id, v_bet.player_id, NULL, NULL,
          v_bet.id, NULL,
          'sportsbook.big_win',
          jsonb_build_object('stake', v_bet.stake, 'payout', v_payout,
                             'profit', v_payout - v_bet.stake, 'legs', v_won_legs),
          jsonb_build_object('bet_id', v_bet.id, 'market_id', p_market_id),
          NULL, now());
      -- else: ordinary single-leg win is not feed-worthy (§10.4). No bad_beat in v1.
      END IF;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_pvp_challenge(p_challenge_id uuid, p_source text, p_winner_player_id uuid, p_admin_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      NULL, now(),
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
    NULL, now(),
    p_challenge_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.take_loan(p_loan_product_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_product   public.loan_products;
  v_used      integer;
  v_loan_id   uuid;
  v_pin_player uuid;
  v_pin_house  uuid;
  v_debt_id    uuid;
BEGIN
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  SELECT * INTO v_product FROM public.loan_products WHERE id = p_loan_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Loan product not found';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'Loan product is not available';
  END IF;
  IF v_product.season_id IS NOT NULL AND v_product.season_id <> v_season_id THEN
    RAISE EXCEPTION 'Loan product is not available this season';
  END IF;
  IF v_product.available_from IS NOT NULL AND now() < v_product.available_from THEN
    RAISE EXCEPTION 'Loan product is not yet available';
  END IF;
  IF v_product.available_until IS NOT NULL AND now() > v_product.available_until THEN
    RAISE EXCEPTION 'Loan product is no longer available';
  END IF;
  IF v_product.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.loans WHERE loan_product_id = p_loan_product_id;
    IF v_used >= v_product.max_uses THEN
      RAISE EXCEPTION 'Loan product has reached its usage limit';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE player_id = v_player_id AND season_id = v_season_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You already have an active loan this season';
  END IF;

  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  INSERT INTO public.loans (player_id, season_id, loan_product_id, status)
    VALUES (v_player_id, v_season_id, p_loan_product_id, 'active')
    RETURNING id INTO v_loan_id;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_player_id, v_season_id, v_week_id, false, v_product.borrow_amount, 'loan_issued', 'Loan issued: ' || v_product.display_name)
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_season_id, v_week_id, true, -v_product.borrow_amount, 'loan_issued', 'Loan issued (house): ' || v_product.display_name)
    RETURNING id INTO v_pin_house;

  INSERT INTO public.loan_ledger (loan_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (v_loan_id, v_player_id, v_season_id, v_week_id, v_product.borrow_amount, 'loan_issued',
            'Loan issued: ' || v_product.display_name, v_pin_player)
    RETURNING id INTO v_debt_id;

  UPDATE public.pin_ledger SET loan_ledger_id = v_debt_id WHERE id IN (v_pin_player, v_pin_house);

  -- Activity Feed: vague loan-taken event. public_payload carries ONLY the risk
  -- tier (no amount/rate/product, §11.1, §5.5) so the copy can hint at the kind
  -- of deal. Operational detail lives in admin_payload.
  PERFORM public.publish_activity_event(
    'loan_shark', 'loan_shark_loan_taken',
    v_season_id, v_week_id, v_player_id, NULL, NULL,
    NULL, v_loan_id,
    'loan_shark.loan_taken',
    jsonb_build_object('risk_level', v_product.risk_level),
    jsonb_build_object('loan_id', v_loan_id, 'loan_product_id', p_loan_product_id),
    NULL, now());

  RETURN v_loan_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. create_system_activity_event — drop p_importance (signature change → DROP +
--    CREATE). Importance for system posts is now derived from event_type in the
--    app like everything else. Re-issue grants (DROP loses them).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_system_activity_event(text, text, text, jsonb, text);

CREATE FUNCTION public.create_system_activity_event(
  p_source_feature text,
  p_event_type     text,
  p_template_key   text,
  p_public_payload jsonb
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_season_id uuid;
  v_week_id   uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  -- Week is optional — latest non-archived week of the current season.
  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  RETURN public.publish_activity_event(
    p_source_feature, p_event_type,
    v_season_id, v_week_id, NULL, NULL, NULL, NULL, NULL,
    p_template_key, p_public_payload, '{}'::jsonb,
    'public', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_system_activity_event(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_system_activity_event(text, text, text, jsonb) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. Drop the importance column. This also drops activity_feed_events_importance_idx.
--    Safe: not referenced by RLS, other constraints, or remaining indexes.
-- ----------------------------------------------------------------------------
ALTER TABLE public.activity_feed_events DROP COLUMN importance;
