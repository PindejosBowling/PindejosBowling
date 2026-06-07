-- ============================================================================
-- PvP Challenge Contracts — RPCs.
-- ============================================================================
-- All functions: SECURITY DEFINER, SET search_path = '', fully-qualified objects.
-- Identity always from auth.uid() — never a client-supplied player id for the caller.
-- Balances always derived: SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger
--   WHERE player_id = X AND season_id = Y.
-- Current season = is_active = true AND registration_open = false.
--
-- Double-entry pattern (mirrors place_house_bet / take_loan):
--   INSERT pin_ledger player row → RETURNING id INTO v_pin_player
--   INSERT pin_ledger house row  → RETURNING id INTO v_pin_house
--   INSERT pvp_ledger row(s) referencing v_pin_player → RETURNING id INTO v_pvp_id
--   UPDATE pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house)
-- ============================================================================


-- ============================================================================
-- 1. expire_pvp_challenges — flip stale negotiations to expired.
-- ============================================================================
-- Admin-gated. Called at the start of settle_pvp_for_week and on-demand.
-- No escrow exists on pending/countered contracts so no refund needed.
CREATE OR REPLACE FUNCTION public.expire_pvp_challenges()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.pvp_challenges
    SET status = 'expired'
    WHERE status IN ('pending', 'countered') AND expires_at <= now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_pvp_challenges() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.expire_pvp_challenges() TO authenticated;


-- ============================================================================
-- 2. create_pvp_challenge — create a new challenge contract.
-- ============================================================================
-- No escrow on create (voluntary-risk guardrail, design §2). Stakes move only
-- at accept. Inserts the challenge + offer_no=1 row, returns the challenge id.
CREATE OR REPLACE FUNCTION public.create_pvp_challenge(
  p_contract_type          text,
  p_counterparty_player_id uuid,       -- NULL = open-board
  p_week_id                uuid,
  p_game_number            int,
  p_stake                  int,
  p_prop_market_id         uuid,
  p_creator_selection      text,
  p_message                text,
  p_expires_at             timestamptz -- NULL = default to week lock
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
  v_expires_at            timestamptz;
  v_total_pot             int;
  v_rake                  int;
  v_payout                int;
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

  -- Default expires_at to week lock if not supplied; reject if already past.
  v_expires_at := COALESCE(p_expires_at, v_week.lock_at);
  IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
    RAISE EXCEPTION 'Contract expiry is already in the past';
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
    SELECT m.*, s.key AS over_key INTO v_market
      FROM public.bet_markets m
      WHERE m.id = p_prop_market_id;
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
    -- Derive counterparty selection as the opposite key.
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
  -- Any future "under your own line" type is disallowed by policy, not this check.

  -- 6. Compute financials and insert challenge.
  v_total_pot := p_stake * 2;
  v_rake      := public.pvp_rake(v_total_pot);
  v_payout    := v_total_pot - v_rake;

  INSERT INTO public.pvp_challenges (
    contract_type, status, creator_player_id, counterparty_player_id,
    season_id, week_id, game_number,
    creator_stake, counterparty_stake, total_pot, rake_amount, payout_amount,
    prop_market_id, creator_selection, counterparty_selection, subject_player_id,
    expires_at, creator_message
  ) VALUES (
    p_contract_type, 'pending', v_creator_id, p_counterparty_player_id,
    v_season_id, p_week_id, p_game_number,
    p_stake, p_stake, v_total_pot, v_rake, v_payout,
    p_prop_market_id, p_creator_selection, v_counterparty_sel, v_subject_player_id,
    v_expires_at, p_message
  ) RETURNING id INTO v_challenge_id;

  -- 7. Insert the original offer (offer_no = 1, snapshot of terms).
  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    expires_at, message
  ) VALUES (
    v_challenge_id, v_creator_id, 1, p_contract_type,
    p_stake, p_stake, p_game_number,
    p_prop_market_id, p_creator_selection, v_counterparty_sel,
    v_expires_at, p_message
  );

  RETURN v_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pvp_challenge(text, uuid, uuid, int, int, uuid, text, text, timestamptz) TO authenticated;


