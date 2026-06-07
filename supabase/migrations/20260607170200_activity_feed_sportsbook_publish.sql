-- ============================================================================
-- Activity Feed — sportsbook publish integration (§3, design §10).
-- ============================================================================
-- CREATE OR REPLACE place_house_bet and settle_market_internal from their current
-- live bodies (20260605120219_add_week_id_to_pin_ledger.sql), adding ONLY the
-- publish_activity_event PERFORM calls inside the existing transaction. No change
-- to bet/leg/ledger behavior — the pin math below is byte-for-byte identical to
-- the pre-edit functions (§7.11).
--
-- Threshold constants (single source of truth — §2.1, design §12). Tune with a
-- follow-up migration:
--   large_bet_absolute_threshold = 250   (big-ticket floor)
--   large_bet_balance_percent    = 0.10  (big-ticket also if stake ≥ 10% pre-bet balance)
--   big_win_payout_threshold     = 500   (big-win floor)
--   big_win_balance_percent      = 0.20  (big-win also if profit ≥ 20% pre-settlement balance)
--   normal_bet_placement_enabled = false (plain single bet posts nothing in v1, §10.4)
-- ============================================================================

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
  -- v_balance here is the pre-bet balance; v_n is the leg count.
  IF p_stake >= GREATEST(250, FLOOR(0.10 * v_balance)) THEN
    -- Big ticket.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_big_ticket_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.big_ticket_placed',
      jsonb_build_object('stake', p_stake, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
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
          NULL, NULL, now());
      ELSIF v_payout >= 500 OR (v_payout - v_bet.stake) >= FLOOR(0.20 * v_pre_balance) THEN
        PERFORM public.publish_activity_event(
          'sportsbook', 'sportsbook_big_win',
          v_bet.season_id, v_market.week_id, v_bet.player_id, NULL, NULL,
          v_bet.id, NULL,
          'sportsbook.big_win',
          jsonb_build_object('stake', v_bet.stake, 'payout', v_payout,
                             'profit', v_payout - v_bet.stake, 'legs', v_won_legs),
          jsonb_build_object('bet_id', v_bet.id, 'market_id', p_market_id),
          NULL, NULL, now());
      -- else: ordinary single-leg win is not feed-worthy (§10.4). No bad_beat in v1.
      END IF;
    END IF;
  END LOOP;
END;
$function$;
