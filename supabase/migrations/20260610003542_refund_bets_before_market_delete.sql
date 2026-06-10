-- ============================================================================
-- refund_bets_before_market_delete — make line/market deletion self-cleaning.
-- ============================================================================
-- ROOT CAUSE this fixes:
--   A bet_markets row deleted DIRECTLY (raw SQL / console / any non-RPC path)
--   cascades only DOWNWARD: bet_markets -> bet_selections -> bet_legs. That
--   leaves two records the FK graph structurally cannot reach:
--     1. The `bets` row — it is the PARENT of bet_legs (bet_legs.bet_id -> bets
--        ON DELETE CASCADE), not a child of the market. SQL FK cascades never
--        propagate child->parent, so a legless `bets` row survives, stuck
--        'pending' with no market.
--     2. The pin_ledger pair — pin_ledger.bet_id -> bets is ON DELETE SET NULL
--        (audit-preserving by design), and the bet was never deleted anyway, so
--        the -stake / +stake double-entry pair is never reversed and the
--        bettor's balance stays depressed.
--   Reversing a placed bet is double-entry (delete BOTH ledger rows of the pair)
--   and deleting the bet is an upward propagation — neither is expressible as a
--   downward FK cascade. The correct teardown order already lives in
--   remove_over_under_markets_for_game (ledger -> bets -> markets); this trigger
--   bakes that same order into the table so EVERY delete path is correct, not
--   just that one RPC, and it generalizes to all market types (moneyline too).
--
-- BEHAVIOUR: BEFORE DELETE on bet_markets, refund (delete the ledger pair[s] by
--   bet_id, restoring balances) and delete every bet with a leg on the market
--   being removed. Deleting those bets cascades their bet_legs across ALL of a
--   parlay's games, so a parlay touching the removed market refunds whole — the
--   same semantics as remove_over_under_markets_for_game / the RSVP-out path.
--
-- COMPOSES with remove_over_under_markets_for_game: that RPC deletes the ledger +
--   bets before its own DELETE FROM bet_markets, so by the time this trigger
--   fires it finds no remaining bets and is a no-op. No recursion: deleting
--   bets / pin_ledger never cascades back into bet_markets.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refund_bets_before_market_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Refund: delete both ledger rows (player − and house +) of every bet that has
  -- a leg on a selection of the market about to be deleted. Removing the pair by
  -- bet_id restores the balance to before the bet was placed.
  DELETE FROM public.pin_ledger
   WHERE bet_id IN (
     SELECT l.bet_id
       FROM public.bet_legs l
       JOIN public.bet_selections s ON s.id = l.selection_id
      WHERE s.market_id = OLD.id
   );

  -- Delete those bets (cascades to their bet_legs across every game of a parlay,
  -- so a parlay touching this market refunds whole).
  DELETE FROM public.bets
   WHERE id IN (
     SELECT l.bet_id
       FROM public.bet_legs l
       JOIN public.bet_selections s ON s.id = l.selection_id
      WHERE s.market_id = OLD.id
   );

  RETURN OLD;  -- let the market delete proceed; it cascades to its bet_selections
END;
$$;

DROP TRIGGER IF EXISTS trg_refund_bets_before_market_delete ON public.bet_markets;
CREATE TRIGGER trg_refund_bets_before_market_delete
  BEFORE DELETE ON public.bet_markets
  FOR EACH ROW
  EXECUTE FUNCTION public.refund_bets_before_market_delete();
