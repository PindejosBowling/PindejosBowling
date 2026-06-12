-- bets.week_id consumers (TODO_DB_CONSOLIDATION §3, Migration B).
--
-- Rewrites every "bets in week" four-table join to bets.week_id:
--   archive_week        — snapshot 2a (pin_ledger bet branch) + preimage 2b
--                         (bets, bet_legs)
--   settle_betting_for_week — backstop count, error-title agg, force-void
--                         loop, house-net sum
--   unarchive_week      — pin_ledger delete + downstream bets count
-- The leg→market join survives only where it expresses market facts (the
-- prop-exemption checks and the error-title lookup need market_type/status/
-- title). archive_week + unarchive_week also adopt assert_admin() here
-- (HYGIENE §1 admin batch, folded since both bodies are rewritten anyway).

CREATE OR REPLACE FUNCTION public.archive_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id    uuid;
  v_week_number  integer;
  v_actor_id     uuid;
  v_run_id       uuid;
BEGIN
  PERFORM public.assert_admin();

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
  --     pin_ledger needs the bet_id branch — bet money is keyed by the bet.
  -- --------------------------------------------------------------------------
  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk)
  SELECT v_run_id, 'preexisting_id', 'pin_ledger', pl.id
    FROM public.pin_ledger pl
   WHERE pl.week_id = p_week_id
      OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id);

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
   WHERE b.week_id = p_week_id;

  INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
  SELECT v_run_id, 'preimage_row', 'bet_legs', l.id,
         jsonb_build_object('result', l.result)
    FROM public.bet_legs l
    JOIN public.bets b ON b.id = l.bet_id
   WHERE b.week_id = p_week_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  PERFORM public.assert_admin();

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
  -- bet_refund rows are bet-linked (and week-stamped) so unarchive deletes them.
  --
  -- EXEMPTION: bets with ≥1 leg on an UNSETTLED prop market (LaneTalk stat
  -- bets) are deliberately left pending — their data lands after archive and
  -- settle_lanetalk_props_for_week settles them on the Confirm clock.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_n_pending
  FROM public.bets b
  WHERE b.week_id = p_week_id AND b.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
    );

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE b.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND m.market_type <> 'prop'
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
        );

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      WHERE b.week_id = p_week_id AND b.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
        )
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, p_week_id,
        v_bet.stake, 'bet_refund', 'Voided at archive — market never settled', NULL, v_bet.id);
    END LOOP;
  END IF;

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  -- bet_id remains the authoritative link for bet money; bets.week_id scopes the week.
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
    WHERE pl.is_house = true
      AND pl.type IN ('bet_stake','bet_payout','bet_refund')
      AND pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id);

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
$function$;

