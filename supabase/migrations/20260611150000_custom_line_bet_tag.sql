-- Bet ↔ custom line ("Special") tagging: bets placed from a special carry a
-- durable link + a display SNAPSHOT (title/description/category) so the
-- branding survives line edits/deletion and renders in historical surfaces
-- (ledger activity, past-week bet lists) where the client-side selection
-- matching can't reach (it only resolves against live current-week markets).
-- Settlement never touches these columns, so archive/unarchive are unaffected.

ALTER TABLE public.bets
  ADD COLUMN custom_line_id uuid REFERENCES public.custom_lines(id) ON DELETE SET NULL,
  ADD COLUMN custom_line_title text,
  ADD COLUMN custom_line_description text,
  ADD COLUMN custom_line_category text;

CREATE INDEX bets_custom_line_idx ON public.bets(custom_line_id);

-- Recreate place_house_bet with an optional p_custom_line_id. MUST drop first:
-- CREATE OR REPLACE with a defaulted extra param would create an overload,
-- which breaks PostgREST RPC dispatch (ambiguous function).
DROP FUNCTION public.place_house_bet(uuid[], integer);

CREATE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer, p_custom_line_id uuid DEFAULT NULL)
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

  -- Custom line ("Special") tag: snapshot its display identity onto the bet.
  -- The selections themselves are client-resolved (same trust as the parlay
  -- slip); the line must simply exist and be live.
  IF p_custom_line_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.custom_lines WHERE id = p_custom_line_id;
    IF v_line.id IS NULL OR NOT v_line.is_active THEN
      RAISE EXCEPTION 'This special is no longer available';
    END IF;
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

  INSERT INTO public.bets (player_id, season_id, counterparty, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category)
    VALUES (v_player_id, v_season_id, 'house', p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category)
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

REVOKE EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer, uuid) TO authenticated;
