-- ============================================================================
-- PvP Challenge Contracts — remove the time-based expiry concept.
-- ============================================================================
-- Product decision: PvP challenges no longer expire on a clock. A challenge stays
-- open until the admin starts the game it is tied to (Matchups → "Start Game"),
-- which closes every still-open challenge for that game; anything left open when
-- the week is archived/settled is closed too. Closing reuses the existing decline
-- semantics: status='cancelled' + stamp the live offer's declined_at. An accepted
-- (locked) challenge is never closed this way (the status filter excludes it).
--
-- This migration:
--   * drops p_expires_at from create_/counter_pvp_challenge and the expiry checks
--     from create/counter/accept
--   * replaces expire_pvp_challenges() with close_open_pvp_challenges(week, game)
--   * points settle_pvp_for_week at the new close RPC (week-wide)
--   * drops the (status, expires_at) index and the expires_at columns
--
-- Safe to drop the columns: the PvP feature has no rows yet.
-- ============================================================================


-- ============================================================================
-- 1. create_pvp_challenge — drop p_expires_at + all expiry logic.
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.create_pvp_challenge(
  p_contract_type          text,
  p_counterparty_player_id uuid,       -- NULL = open-board
  p_week_id                uuid,
  p_game_number            int,
  p_stake                  int,
  p_prop_market_id         uuid,
  p_creator_selection      text,
  p_message                text
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
  ELSE
    RAISE EXCEPTION 'Unknown contract_type: %', p_contract_type;
  END IF;

  -- 5. No-tank guard: Line/Prop/Raw duels are overperformance- or neutral-framed.

  -- 6. Compute financials and insert challenge. Winner takes the whole pot.
  v_total_pot := p_stake * 2;

  INSERT INTO public.pvp_challenges (
    contract_type, status, creator_player_id, counterparty_player_id,
    season_id, week_id, game_number,
    creator_stake, counterparty_stake, total_pot, payout_amount,
    prop_market_id, creator_selection, counterparty_selection, subject_player_id,
    creator_message
  ) VALUES (
    p_contract_type, 'pending', v_creator_id, p_counterparty_player_id,
    v_season_id, p_week_id, p_game_number,
    p_stake, p_stake, v_total_pot, v_total_pot,
    p_prop_market_id, p_creator_selection, v_counterparty_sel, v_subject_player_id,
    p_message
  ) RETURNING id INTO v_challenge_id;

  -- 7. Insert the original offer (offer_no = 1, snapshot of terms).
  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    message
  ) VALUES (
    v_challenge_id, v_creator_id, 1, p_contract_type,
    p_stake, p_stake, p_game_number,
    p_prop_market_id, p_creator_selection, v_counterparty_sel,
    p_message
  );

  RETURN v_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text) TO authenticated;


-- ============================================================================
-- 2. counter_pvp_challenge — drop p_expires_at + all expiry logic.
-- ============================================================================
DROP FUNCTION IF EXISTS public.counter_pvp_challenge(uuid, int, text, int, uuid, text, text, timestamptz);

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
    p_stake, p_stake, p_game_number,
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
    game_number            = p_game_number,
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
-- 3. accept_pvp_challenge — drop the "offer has expired" check.
-- ============================================================================
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

  -- Snapshot settlement basis for Line Duel.
  IF v_challenge.contract_type = 'line_duel' THEN
    UPDATE public.pvp_challenges SET
      creator_line      = public.pvp_player_line(v_challenge.creator_player_id, v_challenge.season_id),
      counterparty_line = public.pvp_player_line(v_counterparty, v_challenge.season_id)
    WHERE id = p_challenge_id;
  END IF;

  -- Mark the offer accepted and lock the challenge. Winner takes the whole pot.
  UPDATE public.pvp_challenge_offers SET accepted_at = now() WHERE id = v_offer.id;

  UPDATE public.pvp_challenges SET
    status                 = 'locked',
    counterparty_player_id = v_counterparty,
    accepted_at            = now(),
    locked_at              = now(),
    total_pot              = v_challenge.creator_stake + v_challenge.counterparty_stake,
    payout_amount          = v_challenge.creator_stake + v_challenge.counterparty_stake
  WHERE id = p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_pvp_challenge(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_pvp_challenge(uuid) TO authenticated;


-- ============================================================================
-- 4. settle_pvp_for_week — close leftover open challenges instead of expiring.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_pvp_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract record;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Close any still-open negotiations for the whole week (the clock-based expiry
  -- sweep is gone; nothing else closes stale pending/countered contracts now).
  PERFORM public.close_open_pvp_challenges(p_week_id, NULL);

  -- Auto-settle every locked auto-settleable contract for this week.
  FOR v_contract IN
    SELECT id FROM public.pvp_challenges
    WHERE week_id = p_week_id
      AND status = 'locked'
      AND contract_type IN ('line_duel', 'prop_duel', 'raw_score_duel')
  LOOP
    PERFORM public.settle_pvp_challenge(v_contract.id, 'automatic', NULL, NULL);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_pvp_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_pvp_for_week(uuid) TO authenticated;


-- ============================================================================
-- 5. close_open_pvp_challenges — close open challenges on game start / settle.
-- ============================================================================
-- Admin-gated. Closes every still-open (pending/countered) challenge for a week,
-- optionally narrowed to a single game_number. Reuses the manual-decline
-- semantics: stamp the live offer's declined_at and set the challenge to
-- 'cancelled'. The status filter inherently skips accepted/locked challenges, so
-- an already-accepted contract is never closed here. No escrow exists on
-- pending/countered contracts, so there is nothing to refund.
--   p_game_number NULL → whole week (used at settlement)
--   p_game_number N    → only that game's contracts (used by "Start Game")
CREATE OR REPLACE FUNCTION public.close_open_pvp_challenges(p_week_id uuid, p_game_number int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

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
$$;

REVOKE EXECUTE ON FUNCTION public.close_open_pvp_challenges(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_open_pvp_challenges(uuid, int) TO authenticated;


-- ============================================================================
-- 6. Drop the old expiry sweep, the expiry index, and the expires_at columns.
-- ============================================================================
DROP FUNCTION IF EXISTS public.expire_pvp_challenges();

DROP INDEX IF EXISTS public.pvp_challenges_status_expires_at_idx;

ALTER TABLE public.pvp_challenges       DROP COLUMN IF EXISTS expires_at;
ALTER TABLE public.pvp_challenge_offers DROP COLUMN IF EXISTS expires_at;
