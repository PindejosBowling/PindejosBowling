-- ============================================================================
-- Add week_id to pin_ledger + backfill existing rows + update RPCs.
-- ============================================================================
-- pin_ledger previously stored only season_id, making week-level queries
-- impossible. Every entry is created in the context of a specific week, so
-- this migration adds a nullable week_id FK and populates it for all existing
-- rows where a week is derivable. champion_bonus entries stay NULL (credited
-- at season open before any week exists).
--
-- RPC updates: settle_betting_for_week, place_house_bet, settle_market_internal
-- all gain week_id on their pin_ledger INSERTs so new entries are week-stamped
-- from this point forward.
-- ============================================================================

-- ============================================================================
-- 1. DDL
-- ============================================================================
ALTER TABLE public.pin_ledger
  ADD COLUMN week_id uuid REFERENCES public.weeks(id) ON DELETE SET NULL;

CREATE INDEX pin_ledger_week_id_idx ON public.pin_ledger (week_id);


-- ============================================================================
-- 2. Backfill existing rows
-- ============================================================================

-- score_credit: parse week number from description "Week N Game G: SCORE pins"
UPDATE public.pin_ledger pl
SET week_id = w.id
FROM public.weeks w
WHERE pl.type = 'score_credit'
  AND w.season_id = pl.season_id
  AND w.week_number = (regexp_match(pl.description, '^Week (\d+) '))[1]::integer;

-- bet_stake / bet_payout / bet_refund: follow bet_id -> legs -> selections -> market
UPDATE public.pin_ledger pl
SET week_id = bm.week_id
FROM public.bets b
JOIN public.bet_legs bl       ON bl.bet_id = b.id
JOIN public.bet_selections bs ON bs.id = bl.selection_id
JOIN public.bet_markets bm    ON bm.id = bs.market_id
WHERE pl.bet_id = b.id
  AND bm.week_id IS NOT NULL
  AND pl.week_id IS NULL;

-- house_seed: associate with the first week of each season
UPDATE public.pin_ledger pl
SET week_id = w.id
FROM (
  SELECT season_id, MIN(week_number) AS min_wk
  FROM public.weeks
  GROUP BY season_id
) first_wk
JOIN public.weeks w ON w.season_id = first_wk.season_id AND w.week_number = first_wk.min_wk
WHERE pl.type = 'house_seed'
  AND pl.season_id = w.season_id;

-- champion_bonus: intentionally left NULL (no week affinity).


-- ============================================================================
-- 3. Update RPCs to stamp week_id on new ledger entries
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 3a. place_house_bet — capture week_id from the first selection's market
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_house_bet(
  p_selection_ids uuid[],
  p_stake         integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  RETURN v_bet_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3b. settle_market_internal — pass v_market.week_id onto payout/refund pairs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_market_internal(
  p_market_id    uuid,
  p_result_value numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_market public.bet_markets;
  v_bet    record;
  v_leg    record;
  v_odds   numeric;
  v_payout integer;
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

      UPDATE public.bets
        SET status = 'won', potential_payout = v_payout, settled_at = now()
        WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, v_market.week_id, false,  v_payout, 'bet_payout', 'Bet won',         v_bet.id),
        (NULL,            v_bet.season_id, v_market.week_id, true,  -v_payout, 'bet_payout', 'Bet won (house)', v_bet.id);
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_market_internal(uuid, numeric) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3c. settle_betting_for_week — add week_id = p_week_id to score_credit INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_mkt         record;
  v_score       integer;
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) TO authenticated;
