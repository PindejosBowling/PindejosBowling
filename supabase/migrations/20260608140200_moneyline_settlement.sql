-- ============================================================================
-- Moneyline betting · 3/3 — settlement engine extended to moneyline.
-- ============================================================================
-- Refactors the per-market bet-finalization loop out of settle_market_internal
-- into a shared finalize_bets_for_market(), then reuses it for moneyline. O/U
-- behavior is unchanged. Moneyline winner = the team with the higher combined
-- game score; equal totals → push (refund). Settled automatically on week
-- archive (settle_betting_for_week) and manually via settle_moneyline_market.
-- See supabase/migrations/20260605005644_ou_target_model_rpcs.sql for the originals.


-- ============================================================================
-- A. finalize_bets_for_market — shared bet finalization (market-type agnostic).
-- ============================================================================
-- Given a market whose bet_selections.result are already set and the market is
-- marked 'settled', finalizes every pending bet with a leg on it: copies results
-- onto legs (back/lay table), resolves bets whose legs are all in, and posts the
-- double-entry payout/refund pairs. Idempotent (only touches 'pending' bets).
-- Internal: not granted; only the SECURITY DEFINER settlers below call it.
CREATE OR REPLACE FUNCTION public.finalize_bets_for_market(p_market_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bet    record;
  v_leg    record;
  v_odds   numeric;
  v_payout integer;
BEGIN
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
      -- Won: payout = floor(stake × product(won-leg odds)). Push/void legs drop out.
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

REVOKE EXECUTE ON FUNCTION public.finalize_bets_for_market(uuid) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- B. settle_market_internal — O/U engine, now delegating finalization.
-- ============================================================================
-- Unchanged behavior: sets over/under selection results from result_value vs
-- line, marks the market settled, then finalizes via the shared helper.
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

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_market_internal(uuid, numeric) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- C. settle_moneyline_market_internal — moneyline engine.
-- ============================================================================
-- Winner = the team with the higher combined game score (all rostered bowlers'
-- pinfall for the matchup's game). Equal totals → both sides push (refund). The
-- two selections are keyed by team id. Raises if the game has no scores yet —
-- the week settler guards this and closes scoreless markets instead.
CREATE OR REPLACE FUNCTION public.settle_moneyline_market_internal(p_market_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_market  public.bet_markets;
  v_team_a  uuid;
  v_team_b  uuid;
  v_total_a integer;
  v_total_b integer;
  v_n       integer;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type <> 'moneyline' THEN
    RAISE EXCEPTION 'settle_moneyline_market_internal only handles moneyline markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;
  IF v_market.subject_game_id IS NULL THEN
    RAISE EXCEPTION 'Moneyline market has no subject game';
  END IF;

  SELECT team_a_id, team_b_id INTO v_team_a, v_team_b
    FROM public.games WHERE id = v_market.subject_game_id;

  SELECT COUNT(*) INTO v_n
    FROM public.scores WHERE game_id = v_market.subject_game_id AND score IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No scores recorded for this game';
  END IF;

  -- Combined team pinfall for the matchup's game (all bowlers, incl. fills).
  SELECT COALESCE(SUM(sc.score), 0) INTO v_total_a
    FROM public.scores sc
    JOIN public.team_slots ts ON ts.id = sc.team_slot_id
    WHERE sc.game_id = v_market.subject_game_id AND ts.team_id = v_team_a AND sc.score IS NOT NULL;
  SELECT COALESCE(SUM(sc.score), 0) INTO v_total_b
    FROM public.scores sc
    JOIN public.team_slots ts ON ts.id = sc.team_slot_id
    WHERE sc.game_id = v_market.subject_game_id AND ts.team_id = v_team_b AND sc.score IS NOT NULL;

  UPDATE public.bet_selections s
    SET result = CASE
      WHEN v_total_a = v_total_b THEN 'push'
      WHEN s.key = v_team_a::text THEN CASE WHEN v_total_a > v_total_b THEN 'won' ELSE 'lost' END
      WHEN s.key = v_team_b::text THEN CASE WHEN v_total_b > v_total_a THEN 'won' ELSE 'lost' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  -- result_value left null (no numeric outcome for a moneyline).
  UPDATE public.bet_markets
    SET status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_moneyline_market_internal(uuid) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- D. settle_moneyline_market — admin wrapper for a single moneyline market.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_moneyline_market(p_market_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  PERFORM public.settle_moneyline_market_internal(p_market_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_moneyline_market(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_moneyline_market(uuid) TO authenticated;


-- ============================================================================
-- E. settle_betting_for_week — also settle moneylines after scores credit.
-- ============================================================================
-- Reproduces the original (score credits + O/U settlement) and adds a moneyline
-- pass: settle each non-settled moneyline market whose game has scores; close the
-- rest without a result (mirrors the O/U no-score path).
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

  -- Settle every non-settled moneyline market whose game has scores.
  FOR v_mkt IN
    SELECT id, subject_game_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'moneyline' AND status <> 'settled'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.scores
      WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
    ) THEN
      PERFORM public.settle_moneyline_market_internal(v_mkt.id);
    ELSE
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_betting_for_week(uuid) TO authenticated;
