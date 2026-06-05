-- ============================================================================
-- Phase 2 · WS2 — Target-model betting RPCs (house over/under).
-- ============================================================================
-- Reproduces 100% of the legacy over/under behaviour on the canonical model
-- (bet_markets / bet_selections / bets / bet_legs) with funded-house double-entry
-- accounting (WS1). All functions are SECURITY DEFINER with a pinned search_path
-- and resolve identity from auth.uid() / auth.jwt() (never a client-supplied id).
--
-- Authored parlay-shaped (leg arrays, combined odds) even though the O/U UI uses
-- single legs — the schema is parlay-native and it costs almost nothing.
--
-- Replacements:
--   sync_bet_lines_for_week   → sync_over_under_markets_for_week
--   place_bet                 → place_house_bet
--   settleBettingForWeek (TS) → settle_betting_for_week
--   BettingScreen.settleBet   → settle_market
--   cancel-bet flow (TS)      → cancel_bet
--   line editing (TS)         → edit_over_under_line
-- ============================================================================


-- ============================================================================
-- 1. sync_over_under_markets_for_week — RSVP-driven create/refund, server-side.
-- ============================================================================
-- Idempotent. Derived entirely from rsvp + scores (a caller cannot inject lines
-- or values), so it is safe for any authenticated user toggling their own RSVP.
--   • Target games = distinct game_number of existing over_under markets for the
--     week (so late joiners match the established set incl. game 3 post-gen),
--     defaulting to {1,2}.
--   • Create one over_under market (+ over/under selections, line = floor(avg)+0.5,
--     odds 2.000) per in-player × target game that has none.
--   • Refund + remove markets whose subject is no longer "in": delete ledger rows
--     by the markets' bet_ids (restores balances, both player + house), delete
--     those bets (cascade legs), then delete the markets (cascade selections).
CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id    uuid;
  v_target_games integer[];
  v_league_avg   numeric;
  v_avg          numeric;
  v_line         numeric;
  v_market_id    uuid;
  v_rec          record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  SELECT ARRAY_AGG(DISTINCT game_number) INTO v_target_games
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;

  -- --- Refund + remove markets for players no longer "in" --------------------
  -- Ledger first (pin_ledger.bet_id is ON DELETE SET NULL — deleting the bet
  -- first would orphan, not delete, its ledger rows and lose the refund).
  DELETE FROM public.pin_ledger
    WHERE bet_id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.subject_player_id NOT IN (
          SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
        )
    );

  DELETE FROM public.bets
    WHERE id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.subject_player_id NOT IN (
          SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
        )
    );

  DELETE FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
      AND m.subject_player_id NOT IN (
        SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
      );

  -- --- League average (mean of per-player current-season archived averages) ---
  SELECT COALESCE(AVG(pa.avg_score), 130) INTO v_league_avg
  FROM (
    SELECT AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id IS NOT NULL AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa;

  -- --- Create missing markets for "in" players --------------------------------
  FOR v_rec IN
    SELECT ip.player_id, g.game_number, p.name
    FROM (SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in') ip
    CROSS JOIN UNNEST(v_target_games) AS g(game_number)
    JOIN public.players p ON p.id = ip.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = g.game_number AND m.subject_player_id = ip.player_id
    )
  LOOP
    SELECT AVG(s.score) INTO v_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id = v_rec.player_id AND s.score IS NOT NULL;

    v_line := FLOOR(COALESCE(v_avg, v_league_avg)) + 0.5;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_over_under_markets_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_over_under_markets_for_week(uuid) TO authenticated;


-- ============================================================================
-- 2. place_house_bet — atomic, balance-checked house bet for the caller.
-- ============================================================================
-- Resolves the bettor from auth.uid(). Validates every selection's market is
-- open and all resolve to the same season; enforces min stake + balance +
-- anti-tanking (the bet_legs_no_self_tank trigger is the hard backstop). Writes
-- one bets row + one bet_legs per selection (single element for O/U) and the
-- double-entry stake pair (player −stake, house +stake) in one transaction.
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

  -- Double-entry stake: player −stake, house +stake (nets to zero).
  INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description, bet_id) VALUES
    (v_player_id, v_season_id, false, -p_stake, 'bet_stake', 'Bet placed',         v_bet_id),
    (NULL,        v_season_id, true,   p_stake, 'bet_stake', 'Bet placed (house)', v_bet_id);

  RETURN v_bet_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer) TO authenticated;


