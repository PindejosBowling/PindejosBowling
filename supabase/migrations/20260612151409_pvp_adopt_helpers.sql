-- Batch C: PvP RPCs adopt the shared helpers (TODO_DB_CONSOLIDATION §2,
-- TODO_DB_FUNCTION_HYGIENE §1 adoption).
--
-- accept_pvp_challenge, settle_pvp_challenge, void_pvp_challenge rewritten to
-- use current_player_id() / assert_admin() / pin_balance() and
-- pin_ledger_double_entry(). Ledger output is byte-identical to the old
-- bodies — proven by the rollback-probe (supabase/verify/probe-pvp.sql).

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
  v_pin_p1_player  uuid;
  v_pin_p1_house   uuid;
  v_pin_p2_player  uuid;
  v_pin_p2_house   uuid;
  v_pvp_stake1     uuid;
  v_pvp_stake2     uuid;
  v_counterparty   uuid;
BEGIN
  v_caller_id := public.current_player_id();

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

  IF public.pin_balance(v_challenge.creator_player_id, v_challenge.season_id) < v_challenge.creator_stake THEN
    RAISE EXCEPTION 'Creator has insufficient balance';
  END IF;

  IF public.pin_balance(v_counterparty, v_challenge.season_id) < v_challenge.counterparty_stake THEN
    RAISE EXCEPTION 'Counterparty has insufficient balance';
  END IF;

  -- Escrow creator's stake (double-entry: player -stake, house +stake).
  SELECT player_entry_id, house_entry_id INTO v_pin_p1_player, v_pin_p1_house
    FROM public.pin_ledger_double_entry(
      v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
      -v_challenge.creator_stake, 'pvp_stake', 'PvP challenge stake escrowed');

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_challenge.creator_player_id, v_challenge.season_id, v_challenge.week_id,
            -v_challenge.creator_stake, 'stake', 'Creator stake escrowed', v_pin_p1_player)
    RETURNING id INTO v_pvp_stake1;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_stake1 WHERE id IN (v_pin_p1_player, v_pin_p1_house);

  -- Escrow counterparty's stake.
  SELECT player_entry_id, house_entry_id INTO v_pin_p2_player, v_pin_p2_house
    FROM public.pin_ledger_double_entry(
      v_counterparty, v_challenge.season_id, v_challenge.week_id,
      -v_challenge.counterparty_stake, 'pvp_stake', 'PvP challenge stake escrowed');

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
    PERFORM public.assert_admin();
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
        SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
          FROM public.pin_ledger_double_entry(
            v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
            -v_stake_row.amount, 'pvp_refund', 'PvP push — stake refunded');

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
  SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
    FROM public.pin_ledger_double_entry(
      v_winner_id, v_challenge.season_id, v_challenge.week_id,
      v_challenge.total_pot, 'pvp_payout', 'PvP challenge won');

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

CREATE OR REPLACE FUNCTION public.void_pvp_challenge(p_challenge_id uuid, p_admin_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_challenge  public.pvp_challenges;
  v_row        record;
  v_pin_player uuid;
  v_pin_house  uuid;
  v_pvp_id     uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('locked', 'settled') THEN
    RAISE EXCEPTION 'Can only void a locked or settled challenge';
  END IF;

  -- If already settled, reverse the payout movement first (player + house pair).
  IF v_challenge.status = 'settled' THEN
    FOR v_row IN
      SELECT * FROM public.pvp_ledger
      WHERE challenge_id = p_challenge_id
        AND type = 'payout'
        AND player_id IS NOT NULL
    LOOP
      SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
        FROM public.pin_ledger_double_entry(
          v_row.player_id, v_row.season_id, v_row.week_id,
          -v_row.amount, 'pvp_refund', 'PvP void — settlement reversed');

      INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
        VALUES (p_challenge_id, v_row.player_id, v_row.season_id, v_row.week_id,
                -v_row.amount, 'refund', 'Settlement reversal', v_pin_player)
        RETURNING id INTO v_pvp_id;

      UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
    END LOOP;
  END IF;

  -- Refund each player's stake (player +stake, house -stake).
  FOR v_row IN
    SELECT * FROM public.pvp_ledger
    WHERE challenge_id = p_challenge_id AND type = 'stake' AND player_id IS NOT NULL
  LOOP
    SELECT player_entry_id, house_entry_id INTO v_pin_player, v_pin_house
      FROM public.pin_ledger_double_entry(
        v_row.player_id, v_row.season_id, v_row.week_id,
        -v_row.amount, 'pvp_refund', 'PvP challenge voided — stake refunded');

    INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
      VALUES (p_challenge_id, v_row.player_id, v_row.season_id, v_row.week_id,
              -v_row.amount, 'refund', 'Void refund', v_pin_player)
      RETURNING id INTO v_pvp_id;

    UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
  END LOOP;

  UPDATE public.pvp_challenges SET
    status     = 'voided',
    admin_note = p_admin_note,
    settled_at = now()
  WHERE id = p_challenge_id;
END;
$function$;
