-- Add `total_payout` to the sportsbook placement feed payloads: the bet's max
-- possible payout INCLUSIVE of an attached Energy Drink boost. The existing
-- `payout` key (stake × odds, boost-exclusive) is kept for older clients.
-- The boost bonus mirrors the settlement formula exactly:
-- floor(payout × boost_pct), paid on top of the total payout on a win.
-- Payload-only change to place_house_bet; no accounting or table changes.

CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer, p_custom_line_id uuid DEFAULT NULL::uuid, p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
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
  v_line      public.custom_lines%ROWTYPE;
  v_boost_pct numeric := NULL;
  v_total_payout integer;
BEGIN
  v_player_id := public.current_player_id();

  IF p_selection_ids IS NULL OR array_length(p_selection_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  -- Custom line ("Special") tag: snapshot its display identity onto the bet.
  -- The selections themselves are client-resolved (same trust as the parlay
  -- slip); the line must simply exist and be live.
  IF p_custom_line_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.custom_lines WHERE id = p_custom_line_id;
    IF v_line.id IS NULL OR NOT v_line.is_active THEN
      RAISE EXCEPTION 'This special is no longer available';
    END IF;
  END IF;

  -- Validate every selection, gather odds, resolve + assert a single season AND
  -- a single week, and enforce anti-tanking. Each selection must belong to a
  -- distinct open market.
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

    DECLARE
      v_mseason   uuid;
      v_marchived boolean;
    BEGIN
      SELECT season_id, is_archived INTO v_mseason, v_marchived
        FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      -- A locked week (advanced or fully archived) takes no new stakes even if a
      -- prop market is still 'open' pending its next-day settlement clock.
      IF v_marchived THEN
        RAISE EXCEPTION 'This week is locked — no new bets can be placed';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Single-week invariant: bets.week_id is single-valued, so every leg must
    -- share the first leg's week.
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    ELSIF v_week_id <> v_sel.week_id THEN
      RAISE EXCEPTION 'All selections must be in the same week';
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

  v_balance := public.pin_balance(v_player_id, v_season_id);
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  -- Safety Ticket: validate the catalog contract, then consume the atomic item
  -- in one guarded UPDATE (owner + unconsumed + current season — rowcount 0
  -- means one of those failed). Spent at placement, win or lose; deliberately
  -- NO is_active check (retirement stops grants, never confiscates).
  IF p_insurance_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_insurance_item_id
         AND c.effect_type = 'bet_insurance'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not attachable bet insurance';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_insurance_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Safety Ticket is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Winner's Crutch: same consume posture as the Safety Ticket, but its own
  -- effect_type and a parlay floor — a crutch on a single can never help (cancel
  -- the only leg = nothing survives). Spent at placement, win or lose.
  IF p_crutch_item_id IS NOT NULL THEN
    IF v_n < 2 THEN
      RAISE EXCEPTION 'A Winner''s Crutch can only be attached to a parlay (2 or more legs)';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_crutch_item_id
         AND c.effect_type = 'parlay_crutch'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Winner''s Crutch';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_crutch_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Winner''s Crutch is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Energy Drink: same consume posture; its own effect_type, no leg floor (a
  -- boost helps any winning bet, single or parlay). Spent at placement, win or
  -- lose; the bonus is paid at settlement on a win. Its boost_pct is snapshotted
  -- onto the bet below so display + settlement share one locked-at-placement value.
  IF p_boost_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_boost_item_id
         AND c.effect_type = 'odds_boost'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Energy Drink';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_boost_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Energy Drink is not usable (already spent, wrong season, or not yours)';
    END IF;

    -- Lock the flavor's boost magnitude onto the bet (defaults to 1.0 if a row
    -- somehow omits it).
    SELECT COALESCE((c.effect_params ->> 'boost_pct')::numeric, 1.0) INTO v_boost_pct
      FROM public.player_inventory_items i
      JOIN public.item_catalog c ON c.id = i.catalog_item_id
     WHERE i.id = p_boost_item_id;
  END IF;

  INSERT INTO public.bets (player_id, season_id, week_id, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category,
                           insurance_item_id, crutch_item_id, boost_item_id, boost_pct)
    VALUES (v_player_id, v_season_id, v_week_id, p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category,
            p_insurance_item_id, p_crutch_item_id, p_boost_item_id, v_boost_pct)
    RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, s.id, 'back', s.odds, s.line
    FROM public.bet_selections s
    WHERE s.id = ANY (p_selection_ids);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  PERFORM public.pin_ledger_double_entry(
    v_player_id, v_season_id, v_week_id,
    -p_stake, 'bet_stake', 'Bet placed', NULL, v_bet_id);

  -- Max possible payout INCLUSIVE of an attached boost — mirrors the settlement
  -- bonus formula (floor(payout × boost_pct) on top of the total payout).
  v_total_payout := v_payout
    + CASE WHEN v_boost_pct IS NOT NULL THEN FLOOR(v_payout * v_boost_pct)::integer ELSE 0 END;

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
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$
;