-- ============================================================================
-- 3. settle_market_internal — the settlement engine (no auth check).
-- ============================================================================
-- Private: not granted to anyone, only callable by the SECURITY DEFINER wrappers
-- below (settle_market, settle_betting_for_week), which gate on the admin role.
-- Sets selection results from result_value vs line (over_under), derives each
-- bet_legs.result via the back/lay table, finalizes every bet whose legs are all
-- resolved, and posts the double-entry payout/refund pairs. Idempotent: a market
-- already 'settled' is a no-op; only 'pending' bets are touched (never double-pays).
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

    -- A leg still unresolved (other market of a parlay) → leave bet pending.
    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result IS NULL) THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') THEN
      -- Lost: stake already debited / house already holds it. No ledger.
      UPDATE public.bets SET status = 'lost', settled_at = now() WHERE id = v_bet.id;

    ELSIF NOT EXISTS (
      SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result NOT IN ('push', 'void')
    ) THEN
      -- All legs push/void → refund the stake (double-entry).
      UPDATE public.bets SET status = 'push', settled_at = now() WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, false,  v_bet.stake, 'bet_refund', 'Push refund',         v_bet.id),
        (NULL,            v_bet.season_id, true,  -v_bet.stake, 'bet_refund', 'Push refund (house)', v_bet.id);

    ELSE
      -- Won: payout = floor(stake × product(won-leg odds)). Numeric multiply (no
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
      INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, false,  v_payout, 'bet_payout', 'Bet won',         v_bet.id),
        (NULL,            v_bet.season_id, true,  -v_payout, 'bet_payout', 'Bet won (house)', v_bet.id);
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_market_internal(uuid, numeric) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 4. settle_market — admin wrapper for a single market.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_market(p_market_id uuid, p_result_value numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  PERFORM public.settle_market_internal(p_market_id, p_result_value);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_market(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_market(uuid, numeric) TO authenticated;


-- ============================================================================
-- 5. settle_betting_for_week — admin, called on week archive.
-- ============================================================================
-- Credits game scores (faucet, player-only) then settles every non-settled
-- over_under market in the week against the subject's actual game score. Markets
-- with no recorded score are closed without a result (mirrors legacy). The score
-- credit block is guarded so re-running is a no-op.
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
    INSERT INTO public.pin_ledger (player_id, season_id, amount, type, description)
    SELECT ts.player_id, v_season_id, s.score, 'score_credit',
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
      -- No score → close without a result (bets stay pending for manual handling).
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) TO authenticated;


-- ============================================================================
-- 6. cancel_bet — admin total undo of a placed bet.
-- ============================================================================
-- Deletes all ledger rows for the bet (both player + house → full balance
-- restore), then the bet (cascade legs). If a market the bet touched was
-- 'settled' and no bets remain on it, re-open it (clear result, reopen selections)
-- so it becomes bettable again — mirroring the legacy "un-settle on last cancel".
CREATE OR REPLACE FUNCTION public.cancel_bet(p_bet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_market_ids uuid[];
  v_mid        uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

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
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_bet(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_bet(uuid) TO authenticated;


-- ============================================================================
-- 7. edit_over_under_line — admin, set a market's line while it has no bets.
-- ============================================================================
-- Re-checks no bets exist on the market (guards a bet placed since the admin
-- loaded the screen), then updates the line on both selections.
CREATE OR REPLACE FUNCTION public.edit_over_under_line(p_market_id uuid, p_line numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bet_legs l
    JOIN public.bet_selections s ON s.id = l.selection_id
    WHERE s.market_id = p_market_id
  ) THEN
    RAISE EXCEPTION 'Market already has bets — cannot edit the line';
  END IF;

  UPDATE public.bet_selections SET line = p_line WHERE market_id = p_market_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_over_under_line(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.edit_over_under_line(uuid, numeric) TO authenticated;
