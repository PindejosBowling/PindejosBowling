-- ─────────────────────────────────────────────────────────────────────────────
-- One-time re-ladder: sweep pre-fair-tails posted ladders off the live board.
--
-- Betless open markets re-ladder on sync, but sync is trigger-coupled
-- (rsvp/games/scores/team_slots) and nothing fired after the …234500
-- fair_tail_odds / …001500 min_offered_odds policy rewrite — so the board
-- still carried ladders minted under the retired odds ceiling (e.g. a night
-- pins seed posted at the legacy odds_max ×8.000 clamp vs. its ×8.30 fair
-- price — the stale quote behind the 2026-07-23 correlated-parlay inversion,
-- structurally fixed in …040000_parlay_quote_implied_joint). Re-run the
-- standard resync once: every non-archived week's betless markets rebuild at
-- the current model's fair lines/odds (seed rungs keep their canonical
-- 'over'/'under' keys — they are load-bearing identity, never deleted);
-- markets with any bet stay frozen (the probe-asserted invariant).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE w record;
BEGIN
  FOR w IN SELECT id FROM public.weeks WHERE is_archived = false LOOP
    PERFORM public.resync_week_markets(w.id);
  END LOOP;
END $$;
