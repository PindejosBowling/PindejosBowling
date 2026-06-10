-- ============================================================================
-- Settlement integrity: no sportsbook bet may survive archive in 'pending'.
-- ============================================================================
-- Three layers (see SETTLEMENT_ACCEPTANCE.md §C for the holes these close):
--
--   1. STRUCTURAL — sync_over_under_markets_for_week reworked:
--        * line ownership: RSVP owns the O/U lines until the week has teams;
--          the roster (non-fill team_slots) owns them once it does. Fixes
--          undrafted-in-players and week-editor roster swaps stranding lines.
--        * target games: once a schedule exists, the games table is the
--          authority — markets for game numbers outside it are pruned
--          (refund + delete). Fixes game-count shrink stranding game-3 lines.
--
--   2. COUPLING — statement-level triggers on rsvp / team_slots / games re-run
--      the sync after ANY mutation, so no client path can forget it. The
--      existing client-side sync calls stay (idempotent, harmless).
--
--   3. BACKSTOP — settle_betting_for_week gains a p_force flag and, after all
--      settlement steps, refuses to finish while any bet with a leg in the
--      week is still 'pending' (RAISE lists the unsettleable markets); with
--      p_force it voids + refunds those bets instead. archive_week(p_week_id,
--      p_force) threads the flag through. Snapshot-reversible: the void is an
--      UPDATE on bets/bet_legs (pre-images captured) + bet_refund INSERTs
--      (bet-linked, deleted by unarchive's pin_ledger predicate).
--
-- Also fixes the weekly House P&L feed event: bet_payout/bet_refund ledger
-- rows are NOT week-stamped (only bet-linked), so the old week_id-based SUM
-- only ever counted stakes. The sum now follows bet_id through the week's
-- markets.
-- ============================================================================


-- ============================================================================
-- 1. sync_over_under_markets_for_week — slot-coupled eligibility + authoritative
--    game set with pruning. Same signature (CREATE OR REPLACE keeps grants).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(p_week_id uuid, p_extra_games integer[] DEFAULT '{}'::integer[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_season_id    uuid;
  v_has_teams    boolean;
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

  -- Line ownership: RSVP owns the lines until the week has teams; the roster
  -- (non-fill team_slots) owns them after. The roster is who actually bowls —
  -- an in-RSVP player left undrafted, or a player swapped out in the week
  -- editor, must not keep a line nobody can ever settle.
  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;

  -- Target games: once a schedule exists the games table is authoritative
  -- (∪ p_extra_games for a just-inserted game in the same client flow).
  -- Before teams: existing market numbers ∪ extras, defaulting to {1, 2}.
  IF EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) THEN
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT g.game_number AS x FROM public.games g
          JOIN public.teams t ON t.id = g.team_a_id
         WHERE t.week_id = p_week_id
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT game_number AS x FROM public.bet_markets
          WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;

  -- --- Prune: refund + remove every O/U market whose subject is no longer ---
  -- eligible or whose game number is no longer scheduled. The BEFORE DELETE
  -- trigger (refund_bets_before_market_delete) refunds every touched bet whole
  -- (ledger pair + bet row), including parlays spanning other markets.
  -- Settled/void markets are immutable history — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status IN ('open', 'closed')
     AND (
       m.game_number <> ALL (v_target_games)
       OR (v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
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

  -- --- Create missing markets for eligible players × target games -------------
  FOR v_rec IN
    SELECT ep.player_id, g.game_number, p.name
    FROM (
      SELECT ts.player_id FROM public.team_slots ts
        JOIN public.teams t ON t.id = ts.team_id
       WHERE v_has_teams AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      SELECT r.player_id FROM public.rsvp r
       WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    CROSS JOIN UNNEST(v_target_games) AS g(game_number)
    JOIN public.players p ON p.id = ep.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = g.game_number AND m.subject_player_id = ep.player_id
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


-- ============================================================================
-- 2. Roster→market coupling triggers. Statement-level so a bulk RSVP save or
--    a cascaded wipe costs one sync, not one per row.
-- ============================================================================

-- Shared guard: skip weeks that are mid-cascade-delete (gone) or archived
-- (settled markets are immutable; nothing may resync them post-archive).
CREATE OR REPLACE FUNCTION public.resync_week_markets(p_week_id uuid, p_moneyline boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_week_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = p_week_id AND w.is_archived = false) THEN
    RETURN;
  END IF;
  PERFORM public.sync_over_under_markets_for_week(p_week_id);
  IF p_moneyline THEN
    PERFORM public.sync_moneyline_markets_for_week(p_week_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resync_week_markets(uuid, boolean) FROM PUBLIC, anon;

-- rsvp: week_id is on the row.
CREATE OR REPLACE FUNCTION public.trg_resync_markets_rsvp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN SELECT DISTINCT week_id FROM new_rows LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_week IN
      SELECT DISTINCT week_id FROM (
        SELECT week_id FROM new_rows UNION SELECT week_id FROM old_rows
      ) u
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSE
    FOR v_week IN SELECT DISTINCT week_id FROM old_rows LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- team_slots: week via teams. A cascaded slot delete (its team is being wiped)
-- resolves to no week → no-op; the rebuild flow's slot INSERTs resync instead.
CREATE OR REPLACE FUNCTION public.trg_resync_markets_team_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM new_rows nr JOIN public.teams t ON t.id = nr.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM (
        SELECT team_id FROM new_rows UNION SELECT team_id FROM old_rows
      ) u JOIN public.teams t ON t.id = u.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSE
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM old_rows o JOIN public.teams t ON t.id = o.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- games: week via teams; also syncs moneylines (they derive from games rows).
CREATE OR REPLACE FUNCTION public.trg_resync_markets_games()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM new_rows nr JOIN public.teams t ON t.id = nr.team_a_id
    LOOP
      PERFORM public.resync_week_markets(v_week, true);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM (
        SELECT team_a_id FROM new_rows UNION SELECT team_a_id FROM old_rows
      ) u JOIN public.teams t ON t.id = u.team_a_id
    LOOP
      PERFORM public.resync_week_markets(v_week, true);
    END LOOP;
  ELSE
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM old_rows o JOIN public.teams t ON t.id = o.team_a_id
    LOOP
      PERFORM public.resync_week_markets(v_week, true);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rsvp_resync_markets_ins ON public.rsvp;
DROP TRIGGER IF EXISTS rsvp_resync_markets_upd ON public.rsvp;
DROP TRIGGER IF EXISTS rsvp_resync_markets_del ON public.rsvp;
CREATE TRIGGER rsvp_resync_markets_ins AFTER INSERT ON public.rsvp
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_rsvp();
CREATE TRIGGER rsvp_resync_markets_upd AFTER UPDATE ON public.rsvp
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_rsvp();
CREATE TRIGGER rsvp_resync_markets_del AFTER DELETE ON public.rsvp
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_rsvp();

DROP TRIGGER IF EXISTS team_slots_resync_markets_ins ON public.team_slots;
DROP TRIGGER IF EXISTS team_slots_resync_markets_upd ON public.team_slots;
DROP TRIGGER IF EXISTS team_slots_resync_markets_del ON public.team_slots;
CREATE TRIGGER team_slots_resync_markets_ins AFTER INSERT ON public.team_slots
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_team_slots();
CREATE TRIGGER team_slots_resync_markets_upd AFTER UPDATE ON public.team_slots
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_team_slots();
CREATE TRIGGER team_slots_resync_markets_del AFTER DELETE ON public.team_slots
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_team_slots();

DROP TRIGGER IF EXISTS games_resync_markets_ins ON public.games;
DROP TRIGGER IF EXISTS games_resync_markets_upd ON public.games;
DROP TRIGGER IF EXISTS games_resync_markets_del ON public.games;
CREATE TRIGGER games_resync_markets_ins AFTER INSERT ON public.games
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_games();
CREATE TRIGGER games_resync_markets_upd AFTER UPDATE ON public.games
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_games();
CREATE TRIGGER games_resync_markets_del AFTER DELETE ON public.games
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_games();


-- ============================================================================
-- 3. settle_betting_for_week(p_week_id, p_force) — body unchanged except:
--    (a) the no-pending-bets backstop before the House P&L event;
--    (b) the House P&L sum follows bet_id (payout/refund rows are not
--        week-stamped, so the old week_id SUM only ever counted stakes).
--    Signature change → DROP + CREATE (+ re-grant).
-- ============================================================================
DROP FUNCTION IF EXISTS public.settle_betting_for_week(uuid);

CREATE FUNCTION public.settle_betting_for_week(p_week_id uuid, p_force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
  v_n_pending   integer;
  v_titles      text;
  v_bet         record;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week. Stamp week_id so the entry
  -- groups under the correct week in the per-player ledger.
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
      -- No score -> close without a result (bets caught by the backstop below).
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

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- --------------------------------------------------------------------------
  -- Backstop: settlement must leave NO pending sportsbook bet, whatever market
  -- type or roster disconnect produced it. Without force: abort (the whole
  -- archive transaction rolls back) and name the unsettleable markets. With
  -- force: void those bets and refund their stakes. The void is snapshot-
  -- reversible — bets/bet_legs pre-images are captured by archive_week, and the
  -- bet_refund rows are bet-linked so unarchive deletes them.
  -- --------------------------------------------------------------------------
  SELECT count(DISTINCT b.id) INTO v_n_pending
  FROM public.bets b
  JOIN public.bet_legs l       ON l.bet_id = b.id
  JOIN public.bet_selections s ON s.id = l.selection_id
  JOIN public.bet_markets m    ON m.id = s.market_id
  WHERE m.week_id = p_week_id AND b.status = 'pending';

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled';

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND b.status = 'pending'
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, false,  v_bet.stake, 'bet_refund', 'Voided at archive — market never settled',         v_bet.id),
        (NULL,            v_bet.season_id, true,  -v_bet.stake, 'bet_refund', 'Voided at archive — market never settled (house)', v_bet.id);
    END LOOP;
  END IF;

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  -- Summed via bet_id through the week's markets: bet_payout/bet_refund rows are
  -- not week-stamped, so a week_id predicate would only ever count the stakes.
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
    WHERE pl.is_house = true
      AND pl.type IN ('bet_stake','bet_payout','bet_refund')
      AND pl.bet_id IN (
        SELECT DISTINCT l.bet_id
        FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        JOIN public.bet_markets m    ON m.id = s.market_id
        WHERE m.week_id = p_week_id
      );

  -- Idempotency: no source FK exists, so guard on (season, week, event_type).
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_betting_for_week(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_betting_for_week(uuid, boolean) TO authenticated;


-- ============================================================================
-- 4. archive_week(p_week_id, p_force) — verbatim except the force flag threads
--    into settlement. Signature change → DROP + CREATE (+ re-grant).
-- ============================================================================
DROP FUNCTION IF EXISTS public.archive_week(uuid);

CREATE FUNCTION public.archive_week(p_week_id uuid, p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_season_id    uuid;
  v_week_number  integer;
  v_actor_id     uuid;
  v_run_id       uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- One active run per week. The soft-unarchive flow marks the run 'reversed', so a
  -- re-archive after a soft/hard unarchive is allowed; an accidental double-archive
  -- (no unarchive between) is not.
  IF EXISTS (SELECT 1 FROM public.week_archive_runs WHERE week_id = p_week_id AND status = 'active') THEN
    RAISE EXCEPTION 'Week already has an active archive run — unarchive it first';
  END IF;

  SELECT id INTO v_actor_id FROM public.players WHERE user_id = (SELECT auth.uid());

  INSERT INTO public.week_archive_runs (week_id, season_id, actor_id)
    VALUES (p_week_id, v_season_id, v_actor_id)
    RETURNING id INTO v_run_id;

  -- --------------------------------------------------------------------------
  -- 2a. Capture pre-existing append-row ids (everything settlement will INSERT).
  --     pin_ledger needs the bet_id branch (bet_payout/refund have week_id NULL).
  -- --------------------------------------------------------------------------
  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk)
  SELECT v_run_id, 'preexisting_id', 'pin_ledger', pl.id
    FROM public.pin_ledger pl
   WHERE pl.week_id = p_week_id
      OR pl.bet_id IN (
           SELECT b.id FROM public.bets b
             JOIN public.bet_legs l       ON l.bet_id = b.id
             JOIN public.bet_selections s ON s.id = l.selection_id
             JOIN public.bet_markets m    ON m.id = s.market_id
            WHERE m.week_id = p_week_id
         );

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk)
  SELECT v_run_id, 'preexisting_id', 'loan_ledger', ll.id
    FROM public.loan_ledger ll WHERE ll.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk)
  SELECT v_run_id, 'preexisting_id', 'pvp_ledger', pv.id
    FROM public.pvp_ledger pv WHERE pv.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk)
  SELECT v_run_id, 'preexisting_id', 'activity_feed_events', af.id
    FROM public.activity_feed_events af WHERE af.week_id = p_week_id;

  -- --------------------------------------------------------------------------
  -- 2b. Capture column pre-images (everything settlement will UPDATE).
  -- --------------------------------------------------------------------------
  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'bet_markets', m.id,
         jsonb_build_object('status', m.status, 'result_value', m.result_value, 'settled_at', m.settled_at)
    FROM public.bet_markets m WHERE m.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'bet_selections', s.id,
         jsonb_build_object('result', s.result)
    FROM public.bet_selections s
    JOIN public.bet_markets m ON m.id = s.market_id
   WHERE m.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'bets', b.id,
         jsonb_build_object('status', b.status, 'potential_payout', b.potential_payout, 'settled_at', b.settled_at)
    FROM public.bets b
   WHERE b.id IN (
           SELECT b2.id FROM public.bets b2
             JOIN public.bet_legs l       ON l.bet_id = b2.id
             JOIN public.bet_selections s ON s.id = l.selection_id
             JOIN public.bet_markets m    ON m.id = s.market_id
            WHERE m.week_id = p_week_id
         );

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'bet_legs', l.id,
         jsonb_build_object('result', l.result)
    FROM public.bet_legs l
    JOIN public.bet_selections s ON s.id = l.selection_id
    JOIN public.bet_markets m    ON m.id = s.market_id
   WHERE m.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'pvp_challenges', c.id,
         jsonb_build_object('status', c.status, 'winner_player_id', c.winner_player_id,
                            'result_detail', c.result_detail, 'settled_at', c.settled_at,
                            'admin_note', c.admin_note)
    FROM public.pvp_challenges c WHERE c.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'pvp_challenge_offers', o.id,
         jsonb_build_object('superseded_at', o.superseded_at, 'accepted_at', o.accepted_at,
                            'declined_at', o.declined_at)
    FROM public.pvp_challenge_offers o
    JOIN public.pvp_challenges c ON c.id = o.challenge_id
   WHERE c.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'loans', ln.id,
         jsonb_build_object('status', ln.status, 'paid_off_at', ln.paid_off_at)
    FROM public.loans ln
   WHERE ln.season_id = v_season_id AND ln.status = 'active';

  -- --------------------------------------------------------------------------
  -- 2c. Lock the week, run settlement, create the next week — all-or-nothing.
  --     p_force: void+refund any bet settlement would otherwise leave pending
  --     (see settle_betting_for_week's backstop).
  -- --------------------------------------------------------------------------
  UPDATE public.weeks SET is_archived = true, bowled_at = current_date WHERE id = p_week_id;

  PERFORM public.settle_betting_for_week(p_week_id, p_force);

  INSERT INTO public.weeks (season_id, week_number)
    VALUES (v_season_id, v_week_number + 1)
    ON CONFLICT (season_id, week_number) DO NOTHING;

  RETURN v_run_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_week(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_week(uuid, boolean) TO authenticated;
