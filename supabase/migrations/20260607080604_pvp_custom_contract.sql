-- ============================================================================
-- PvP Challenge Contracts — add the "custom" contract type.
-- ============================================================================
-- A custom contract is week-level / free-form: the creator writes their own
-- title + win-condition description, and an admin settles it by hand (there is
-- no automatic scoring). settle_pvp_for_week already filters auto-settlement to
-- line_duel/prop_duel/raw_score_duel, so custom contracts are naturally skipped
-- by week settlement and only ever resolved by the admin tool.
-- ============================================================================


-- 1. Schema: dedicated title + description columns, and widen the type CHECK.
ALTER TABLE public.pvp_challenges
  ADD COLUMN IF NOT EXISTS custom_title       text NULL,
  ADD COLUMN IF NOT EXISTS custom_description text NULL;

ALTER TABLE public.pvp_challenges
  DROP CONSTRAINT IF EXISTS pvp_challenges_contract_type_check;
ALTER TABLE public.pvp_challenges
  ADD CONSTRAINT pvp_challenges_contract_type_check
  CHECK (contract_type IN ('line_duel', 'prop_duel', 'raw_score_duel', 'custom'));


-- ============================================================================
-- 2. create_pvp_challenge — append custom title/description params.
-- ============================================================================
-- Signature changes (8 → 10 args), so drop the old form first.
DROP FUNCTION IF EXISTS public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_pvp_challenge(
  p_contract_type          text,
  p_counterparty_player_id uuid,       -- NULL = open-board
  p_week_id                uuid,
  p_game_number            int,
  p_stake                  int,
  p_prop_market_id         uuid,
  p_creator_selection      text,
  p_message                text,
  p_custom_title           text,       -- custom only
  p_custom_description     text        -- custom only
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_creator_id            uuid;
  v_season_id             uuid;
  v_week                  record;
  v_total_pot             int;
  v_counterparty_sel      text;
  v_subject_player_id     uuid;
  v_game_number           int;
  v_challenge_id          uuid;
  v_market                record;
BEGIN
  -- 1. Resolve caller.
  SELECT id INTO v_creator_id FROM public.players WHERE user_id = auth.uid();
  IF v_creator_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  -- 2. Resolve current season and validate week.
  SELECT id INTO v_season_id FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  SELECT * INTO v_week FROM public.weeks WHERE id = p_week_id;
  IF v_week.id IS NULL OR v_week.season_id <> v_season_id THEN
    RAISE EXCEPTION 'Week not found in current season';
  END IF;
  IF v_week.is_archived THEN
    RAISE EXCEPTION 'Cannot create a contract for an archived week';
  END IF;

  -- 3. Validate stake.
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins';
  END IF;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_creator_id AND season_id = v_season_id;
    IF v_balance < p_stake THEN
      RAISE EXCEPTION 'Insufficient balance for the requested stake';
    END IF;
  END;

  -- 4. Validate counterparty and contract-type scope.
  IF p_counterparty_player_id IS NOT NULL THEN
    IF p_counterparty_player_id = v_creator_id THEN
      RAISE EXCEPTION 'Cannot challenge yourself';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_counterparty_player_id) THEN
      RAISE EXCEPTION 'Counterparty player not found';
    END IF;
  END IF;

  v_game_number := p_game_number;

  IF p_contract_type IN ('line_duel', 'raw_score_duel') THEN
    IF p_game_number IS NULL OR p_game_number < 1 THEN
      RAISE EXCEPTION 'game_number is required for line_duel and raw_score_duel';
    END IF;
  ELSIF p_contract_type = 'prop_duel' THEN
    IF p_prop_market_id IS NULL THEN
      RAISE EXCEPTION 'prop_market_id is required for prop_duel';
    END IF;
    SELECT * INTO v_market
      FROM public.bet_markets
      WHERE id = p_prop_market_id;
    IF v_market.id IS NULL THEN
      RAISE EXCEPTION 'Prop market not found';
    END IF;
    IF v_market.status <> 'open' THEN
      RAISE EXCEPTION 'Prop market is not open';
    END IF;
    IF p_creator_selection IS NULL THEN
      RAISE EXCEPTION 'creator_selection is required for prop_duel';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key = p_creator_selection
    ) THEN
      RAISE EXCEPTION 'creator_selection is not a valid key for this market';
    END IF;
    SELECT key INTO v_counterparty_sel
      FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key <> p_creator_selection
      LIMIT 1;
    IF v_counterparty_sel IS NULL THEN
      RAISE EXCEPTION 'Could not derive counterparty selection for prop_duel';
    END IF;
    v_subject_player_id := v_market.subject_player_id;
  ELSIF p_contract_type = 'custom' THEN
    -- Free-form, week-level: no game, no market. The win condition is the text.
    IF p_custom_title IS NULL OR length(trim(p_custom_title)) = 0
       OR p_custom_description IS NULL OR length(trim(p_custom_description)) = 0 THEN
      RAISE EXCEPTION 'Custom contracts require a title and a win-condition description';
    END IF;
    v_game_number := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- 5. Compute financials and insert challenge. Winner takes the whole pot.
  v_total_pot := p_stake * 2;

  INSERT INTO public.pvp_challenges (
    contract_type, status, creator_player_id, counterparty_player_id,
    season_id, week_id, game_number,
    creator_stake, counterparty_stake, total_pot, payout_amount,
    prop_market_id, creator_selection, counterparty_selection, subject_player_id,
    creator_message, custom_title, custom_description
  ) VALUES (
    p_contract_type, 'pending', v_creator_id, p_counterparty_player_id,
    v_season_id, p_week_id, v_game_number,
    p_stake, p_stake, v_total_pot, v_total_pot,
    p_prop_market_id, p_creator_selection, v_counterparty_sel, v_subject_player_id,
    p_message,
    CASE WHEN p_contract_type = 'custom' THEN trim(p_custom_title)       ELSE NULL END,
    CASE WHEN p_contract_type = 'custom' THEN trim(p_custom_description) ELSE NULL END
  ) RETURNING id INTO v_challenge_id;

  -- 6. Insert the original offer (offer_no = 1, snapshot of terms).
  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    v_challenge_id, v_creator_id, 1, p_contract_type,
    p_stake, p_stake, v_game_number,
    p_prop_market_id, p_creator_selection, v_counterparty_sel,
    p_message
  );

  RETURN v_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text, text, text) TO authenticated;