CREATE OR REPLACE FUNCTION public.unarchive_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id     uuid;
  v_week_number   integer;
  v_run_id        uuid;
  v_next_week_id  uuid;
  v_n_scores      integer := 0;
  v_n_bets        integer := 0;
  v_n_pvp         integer := 0;
  v_n_loans       integer := 0;
  v_n_rsvp        integer := 0;
  v_n_ledger      integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- LIFO: only the most-recently-archived week can be unarchived.
  IF EXISTS (
    SELECT 1 FROM public.weeks w
     WHERE w.season_id = v_season_id AND w.is_archived = true AND w.week_number > v_week_number
  ) THEN
    RAISE EXCEPTION 'A later week is archived — unarchive the most recent week first';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week';
  END IF;

  SELECT id INTO v_next_week_id
    FROM public.weeks WHERE season_id = v_season_id AND week_number = v_week_number + 1;

  -- Downstream guard: warn (unless forced) if week N+1 holds real activity.
  IF v_next_week_id IS NOT NULL AND NOT p_force THEN
    SELECT count(*) INTO v_n_scores
      FROM public.scores sc
      JOIN public.team_slots ts ON ts.id = sc.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
     WHERE t.week_id = v_next_week_id AND sc.score IS NOT NULL;

    SELECT count(*) INTO v_n_bets
      FROM public.bets b WHERE b.week_id = v_next_week_id;

    SELECT count(*) INTO v_n_pvp  FROM public.pvp_challenges WHERE week_id = v_next_week_id;
    SELECT count(*) INTO v_n_rsvp FROM public.rsvp           WHERE week_id = v_next_week_id;
    SELECT count(*) INTO v_n_ledger FROM public.pin_ledger   WHERE week_id = v_next_week_id;

    IF (v_n_scores + v_n_bets + v_n_pvp + v_n_rsvp + v_n_ledger) > 0 THEN
      RAISE EXCEPTION 'Downstream activity in week %: % scores, % bets, % pvp, % rsvp, % ledger rows. Re-run with force to override.',
        v_week_number + 1, v_n_scores, v_n_bets, v_n_pvp, v_n_rsvp, v_n_ledger;
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3a. Delete the rows settlement INSERTed (everything matching the predicate
  --     whose id is NOT in the captured pre-existing set).
  -- --------------------------------------------------------------------------
  DELETE FROM public.activity_feed_events a
   WHERE a.week_id = p_week_id
     AND a.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'activity_feed_events'
     );

  DELETE FROM public.pin_ledger pl
   WHERE (pl.week_id = p_week_id
          OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
     AND pl.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'pin_ledger'
     );

  DELETE FROM public.pvp_ledger pv
   WHERE pv.week_id = p_week_id
     AND pv.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'pvp_ledger'
     );

  DELETE FROM public.loan_ledger ll
   WHERE ll.week_id = p_week_id
     AND ll.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'loan_ledger'
     );

  -- --------------------------------------------------------------------------
  -- 3b. Restore the columns settlement UPDATEd (verbatim pre-images).
  -- --------------------------------------------------------------------------
  UPDATE public.bet_markets m SET
      status       = sn.payload ->> 'status',
      result_value = (sn.payload ->> 'result_value')::numeric,
      settled_at   = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bet_markets' AND sn.pk = m.id;

  UPDATE public.bet_selections s SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bet_selections' AND sn.pk = s.id;

  UPDATE public.bets b SET
      status           = sn.payload ->> 'status',
      potential_payout = (sn.payload ->> 'potential_payout')::integer,
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bets' AND sn.pk = b.id;

  UPDATE public.bet_legs l SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'bet_legs' AND sn.pk = l.id;

  UPDATE public.pvp_challenges c SET
      status           = sn.payload ->> 'status',
      winner_player_id = (sn.payload ->> 'winner_player_id')::uuid,
      result_detail    = COALESCE(sn.payload -> 'result_detail', '{}'::jsonb),
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz,
      admin_note       = sn.payload ->> 'admin_note'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'pvp_challenges' AND sn.pk = c.id;

  UPDATE public.pvp_challenge_offers o SET
      superseded_at = (sn.payload ->> 'superseded_at')::timestamptz,
      accepted_at   = (sn.payload ->> 'accepted_at')::timestamptz,
      declined_at   = (sn.payload ->> 'declined_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'pvp_challenge_offers' AND sn.pk = o.id;

  UPDATE public.loans ln SET
      status      = sn.payload ->> 'status',
      paid_off_at = (sn.payload ->> 'paid_off_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'loans' AND sn.pk = ln.id;

  -- --------------------------------------------------------------------------
  -- 3c. Destroy week N+1. rsvp.week_id has no cascade → delete first.
  --     Teams/games/markets/pvp cascade; the refund_bets_before_market_delete
  --     trigger refunds any bets placed on N+1.
  -- --------------------------------------------------------------------------
  IF v_next_week_id IS NOT NULL THEN
    DELETE FROM public.rsvp  WHERE week_id = v_next_week_id;
    DELETE FROM public.weeks WHERE id = v_next_week_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3d. Reopen the week: it is simply in play again (scores editable,
  --     MatchupsScreen's Archive & Advance is the re-archive path).
  -- --------------------------------------------------------------------------
  UPDATE public.weeks SET is_archived = false, bowled_at = NULL WHERE id = p_week_id;

  UPDATE public.week_archive_runs
     SET status = 'reversed', reversed_mode = 'unarchive', reversed_at = now()
   WHERE id = v_run_id;
END;
$function$;
