-- ============================================================================
-- remove_over_under_markets_for_game — admin, refund + drop a game's O/U lines.
-- ============================================================================
-- The matchups admin can add/remove an arbitrary number of schedule games. Adding
-- a game calls sync_over_under_markets_for_week(week, [game]) to open its lines;
-- removing one needs the inverse — but the sync RPC never prunes a game (its target
-- set is the UNION of existing market game_numbers ∪ extra_games, so once a game's
-- markets exist that game stays targeted forever). This RPC is that inverse: it
-- refunds every bet touching the week+game's O/U markets and deletes the markets.
--
-- Refund semantics mirror the RSVP-out path in sync_over_under_markets_for_week and
-- cancel_bet: deleting a bet's pin_ledger rows by bet_id removes both the player and
-- house double-entry rows, restoring the balance to before the bet was placed. A
-- parlay leg on this game can't survive the market's removal, so the whole parlay is
-- refunded (same as RSVP-out). Markets cascade to their selections; bet_legs cascade
-- with the deleted bets.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.remove_over_under_markets_for_game(
  p_week_id     uuid,
  p_game_number integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Refund (delete both ledger rows of) every bet with a leg on this game's markets.
  DELETE FROM public.pin_ledger
    WHERE bet_id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = p_game_number
    );

  -- Delete those bets (cascades to their bet_legs across all of the parlay's games).
  DELETE FROM public.bets
    WHERE id IN (
      SELECT l.bet_id
      FROM public.bet_legs l
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets    m ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = p_game_number
    );

  -- Drop the markets themselves (cascades to bet_selections).
  DELETE FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
      AND m.game_number = p_game_number;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_over_under_markets_for_game(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_over_under_markets_for_game(uuid, integer) TO authenticated;
