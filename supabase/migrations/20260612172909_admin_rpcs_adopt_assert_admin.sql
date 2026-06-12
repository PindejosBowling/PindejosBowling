-- Admin-tools batch: remaining RPCs adopt assert_admin()/is_admin()
-- (TODO_DB_FUNCTION_HYGIENE §1, final adoption batch).
--
-- GENERATED from the live catalog (pg_get_functiondef): the only edits are
--   inline 'IF (jwt role) <> admin THEN RAISE' block → PERFORM public.assert_admin();
--   inline '(jwt role) = admin' boolean             → public.is_admin()
-- 16 functions; bodies otherwise byte-identical. The boolean swap preserves
-- exact semantics including NULL propagation. After this, zero functions
-- carry the inline JWT expression — is_admin() is the single definition.

CREATE OR REPLACE FUNCTION public.cancel_bet(p_bet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market_ids uuid[];
  v_mid        uuid;
BEGIN
  PERFORM public.assert_admin();

  -- Markets this bet touched (captured before the bet is deleted).
  SELECT ARRAY_AGG(DISTINCT s.market_id) INTO v_market_ids
  FROM public.bet_legs l
  JOIN public.bet_selections s ON s.id = l.selection_id
  WHERE l.bet_id = p_bet_id;

  DELETE FROM public.pin_ledger WHERE bet_id = p_bet_id;
  DELETE FROM public.bets WHERE id = p_bet_id;

  -- Re-open any settled market that now has no bets at all.
  IF v_market_ids IS NOT NULL THEN
    FOREACH v_mid IN ARRAY v_market_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        WHERE s.market_id = v_mid
      ) AND EXISTS (
        SELECT 1 FROM public.bet_markets WHERE id = v_mid AND status = 'settled'
      ) THEN
        UPDATE public.bet_markets
          SET status = 'open', result_value = NULL, settled_at = NULL
          WHERE id = v_mid;
        UPDATE public.bet_selections SET result = NULL WHERE market_id = v_mid;
      END IF;
    END LOOP;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_bounty(p_bounty_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bounty public.bounty_post;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  -- Delete all bounty pin rows first (they are ON DELETE CASCADE against
  -- bounty_post, but deleting by bounty_post_id catches both sides of every pair
  -- regardless of the granular FK columns).
  DELETE FROM public.pin_ledger WHERE bounty_post_id = p_bounty_post_id;

  -- Delete the root; hunter_stakes, settlements, payouts, and activity_feed_events
  -- rows all cascade ON DELETE CASCADE from bounty_post.
  DELETE FROM public.bounty_post WHERE id = p_bounty_post_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_loan(p_loan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();

  DELETE FROM public.pin_ledger
   WHERE loan_ledger_id IN (SELECT id FROM public.loan_ledger WHERE loan_id = p_loan_id);

  DELETE FROM public.loan_ledger WHERE loan_id = p_loan_id;
  DELETE FROM public.loans WHERE id = p_loan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_pvp_challenge(p_challenge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_challenge public.pvp_challenges;
  v_is_admin  boolean;
  v_caller    uuid;
BEGIN
  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  v_is_admin := public.is_admin();

  -- Player path: must be the author, and the contract must still be open. Admins
  -- bypass both checks (they can cancel pending/countered/locked contracts).
  IF NOT v_is_admin THEN
    SELECT id INTO v_caller FROM public.players WHERE user_id = auth.uid();
    IF v_challenge.creator_player_id <> v_caller THEN
      RAISE EXCEPTION 'Not your challenge';
    END IF;
    IF v_challenge.status NOT IN ('pending', 'countered') THEN
      RAISE EXCEPTION 'Only open challenges can be cancelled';
    END IF;
  END IF;

  -- Delete the escrow pin rows (both player + house sides) linked through this
  -- challenge's pvp_ledger entries. pin_ledger.pvp_ledger_id is ON DELETE SET
  -- NULL, so these must go before the contract is removed or they orphan.
  DELETE FROM public.pin_ledger
    WHERE pvp_ledger_id IN (
      SELECT id FROM public.pvp_ledger WHERE challenge_id = p_challenge_id
    );

  -- Delete the contract; pvp_ledger and pvp_challenge_offers cascade.
  DELETE FROM public.pvp_challenges WHERE id = p_challenge_id;
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
  PERFORM public.assert_admin();

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

CREATE OR REPLACE FUNCTION public.close_open_pvp_challenges(p_week_id uuid, p_game_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();

  -- Stamp the live offer for each in-scope challenge as declined.
  UPDATE public.pvp_challenge_offers o
    SET declined_at = now()
    WHERE o.superseded_at IS NULL AND o.accepted_at IS NULL AND o.declined_at IS NULL
      AND o.challenge_id IN (
        SELECT c.id FROM public.pvp_challenges c
        WHERE c.week_id = p_week_id
          AND c.status IN ('pending', 'countered')
          AND (p_game_number IS NULL OR c.game_number = p_game_number)
      );

  -- Close the challenges themselves.
  UPDATE public.pvp_challenges c
    SET status = 'cancelled'
    WHERE c.week_id = p_week_id
      AND c.status IN ('pending', 'countered')
      AND (p_game_number IS NULL OR c.game_number = p_game_number);
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
  PERFORM public.assert_admin();

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

CREATE OR REPLACE FUNCTION public.create_system_activity_event(p_source_feature text, p_event_type text, p_template_key text, p_public_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id uuid;
  v_week_id   uuid;
BEGIN
  PERFORM public.assert_admin();

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

CREATE OR REPLACE FUNCTION public.playoff_create_draft(p_season_id uuid, p_week_id uuid, p_draft_type text, p_captain_player_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft_id uuid;
  v_i        integer;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can create a playoff draft';
  END IF;

  IF array_length(p_captain_player_ids, 1) IS NULL OR array_length(p_captain_player_ids, 1) < 2 THEN
    RAISE EXCEPTION 'At least 2 captains are required';
  END IF;
  IF (SELECT count(DISTINCT c) FROM unnest(p_captain_player_ids) c)
     <> array_length(p_captain_player_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate captain';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM weeks WHERE id = p_week_id AND season_id = p_season_id AND is_archived = false) THEN
    RAISE EXCEPTION 'Playoff week must be an unarchived week of the season';
  END IF;

  INSERT INTO playoff_drafts (season_id, week_id, draft_type)
    VALUES (p_season_id, p_week_id, COALESCE(p_draft_type, 'snake'))
    RETURNING id INTO v_draft_id;

  FOR v_i IN 1 .. array_length(p_captain_player_ids, 1) LOOP
    INSERT INTO playoff_draft_captains (draft_id, player_id, seed)
      VALUES (v_draft_id, p_captain_player_ids[v_i], v_i);
  END LOOP;

  INSERT INTO playoff_draft_pool (draft_id, player_id)
    SELECT v_draft_id, r.player_id
      FROM registrations r
      JOIN players p ON p.id = r.player_id AND p.is_active = true
     WHERE r.season_id = p_season_id
       AND r.player_id <> ALL (p_captain_player_ids);

  UPDATE weeks SET is_playoff = true, updated_at = now() WHERE id = p_week_id;

  RETURN v_draft_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_over_under_markets_for_game(p_week_id uuid, p_game_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();

  -- Refund (delete both ledger rows of) every bet with a leg on this game's markets.
  DELETE FROM public.pin_ledger
    WHERE bet_id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = p_game_number
    );

  -- Delete those bets (cascades to their bet_legs across all of the parlay's games).
  DELETE FROM public.bets
    WHERE id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = p_game_number
    );

  -- Drop the markets themselves (cascades to bet_selections).
  DELETE FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
      AND m.game_number = p_game_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_activity_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();

  UPDATE public.activity_feed_events
    SET status = 'published',
        suppressed_by_admin_id = NULL,
        suppressed_at = NULL,
        suppression_reason = NULL
    WHERE id = p_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_lanetalk_props_for_week(p_week_id uuid, p_void_missing boolean DEFAULT false)
 RETURNS TABLE(settled integer, voided integer, left_pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt        record;
  v_stat       text;
  v_value      numeric;
  v_official_n integer;
  v_scored_n   integer;
  v_settled    integer := 0;
  v_voided     integer := 0;
  v_pending    integer := 0;
BEGIN
  PERFORM public.assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_mkt IN
    SELECT id, subject_player_id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id
      AND market_type = 'prop'
      AND params ->> 'source' = 'lanetalk'
      AND status IN ('open', 'closed')
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_stat NOT IN ('strikes', 'spares', 'clean_frames', 'clean_pct', 'first_ball_avg') THEN
      RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
    END IF;

    IF (v_mkt.params ->> 'scope') = 'game' THEN
      -- Per-game: the player's official import for this exact game.
      SELECT CASE v_stat
               WHEN 'strikes'        THEN st.strikes::numeric
               WHEN 'spares'         THEN st.spares::numeric
               WHEN 'clean_frames'   THEN (st.strikes + st.spares)::numeric
               WHEN 'clean_pct'      THEN st.clean_pct
               WHEN 'first_ball_avg' THEN st.first_ball_avg
             END
        INTO v_value
      FROM public.lanetalk_game_imports i
      CROSS JOIN LATERAL public.lanetalk_game_stats(i.payload) st
      WHERE i.week_id = p_week_id
        AND i.player_id = v_mkt.subject_player_id
        AND i.game_number = v_mkt.game_number
        AND i.classification = 'official'
      LIMIT 1;
    ELSE
      -- Night: only settle off a COMPLETE night — official imports must cover
      -- every game the player has a recorded score for.
      SELECT count(*) INTO v_official_n
      FROM public.lanetalk_game_imports i
      WHERE i.week_id = p_week_id
        AND i.player_id = v_mkt.subject_player_id
        AND i.classification = 'official';

      SELECT count(*) INTO v_scored_n
      FROM public.scores s
      JOIN public.games g       ON g.id = s.game_id
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;

      IF v_official_n > 0 AND v_official_n >= v_scored_n THEN
        -- Frame-level aggregate across the night (totals, not per-game means).
        SELECT CASE v_stat
                 WHEN 'strikes'        THEN SUM(st.strikes)::numeric
                 WHEN 'spares'         THEN SUM(st.spares)::numeric
                 WHEN 'clean_frames'   THEN (SUM(st.strikes) + SUM(st.spares))::numeric
                 WHEN 'clean_pct'      THEN SUM(st.clean_pct * st.frames) / NULLIF(SUM(st.frames), 0)
                 WHEN 'first_ball_avg' THEN SUM(st.first_ball_avg * st.frames) / NULLIF(SUM(st.frames), 0)
               END
          INTO v_value
        FROM public.lanetalk_game_imports i
        CROSS JOIN LATERAL (
          SELECT g.strikes, g.spares, g.clean_pct, g.first_ball_avg,
                 jsonb_array_length(COALESCE(i.payload -> 'frames', '[]'::jsonb)) AS frames
          FROM public.lanetalk_game_stats(i.payload) g
        ) st
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.classification = 'official'
          AND st.frames > 0;
      END IF;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      -- Delete-refund rail: refund_bets_before_market_delete refunds every
      -- touched bet whole (incl. parlays spanning other markets).
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_settled, v_voided, v_pending;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_market(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();
  PERFORM public.settle_market_internal(p_market_id, p_result_value);
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_moneyline_market(p_market_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();
  PERFORM public.settle_moneyline_market_internal(p_market_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_pvp_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contract record;
BEGIN
  PERFORM public.assert_admin();

  -- Close any still-open negotiations for the whole week (the clock-based expiry
  -- sweep is gone; nothing else closes stale pending/countered contracts now).
  PERFORM public.close_open_pvp_challenges(p_week_id, NULL);

  -- Auto-settle every locked auto-settleable contract for this week.
  FOR v_contract IN
    SELECT id FROM public.pvp_challenges
    WHERE week_id = p_week_id
      AND status = 'locked'
      AND contract_type IN ('line_duel', 'prop_duel', 'head_to_head')
  LOOP
    PERFORM public.settle_pvp_challenge(v_contract.id, 'automatic', NULL, NULL);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.suppress_activity_event(p_event_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();

  UPDATE public.activity_feed_events
    SET status = 'suppressed',
        suppressed_by_admin_id = v_admin_id,
        suppressed_at = now(),
        suppression_reason = p_reason
    WHERE id = p_event_id;
END;
$function$;

