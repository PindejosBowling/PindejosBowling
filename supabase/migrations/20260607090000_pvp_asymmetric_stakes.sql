-- ============================================================================
-- PvP Challenge Contracts — asymmetric (per-player) stakes.
-- ============================================================================
-- Until now every contract forced symmetric stakes: both sides put up the same
-- number of pins (the create/counter RPCs took a single p_stake and wrote it to
-- both creator_stake and counterparty_stake). The schema already stores the two
-- stakes separately, and accept_pvp_challenge already validates each side's
-- balance against its own stake, escrows each independently, and computes
-- total_pot = creator_stake + counterparty_stake — so the symmetry lived only in
-- these two RPCs.
--
-- This migration splits the single stake param into p_creator_stake +
-- p_counterparty_stake. Contracts still default to equal stakes at the app layer;
-- this just lets each side stake a different amount (useful for custom contracts
-- and for balancing the EV of raw-score duels between mismatched players).
-- accept_pvp_challenge and settle_pvp_challenge are unchanged.
-- ============================================================================


-- ============================================================================
-- 1. create_pvp_challenge — per-side stakes.
-- ============================================================================
-- Signature changes (10 → 11 args), so drop the old form first.
DROP FUNCTION IF EXISTS public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_pvp_challenge(
  p_contract_type          text,
  p_counterparty_player_id uuid,       -- NULL = open-board
  p_week_id                uuid,
  p_game_number            int,
  p_creator_stake          int,
  p_counterparty_stake     int,
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

  -- 3. Validate stakes. Both sides must clear the 10-pin floor; only the creator's
  --    balance is checked here (the counterparty's is checked at accept time).
  IF p_creator_stake IS NULL OR p_creator_stake < 10
     OR p_counterparty_stake IS NULL OR p_counterparty_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins per side';
  END IF;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_creator_id AND season_id = v_season_id;
    IF v_balance < p_creator_stake THEN
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
  v_total_pot := p_creator_stake + p_counterparty_stake;

  INSERT INTO public.pvp_challenges (
    contract_type, status, creator_player_id, counterparty_player_id,
    season_id, week_id, game_number,
    creator_stake, counterparty_stake, total_pot, payout_amount,
    prop_market_id, creator_selection, counterparty_selection, subject_player_id,
    creator_message, custom_title, custom_description
  ) VALUES (
    p_contract_type, 'pending', v_creator_id, p_counterparty_player_id,
    v_season_id, p_week_id, v_game_number,
    p_creator_stake, p_counterparty_stake, v_total_pot, v_total_pot,
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
    p_creator_stake, p_counterparty_stake, v_game_number,
    p_prop_market_id, p_creator_selection, v_counterparty_sel,
    p_message
  );

  RETURN v_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, int, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, int, uuid, text, text, text, text) TO authenticated;


-- ============================================================================
-- 2. counter_pvp_challenge — per-side stakes.
-- ============================================================================
-- Stakes are role-fixed (creator vs counterparty); the app maps the caller's
-- "your stake / opponent stake" inputs onto these two params. Only the caller's
-- own side is balance-checked here.
-- Signature changes (7 → 8 args), so drop the old form first.
DROP FUNCTION IF EXISTS public.counter_pvp_challenge(uuid, int, text, int, uuid, text, text);

CREATE OR REPLACE FUNCTION public.counter_pvp_challenge(
  p_challenge_id       uuid,
  p_creator_stake      int,
  p_counterparty_stake int,
  p_contract_type      text,
  p_game_number        int,
  p_prop_market_id     uuid,
  p_selection          text,
  p_message            text
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
  v_my_stake          int;
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

  -- Both stakes must clear the floor; balance-check only the caller's own side
  -- (creator side if the caller is the creator, otherwise the counterparty side).
  IF p_creator_stake IS NULL OR p_creator_stake < 10
     OR p_counterparty_stake IS NULL OR p_counterparty_stake < 10 THEN
    RAISE EXCEPTION 'Minimum stake is 10 pins per side';
  END IF;
  v_my_stake := CASE WHEN v_caller_id = v_challenge.creator_player_id
                     THEN p_creator_stake ELSE p_counterparty_stake END;
  DECLARE v_balance int;
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.pin_ledger WHERE player_id = v_caller_id AND season_id = v_challenge.season_id;
    IF v_balance < v_my_stake THEN
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
  v_total_pot := p_creator_stake + p_counterparty_stake;
  v_next_offer_no := v_offer.offer_no + 1;

  UPDATE public.pvp_challenge_offers SET superseded_at = now() WHERE id = v_offer.id;

  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    p_challenge_id, v_caller_id, v_next_offer_no, p_contract_type,
    p_creator_stake, p_counterparty_stake, v_game_number,
    p_prop_market_id, p_selection, v_counterparty_sel,
    p_message
  );

  UPDATE public.pvp_challenges SET
    status                 = 'countered',
    contract_type          = p_contract_type,
    creator_stake          = p_creator_stake,
    counterparty_stake     = p_counterparty_stake,
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

REVOKE EXECUTE ON FUNCTION public.counter_pvp_challenge(uuid, int, int, text, int, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.counter_pvp_challenge(uuid, int, int, text, int, uuid, text, text) TO authenticated;
