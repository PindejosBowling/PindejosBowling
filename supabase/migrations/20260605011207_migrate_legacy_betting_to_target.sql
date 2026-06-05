-- ============================================================================
-- Phase 2 · WS5 — Migrate legacy betting history onto the target model.
-- ============================================================================
-- Moves bet_lines → bet_markets(+selections) and placed_bets → bets(+legs), and
-- backfills pin_ledger.bet_id for audit continuity, so Settled Bets / history is
-- unified on one model and the legacy tables can be dropped (WS6).
--
-- Re-runnable: every insert is guarded (markets by natural key; bets by whether
-- the source placed_bet's ledger rows already carry a bet_id).
--
-- Historical fidelity notes:
--   • Legacy was mint-on-win (player-only ledger), NOT double-entry. We do NOT
--     synthesise house counter-rows for historical bets — only new Phase-2 bets
--     are conservative. (The conservation invariant therefore holds only from the
--     cutover forward, by design.)
--   • Legacy ledger type values (bet_placed/bet_won/bet_push) are renamed to the
--     new vocabulary (bet_stake/bet_payout/bet_refund) so WS6 can prune them from
--     the type CHECK. The amounts already match the new semantics (stake debit,
--     total-return credit, stake refund).
-- ============================================================================

DO $$
DECLARE
  r          record;
  v_market   uuid;
  v_sel      uuid;
  v_bet      uuid;
  v_season   uuid;
  v_status   text;
  v_legres   text;
BEGIN
  -- 1. bet_lines → bet_markets + over/under selections -----------------------
  FOR r IN SELECT * FROM public.bet_lines LOOP
    SELECT id INTO v_market FROM public.bet_markets
      WHERE market_type = 'over_under' AND week_id = r.week_id
        AND game_number = r.game_number AND subject_player_id = r.player_id;

    IF v_market IS NULL THEN
      v_status := CASE WHEN r.result IS NOT NULL THEN 'settled'
                       WHEN r.is_open            THEN 'open'
                       ELSE 'closed' END;

      INSERT INTO public.bet_markets
        (market_type, title, week_id, game_number, subject_player_id, status,
         result_value, settled_at, created_at, updated_at)
      SELECT 'over_under', p.name || ' · Game ' || r.game_number, r.week_id,
             r.game_number, r.player_id, v_status, r.actual_score,
             CASE WHEN r.result IS NOT NULL THEN r.updated_at END,
             r.created_at, r.updated_at
      FROM public.players p WHERE p.id = r.player_id
      RETURNING id INTO v_market;

      INSERT INTO public.bet_selections (market_id, key, label, odds, line, result, sort_order) VALUES
        (v_market, 'over',  'Over',  2.000, r.line,
           CASE WHEN r.result IS NULL THEN NULL WHEN r.result = 'over'  THEN 'won'
                WHEN r.result = 'push' THEN 'push' ELSE 'lost' END, 0),
        (v_market, 'under', 'Under', 2.000, r.line,
           CASE WHEN r.result IS NULL THEN NULL WHEN r.result = 'under' THEN 'won'
                WHEN r.result = 'push' THEN 'push' ELSE 'lost' END, 1);
    END IF;
  END LOOP;

  -- 2. placed_bets → bets + bet_legs (+ ledger bet_id backfill) ---------------
  FOR r IN
    SELECT pb.id AS pb_id, pb.player_id, pb.pick, pb.wager, pb.settled_at, pb.created_at,
           bl.week_id, bl.game_number, bl.player_id AS subject_id, bl.line, bl.result AS line_result
    FROM public.placed_bets pb
    JOIN public.bet_lines bl ON bl.id = pb.bet_line_id
  LOOP
    -- Already migrated? (its bet_placed ledger row would already carry a bet_id.)
    IF EXISTS (
      SELECT 1 FROM public.pin_ledger
      WHERE placed_bet_id = r.pb_id AND bet_id IS NOT NULL
    ) THEN
      CONTINUE;
    END IF;

    SELECT season_id INTO v_season FROM public.weeks WHERE id = r.week_id;

    IF r.settled_at IS NULL THEN
      v_status := 'pending'; v_legres := NULL;
    ELSIF r.line_result = 'push' THEN
      v_status := 'push';    v_legres := 'push';
    ELSIF r.line_result = r.pick THEN
      v_status := 'won';     v_legres := 'won';
    ELSE
      v_status := 'lost';    v_legres := 'lost';
    END IF;

    INSERT INTO public.bets
      (player_id, season_id, counterparty, stake, potential_payout, status, placed_at, settled_at, created_at, updated_at)
    VALUES
      (r.player_id, v_season, 'house', r.wager, r.wager * 2, v_status, r.created_at, r.settled_at, r.created_at, COALESCE(r.settled_at, r.created_at))
    RETURNING id INTO v_bet;

    SELECT s.id INTO v_sel
    FROM public.bet_selections s
    JOIN public.bet_markets m ON m.id = s.market_id
    WHERE m.market_type = 'over_under' AND m.week_id = r.week_id
      AND m.game_number = r.game_number AND m.subject_player_id = r.subject_id
      AND s.key = r.pick;

    INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement, result)
      VALUES (v_bet, v_sel, 'back', 2.000, r.line, v_legres);

    -- Audit continuity: point the legacy ledger rows at the new bet.
    UPDATE public.pin_ledger SET bet_id = v_bet WHERE placed_bet_id = r.pb_id;
  END LOOP;
END $$;

-- 3. Rename legacy ledger type values to the new vocabulary (no-op if none). --
UPDATE public.pin_ledger SET type = 'bet_stake'  WHERE type = 'bet_placed';
UPDATE public.pin_ledger SET type = 'bet_payout' WHERE type = 'bet_won';
UPDATE public.pin_ledger SET type = 'bet_refund' WHERE type = 'bet_push';