-- ============================================================================
-- 3. counter_pvp_challenge — accept 'custom' in the scope check (no game/market).
-- ============================================================================
-- Title/description stay on the challenge row; counters only renegotiate stake.
CREATE OR REPLACE FUNCTION public.counter_pvp_challenge(
  p_challenge_id   uuid,
  p_stake          int,
  p_contract_type  text,
  p_game_number    int,
  p_prop_market_id uuid,
  p_selection      text,
  p_message        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id         uuid;
  v_challenge         public.pvp_challenges;
  v_offer             record;
  v_next_offer_no     int;
  v_total_pot         int;
  v_counterparty_sel  text;
  v_subject_id        uuid;
  v_game_number       int;
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
    RAISE EXCEPTION 'Challenge is not in a negotiable state';
  END IF;
  IF v_challenge.counterparty_player_id IS NOT NULL
     AND v_caller_id <> v_challenge.creator_player_id
     AND v_caller_id <> v_challenge.counterparty_player_id THEN
    RAISE EXCEPTION 'You are not a party to this challenge';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot counter your own offer — wait for the other party';
  END IF;

  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins';
  END IF;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_caller_id AND season_id = v_challenge.season_id;
    IF v_balance < p_stake THEN
      RAISE EXCEPTION 'Insufficient balance for the requested stake';
    END IF;
  END;

  v_game_number := p_game_number;

  IF p_contract_type IN ('line_duel', 'raw_score_duel') THEN
    IF p_game_number IS NULL OR p_game_number < 1 THEN
      RAISE EXCEPTION 'game_number is required for line_duel and raw_score_duel';
    END IF;
    v_counterparty_sel := NULL;
    v_subject_id       := NULL;
  ELSIF p_contract_type = 'prop_duel' THEN
    IF p_prop_market_id IS NULL THEN
      RAISE EXCEPTION 'prop_market_id is required for prop_duel';
    END IF;
    IF p_selection IS NULL THEN
      RAISE EXCEPTION 'selection is required for prop_duel';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets WHERE id = p_prop_market_id AND status = 'open'
    ) THEN
      RAISE EXCEPTION 'Prop market not found or not open';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_selections WHERE market_id = p_prop_market_id AND key = p_selection
    ) THEN
      RAISE EXCEPTION 'selection is not a valid key for this market';
    END IF;
    SELECT key INTO v_counterparty_sel
      FROM public.bet_selections
      WHERE market_id = p_prop_market_id AND key <> p_selection LIMIT 1;
    SELECT subject_player_id INTO v_subject_id
      FROM public.bet_markets WHERE id = p_prop_market_id;
  ELSIF p_contract_type = 'custom' THEN
    -- Free-form: no game/market. Title/description remain as the creator set them.
    v_counterparty_sel := NULL;
    v_subject_id       := NULL;
    v_game_number      := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- Winner takes the whole pot.
  v_total_pot := p_stake * 2;
  v_next_offer_no := v_offer.offer_no + 1;

  UPDATE public.pvp_challenge_offers SET superseded_at = now() WHERE id = v_offer.id;

  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    p_challenge_id, v_caller_id, v_next_offer_no, p_contract_type,
    p_stake, p_stake, v_game_number,
    p_prop_market_id, p_selection, v_counterparty_sel,
    p_message
  );

  UPDATE public.pvp_challenges SET
    status                 = 'countered',
    contract_type          = p_contract_type,
    creator_stake          = p_stake,
    counterparty_stake     = p_stake,
    total_pot              = v_total_pot,
    payout_amount          = v_total_pot,
    game_number            = v_game_number,
    prop_market_id         = p_prop_market_id,
    creator_selection      = CASE WHEN p_contract_type = 'prop_duel' THEN p_selection        ELSE NULL END,
    counterparty_selection = CASE WHEN p_contract_type = 'prop_duel' THEN v_counterparty_sel ELSE NULL END,
    subject_player_id      = v_subject_id,
    counterparty_player_id = CASE
      WHEN v_challenge.counterparty_player_id IS NULL AND v_caller_id <> v_challenge.creator_player_id
        THEN v_caller_id
      ELSE v_challenge.counterparty_player_id
    END
  WHERE id = p_challenge_id;

  RETURN p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.counter_pvp_challenge(uuid, int, text, int, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.counter_pvp_challenge(uuid, int, text, int, uuid, text, text) TO authenticated;


-- ============================================================================
-- 4. settle_pvp_challenge — guard custom against a NULL-winner payout.
-- ============================================================================
-- Custom contracts have no automatic scoring. An admin settles them by supplying
-- an explicit winner (the override path), or refunds both via void_pvp_challenge.
-- Without an explicit winner there is nothing to compute — raise rather than fall
-- through to the winner-payout path with a NULL winner.
CREATE OR REPLACE FUNCTION public.settle_pvp_challenge(
  p_challenge_id      uuid,
  p_source            text,    -- 'automatic' or 'admin'
  p_winner_player_id  uuid,    -- NULL = compute; supplied for admin override
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
    IF v_challenge.contract_type IN ('line_duel', 'raw_score_duel') THEN
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
        v_result_detail := jsonb_build_object(
          'creator_score', v_creator_score, 'counterparty_score', v_cparty_score
        );
        IF v_creator_score > v_cparty_score THEN
          v_winner_id := v_challenge.creator_player_id;
        ELSIF v_cparty_score > v_creator_score THEN
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
      -- No automatic scoring. The admin must pick a winner, or void to refund.
      RAISE EXCEPTION 'Custom contracts must be settled with an explicit winner, or voided';
    END IF;
  END IF;

  -- Void path: refund stakes.
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_pvp_challenge(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_pvp_challenge(uuid, text, uuid, text) TO authenticated;
