-- PR4 — reversal redesign for the advance/settle split.
--
-- Two distinct repair paths:
--   unsettle_week  = "settlement was wrong / re-derive money from the SAME frozen
--                     scores or newer imports" — reverses ONLY the phase='settle'
--                     money, keeps the week advanced (locked). A following
--                     settle_week re-captures + re-derives.
--   unarchive_week = "reopen to edit scores" — full reversal (money if settled,
--                     then the advance-phase fill revert + N+1 destroy), week back
--                     in play. Rewritten to be phase-branched and to DROP the old
--                     bowled_at=NULL reset (bowled_at is the immutable scheduled
--                     date now — it must survive so re-import still binds).
--
-- Legacy monolithic runs (pre-split) work unchanged: PR2 labelled their money
-- rows phase='settle' and their fill 'scores' preimages phase='advance', and PR2
-- backfilled settled_at for every already-archived week — so unarchive takes the
-- settled branch and reverses them exactly as the old single-mode unarchive did.

-- ===========================================================================
-- unsettle_week — reverse phase='settle' money only; week stays advanced.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.unsettle_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_is_archived boolean;
  v_settled_at  timestamptz;
  v_run_id      uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, is_archived, settled_at
    INTO v_season_id, v_is_archived, v_settled_at
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF NOT v_is_archived THEN
    RAISE EXCEPTION 'Week is not advanced — nothing to unsettle';
  END IF;
  IF v_settled_at IS NULL THEN
    RAISE EXCEPTION 'Week is advanced but not settled — nothing to unsettle';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week';
  END IF;

  -- 1. Delete what settlement INSERTed (rows matching the predicate whose id is
  --    NOT in the run's phase='settle' preexisting set). Auction rows excluded —
  --    they reverse only via reverse_settled_auction.
  DELETE FROM public.activity_feed_events a
   WHERE a.week_id = p_week_id
     AND a.auction_id IS NULL
     AND a.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'activity_feed_events' AND phase = 'settle'
     );

  DELETE FROM public.pin_ledger pl
   WHERE (pl.week_id = p_week_id
          OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
     AND pl.auction_id IS NULL
     AND pl.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'pin_ledger' AND phase = 'settle'
     );

  DELETE FROM public.pvp_ledger pv
   WHERE pv.week_id = p_week_id
     AND pv.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'pvp_ledger' AND phase = 'settle'
     );

  DELETE FROM public.loan_ledger ll
   WHERE ll.week_id = p_week_id
     AND ll.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id'
          AND table_name = 'loan_ledger' AND phase = 'settle'
     );

  -- 2. Restore what settlement UPDATEd (phase='settle' pre-images). NOT the
  --    'scores' fill preimages — those are phase='advance' and the week stays
  --    locked, so the frozen scores remain for re-settle to grade on.
  UPDATE public.bet_markets m SET
      status       = sn.payload ->> 'status',
      result_value = (sn.payload ->> 'result_value')::numeric,
      settled_at   = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bet_markets' AND sn.pk = m.id;

  UPDATE public.bet_selections s SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bet_selections' AND sn.pk = s.id;

  UPDATE public.bets b SET
      status           = sn.payload ->> 'status',
      potential_payout = (sn.payload ->> 'potential_payout')::integer,
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bets' AND sn.pk = b.id;

  UPDATE public.bet_legs l SET
      result = sn.payload ->> 'result'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'bet_legs' AND sn.pk = l.id;

  UPDATE public.pvp_challenges c SET
      status           = sn.payload ->> 'status',
      winner_player_id = (sn.payload ->> 'winner_player_id')::uuid,
      result_detail    = COALESCE(sn.payload -> 'result_detail', '{}'::jsonb),
      settled_at       = (sn.payload ->> 'settled_at')::timestamptz,
      admin_note       = sn.payload ->> 'admin_note'
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'pvp_challenges' AND sn.pk = c.id;

  UPDATE public.pvp_challenge_offers o SET
      superseded_at = (sn.payload ->> 'superseded_at')::timestamptz,
      accepted_at   = (sn.payload ->> 'accepted_at')::timestamptz,
      declined_at   = (sn.payload ->> 'declined_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'pvp_challenge_offers' AND sn.pk = o.id;

  UPDATE public.loans ln SET
      status      = sn.payload ->> 'status',
      paid_off_at = (sn.payload ->> 'paid_off_at')::timestamptz
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
     AND sn.table_name = 'loans' AND sn.pk = ln.id;

  -- 3. Back to advanced-unsettled. Run stays 'active'.
  UPDATE public.weeks SET settled_at = NULL WHERE id = p_week_id;

  -- 4. Drop the phase='settle' snapshot rows so the next settle_week re-captures
  --    a clean pre-settle image.
  DELETE FROM public.week_archive_snapshot
   WHERE run_id = v_run_id AND phase = 'settle';
END;
$function$
;

-- ===========================================================================
-- unarchive_week — rewritten, phase-branched. Full reversal + reopen.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.unarchive_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id     uuid;
  v_week_number   integer;
  v_settled_at    timestamptz;
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

  SELECT season_id, week_number, settled_at INTO v_season_id, v_week_number, v_settled_at
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
  -- MONEY REVERSAL (phase='settle') — only if the week was actually settled.
  -- CRITICAL: gated on settled_at. On an advanced-but-UNSETTLED week there are
  -- no phase='settle' preexisting rows, so a `NOT IN (empty set)` delete would
  -- wipe every pre-existing ledger row. The gate makes the money reversal a
  -- no-op for the advanced-unsettled state.
  -- --------------------------------------------------------------------------
  IF v_settled_at IS NOT NULL THEN
    DELETE FROM public.activity_feed_events a
     WHERE a.week_id = p_week_id
       AND a.auction_id IS NULL
       AND a.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'activity_feed_events' AND phase = 'settle'
       );

    DELETE FROM public.pin_ledger pl
     WHERE (pl.week_id = p_week_id
            OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
       AND pl.auction_id IS NULL
       AND pl.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'pin_ledger' AND phase = 'settle'
       );

    DELETE FROM public.pvp_ledger pv
     WHERE pv.week_id = p_week_id
       AND pv.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'pvp_ledger' AND phase = 'settle'
       );

    DELETE FROM public.loan_ledger ll
     WHERE ll.week_id = p_week_id
       AND ll.id NOT IN (
         SELECT pk FROM public.week_archive_snapshot
          WHERE run_id = v_run_id AND kind = 'preexisting_id'
            AND table_name = 'loan_ledger' AND phase = 'settle'
       );

    UPDATE public.bet_markets m SET
        status       = sn.payload ->> 'status',
        result_value = (sn.payload ->> 'result_value')::numeric,
        settled_at   = (sn.payload ->> 'settled_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bet_markets' AND sn.pk = m.id;

    UPDATE public.bet_selections s SET
        result = sn.payload ->> 'result'
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bet_selections' AND sn.pk = s.id;

    UPDATE public.bets b SET
        status           = sn.payload ->> 'status',
        potential_payout = (sn.payload ->> 'potential_payout')::integer,
        settled_at       = (sn.payload ->> 'settled_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bets' AND sn.pk = b.id;

    UPDATE public.bet_legs l SET
        result = sn.payload ->> 'result'
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'bet_legs' AND sn.pk = l.id;

    UPDATE public.pvp_challenges c SET
        status           = sn.payload ->> 'status',
        winner_player_id = (sn.payload ->> 'winner_player_id')::uuid,
        result_detail    = COALESCE(sn.payload -> 'result_detail', '{}'::jsonb),
        settled_at       = (sn.payload ->> 'settled_at')::timestamptz,
        admin_note       = sn.payload ->> 'admin_note'
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'pvp_challenges' AND sn.pk = c.id;

    UPDATE public.pvp_challenge_offers o SET
        superseded_at = (sn.payload ->> 'superseded_at')::timestamptz,
        accepted_at   = (sn.payload ->> 'accepted_at')::timestamptz,
        declined_at   = (sn.payload ->> 'declined_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'pvp_challenge_offers' AND sn.pk = o.id;

    UPDATE public.loans ln SET
        status      = sn.payload ->> 'status',
        paid_off_at = (sn.payload ->> 'paid_off_at')::timestamptz
      FROM public.week_archive_snapshot sn
     WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'settle'
       AND sn.table_name = 'loans' AND sn.pk = ln.id;
  END IF;

  -- --------------------------------------------------------------------------
  -- ADVANCE REVERSAL (both states) — revert the phase='advance' fill scores,
  -- destroy week N+1, reopen week N.
  -- --------------------------------------------------------------------------
  UPDATE public.scores s SET
      score = (sn.payload ->> 'score')::integer
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row' AND sn.phase = 'advance'
     AND sn.table_name = 'scores' AND sn.pk = s.id;

  IF v_next_week_id IS NOT NULL THEN
    DELETE FROM public.rsvp  WHERE week_id = v_next_week_id;
    DELETE FROM public.weeks WHERE id = v_next_week_id;
  END IF;

  -- Reopen week N. bowled_at is DELIBERATELY preserved — it is the immutable
  -- scheduled bowl-Monday now, and must survive so a re-import still binds.
  UPDATE public.weeks SET is_archived = false, settled_at = NULL WHERE id = p_week_id;

  UPDATE public.week_archive_runs
     SET status = 'reversed', reversed_mode = 'unarchive', reversed_at = now()
   WHERE id = v_run_id;
END;
$function$
;