-- ============================================================================
-- 3. counter_pvp_challenge — propose new terms as a counteroffer.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.counter_pvp_challenge(
  p_challenge_id   uuid,
  p_stake          int,
  p_contract_type  text,
  p_game_number    int,
  p_prop_market_id uuid,
  p_selection      text,
  p_message        text,
  p_expires_at     timestamptz -- NULL = inherit prior offer's expires_at
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
  v_expires_at        timestamptz;
  v_total_pot         int;
  v_rake              int;
  v_payout            int;
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
  -- Caller must be a party (creator or counterparty, or any player for open-board).
  IF v_challenge.counterparty_player_id IS NOT NULL
     AND v_caller_id <> v_challenge.creator_player_id
     AND v_caller_id <> v_challenge.counterparty_player_id THEN
    RAISE EXCEPTION 'You are not a party to this challenge';
  END IF;

  -- Find the live offer.
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

  -- Stake validation.
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

  -- expires_at: inherit or shorten (never extend).
  v_expires_at := COALESCE(p_expires_at, v_offer.expires_at);
  IF v_expires_at > v_offer.expires_at THEN
    RAISE EXCEPTION 'Cannot extend the expiry past the current offer';
  END IF;
  IF v_expires_at <= now() THEN
    RAISE EXCEPTION 'Expiry is in the past';
  END IF;

  -- Contract-type scope validation.
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

  -- Compute financials.
  v_total_pot := p_stake * 2;
  v_rake      := public.pvp_rake(v_total_pot);
  v_payout    := v_total_pot - v_rake;
  v_next_offer_no := v_offer.offer_no + 1;

  -- Supersede prior offer.
  UPDATE public.pvp_challenge_offers SET superseded_at = now() WHERE id = v_offer.id;

  -- Insert new offer.
  INSERT INTO public.pvp_challenge_offers (
    challenge_id, offered_by_player_id, offer_no, contract_type,
    creator_stake, counterparty_stake, game_number,
    prop_market_id, creator_selection, counterparty_selection,
    expires_at, message
  ) VALUES (
    p_challenge_id, v_caller_id, v_next_offer_no, p_contract_type,
    p_stake, p_stake, p_game_number,
    p_prop_market_id, p_selection, v_counterparty_sel,
    v_expires_at, p_message
  );

  -- Update challenge to new terms.
  UPDATE public.pvp_challenges SET
    status                 = 'countered',
    contract_type          = p_contract_type,
    creator_stake          = p_stake,
    counterparty_stake     = p_stake,
    total_pot              = v_total_pot,
    rake_amount            = v_rake,
    payout_amount          = v_payout,
    game_number            = p_game_number,
    prop_market_id         = p_prop_market_id,
    creator_selection      = CASE WHEN p_contract_type = 'prop_duel' THEN p_selection    ELSE NULL END,
    counterparty_selection = CASE WHEN p_contract_type = 'prop_duel' THEN v_counterparty_sel ELSE NULL END,
    subject_player_id      = v_subject_id,
    expires_at             = v_expires_at,
    -- If this was an open-board contract now being negotiated by a specific player, set counterparty.
    counterparty_player_id = CASE
      WHEN v_challenge.counterparty_player_id IS NULL AND v_caller_id <> v_challenge.creator_player_id
        THEN v_caller_id
      ELSE v_challenge.counterparty_player_id
    END
  WHERE id = p_challenge_id;

  RETURN p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.counter_pvp_challenge(uuid, int, text, int, uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.counter_pvp_challenge(uuid, int, text, int, uuid, text, text, timestamptz) TO authenticated;


-- ============================================================================
-- 4. accept_pvp_challenge — accept the live offer and escrow both stakes.
-- ============================================================================
-- This is the escrow moment. Mirrors place_house_bet's double-entry per side.
-- Writes 4 pin_ledger rows + 4 pvp_ledger rows total (2 per player).
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

  -- Find live offer.
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

  -- For open-board: caller becomes the counterparty.
  IF v_challenge.counterparty_player_id IS NULL THEN
    v_counterparty := v_caller_id;
  ELSE
    IF v_caller_id <> v_challenge.counterparty_player_id
       AND v_caller_id <> v_challenge.creator_player_id THEN
      RAISE EXCEPTION 'You are not a party to this challenge';
    END IF;
    v_counterparty := v_challenge.counterparty_player_id;
  END IF;

  -- Validate not expired and week not archived.
  IF now() >= v_offer.expires_at THEN
    RAISE EXCEPTION 'The offer has expired';
  END IF;
  IF EXISTS (SELECT 1 FROM public.weeks WHERE id = v_challenge.week_id AND is_archived = true) THEN
    RAISE EXCEPTION 'Cannot accept a contract for an archived week';
  END IF;

  -- Balance check for both parties.
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

  -- Mark the offer accepted and lock the challenge.
  UPDATE public.pvp_challenge_offers SET accepted_at = now() WHERE id = v_offer.id;

  UPDATE public.pvp_challenges SET
    status                 = 'locked',
    counterparty_player_id = v_counterparty,
    accepted_at            = now(),
    locked_at              = now(),
    total_pot              = v_challenge.creator_stake + v_challenge.counterparty_stake,
    rake_amount            = public.pvp_rake(v_challenge.creator_stake + v_challenge.counterparty_stake),
    payout_amount          = (v_challenge.creator_stake + v_challenge.counterparty_stake)
                             - public.pvp_rake(v_challenge.creator_stake + v_challenge.counterparty_stake)
  WHERE id = p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_pvp_challenge(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_pvp_challenge(uuid) TO authenticated;


-- ============================================================================
-- 5. decline_pvp_challenge — decline the live offer (no escrow to refund).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.decline_pvp_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_challenge public.pvp_challenges;
  v_offer     record;
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
    RAISE EXCEPTION 'Challenge is not in a declinable state';
  END IF;

  SELECT * INTO v_offer FROM public.pvp_challenge_offers
    WHERE challenge_id = p_challenge_id
      AND superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL
    ORDER BY offer_no DESC LIMIT 1;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'No live offer found';
  END IF;
  -- Caller must be the offer recipient (the other party).
  IF v_offer.offered_by_player_id = v_caller_id THEN
    RAISE EXCEPTION 'You cannot decline your own offer';
  END IF;
  IF v_challenge.counterparty_player_id IS NOT NULL
     AND v_caller_id <> v_challenge.creator_player_id
     AND v_caller_id <> v_challenge.counterparty_player_id THEN
    RAISE EXCEPTION 'You are not a party to this challenge';
  END IF;

  UPDATE public.pvp_challenge_offers SET declined_at = now() WHERE id = v_offer.id;
  UPDATE public.pvp_challenges SET status = 'cancelled' WHERE id = p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decline_pvp_challenge(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decline_pvp_challenge(uuid) TO authenticated;


-- ============================================================================
-- 6. cancel_pvp_challenge — admin: destructive rollback of escrow (design §4.5).
-- ============================================================================
-- Pending contracts: no escrow, just cancel.
-- Locked contracts: delete the stake pin rows by pvp_ledger_id (both sides),
-- delete the pvp_ledger rows, then set status=cancelled.
-- Mirrors cancel_loan (delete form, not reversal, for pre-settlement cancel).
CREATE OR REPLACE FUNCTION public.cancel_pvp_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge public.pvp_challenges;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  -- For locked contracts: delete the escrow pin rows (both player + house sides)
  -- identified through pvp_ledger rows for this challenge.
  -- This is the destructive delete form (mirrors cancel_loan).
  DELETE FROM public.pin_ledger
    WHERE pvp_ledger_id IN (
      SELECT id FROM public.pvp_ledger WHERE challenge_id = p_challenge_id
    );
  DELETE FROM public.pvp_ledger WHERE challenge_id = p_challenge_id;

  UPDATE public.pvp_challenges SET status = 'cancelled' WHERE id = p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_pvp_challenge(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_pvp_challenge(uuid) TO authenticated;


-- ============================================================================
-- 7. void_pvp_challenge — admin: refund both stakes, no rake (design §4.5).
-- ============================================================================
-- Contract can't be settled fairly. Refunds via reversal rows (not delete).
-- If already settled, also reverses the payout and rake rows first.
CREATE OR REPLACE FUNCTION public.void_pvp_challenge(p_challenge_id uuid, p_admin_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge  public.pvp_challenges;
  v_stake_row  record;
  v_pin_player uuid;
  v_pin_house  uuid;
  v_pvp_id     uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_challenge FROM public.pvp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.status NOT IN ('locked', 'settled') THEN
    RAISE EXCEPTION 'Can only void a locked or settled challenge';
  END IF;

  -- Refund each player's stake via reversal rows.
  FOR v_stake_row IN
    SELECT * FROM public.pvp_ledger
    WHERE challenge_id = p_challenge_id AND type = 'stake' AND player_id IS NOT NULL
  LOOP
    -- Refund pin pair: player +stake, house -stake.
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
      VALUES (v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
              false, -v_stake_row.amount, 'pvp_refund', 'PvP challenge voided — stake refunded')
      RETURNING id INTO v_pin_player;
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
      VALUES (NULL, v_stake_row.season_id, v_stake_row.week_id,
              true, v_stake_row.amount, 'pvp_refund', 'PvP challenge voided — stake refunded (house)')
      RETURNING id INTO v_pin_house;

    INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
      VALUES (p_challenge_id, v_stake_row.player_id, v_stake_row.season_id, v_stake_row.week_id,
              -v_stake_row.amount, 'refund', 'Void refund', v_pin_player)
      RETURNING id INTO v_pvp_id;

    UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);
  END LOOP;

  UPDATE public.pvp_challenges SET
    status     = 'voided',
    admin_note = p_admin_note,
    settled_at = now()
  WHERE id = p_challenge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_pvp_challenge(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.void_pvp_challenge(uuid, text) TO authenticated;


-- ============================================================================
-- 8. settle_pvp_challenge — settle one contract (automatic or admin).
-- ============================================================================
-- Idempotent. Called by settle_pvp_for_week (automatic) or directly by admin.
-- Reads actual game scores from scores/games/team_slots for score-based types.
-- Missing required score → void (can't settle fairly, §4.5).
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
  -- Admin gate for admin-sourced settles.
  IF p_source = 'admin' THEN
    IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
      RAISE EXCEPTION 'Admin only';
    END IF;
  END IF;

  -- Idempotency guard.
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

  -- Admin override: use supplied winner directly.
  IF p_source = 'admin' AND p_winner_player_id IS NOT NULL THEN
    v_winner_id     := p_winner_player_id;
    v_result_detail := jsonb_build_object('source', 'admin', 'winner', p_winner_player_id);
  ELSE
    -- Compute outcome by contract_type.
    IF v_challenge.contract_type IN ('line_duel', 'raw_score_duel') THEN
      -- Read creator score.
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

      -- Read counterparty score.
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

      -- Missing score → void.
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
        -- raw_score_duel
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
      -- Read market result_value.
      SELECT result_value INTO v_mkt_result
        FROM public.bet_markets WHERE id = v_challenge.prop_market_id;

      IF v_mkt_result IS NULL THEN
        v_is_void := true;
      ELSE
        -- Determine which selection won using the market's selections.
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
          v_is_push := true;  -- market push / both void
        END IF;
      END IF;
    END IF;
  END IF;

  -- Void path: refund stakes, no rake.
  IF v_is_void THEN
    PERFORM public.void_pvp_challenge(p_challenge_id, COALESCE(p_admin_note, 'Score unavailable — voided at settlement'));
    RETURN;
  END IF;

  -- Push path: refund stakes, no rake.
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

  -- Winner path: payout + rake.
  -- Payout: winner +payout_amount, house -payout_amount.
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (v_winner_id, v_challenge.season_id, v_challenge.week_id,
            false, v_challenge.payout_amount, 'pvp_payout', 'PvP challenge won')
    RETURNING id INTO v_pin_player;
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
    VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
            true, -v_challenge.payout_amount, 'pvp_payout', 'PvP challenge won (house)')
    RETURNING id INTO v_pin_house;

  INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
    VALUES (p_challenge_id, v_winner_id, v_challenge.season_id, v_challenge.week_id,
            v_challenge.payout_amount, 'payout', 'Winner payout', v_pin_player)
    RETURNING id INTO v_pvp_id;

  UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id IN (v_pin_player, v_pin_house);

  -- Rake: house-only row (the remaining pot stays house-side from escrow).
  IF v_challenge.rake_amount > 0 THEN
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description)
      VALUES (NULL, v_challenge.season_id, v_challenge.week_id,
              true, v_challenge.rake_amount, 'pvp_rake', 'PvP challenge rake')
      RETURNING id INTO v_pin_house;

    INSERT INTO public.pvp_ledger (challenge_id, player_id, season_id, week_id, amount, type, description, pin_ledger_id)
      VALUES (p_challenge_id, NULL, v_challenge.season_id, v_challenge.week_id,
              v_challenge.rake_amount, 'rake', 'House rake', v_pin_house)
      RETURNING id INTO v_pvp_id;

    UPDATE public.pin_ledger SET pvp_ledger_id = v_pvp_id WHERE id = v_pin_house;
  END IF;

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


-- ============================================================================
-- 9. settle_pvp_for_week — batch-settle all locked contracts for a week.
-- ============================================================================
-- Admin-gated. Idempotent (per-contract guard in settle_pvp_challenge).
-- Called by settle_betting_for_week; also callable directly.
-- Expires stale offers first, then auto-settles all lockable contracts.
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

  -- Expire stale negotiations first.
  PERFORM public.expire_pvp_challenges();

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
