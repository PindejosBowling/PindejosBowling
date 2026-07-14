-- Archive-time fill-score materialization.
--
-- Bug: an unscored fill slot (team_slots.player_id IS NULL) shows its
-- league-average estimate on the live MatchupsScreen — and the on-screen
-- win/loss reflects it — but nothing ever persisted that value. Archived
-- reads filter `score IS NOT NULL`, so the fill's contribution vanished at
-- archive time (S3W1: Team 1's fill 117 dropped, flipping the record), and
-- settlement (moneyline / team total_pins) never saw it either.
--
-- Fix: archive_week gains `p_fill_scores jsonb` — the app passes the exact
-- values displayed on screen ([{team_slot_id, game_id, score}, ...]); stored
-- matchup scores remain the source of truth (an already-scored fill row in
-- the payload is a stale screen → RAISE, whole archive rolls back). The
-- materialization runs BEFORE the lock + settlement, its pre-images are
-- captured as `preimage_row/'scores'` snapshot rows, and unarchive_week
-- restores them (back to NULL), keeping the archive→unarchive→archive
-- round-trip exact.

-- ----------------------------------------------------------------------------
-- 1. archive_week — new signature (drop the old one: two overloads would make
--    the PostgREST rpc('archive_week', ...) call ambiguous).
-- ----------------------------------------------------------------------------
DROP FUNCTION public.archive_week(uuid, boolean);

CREATE FUNCTION public.archive_week(p_week_id uuid, p_force boolean DEFAULT false, p_fill_scores jsonb DEFAULT NULL)
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
  v_n_fill       integer := 0;
  v_n_bad        integer := 0;
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
  -- 2b'. Materialize unscored fill scores (the values the live screen showed).
  --      The app passes [{team_slot_id, game_id, score}, ...] for every fill
  --      participation row that is still NULL — an unscored fill contributes
  --      its league-average estimate to the on-screen totals, and the archived
  --      record + settlement must grade on those same totals. Stored scores
  --      (admin-typed fill values included) are the source of truth: a payload
  --      row targeting a non-NULL score means the screen was stale → abort.
  --      Runs BEFORE the lock/settlement so moneyline + team total_pins see
  --      the values; pre-images (always NULL) are snapshotted so unarchive
  --      reverts them exactly.
  -- --------------------------------------------------------------------------
  IF p_fill_scores IS NOT NULL AND jsonb_typeof(p_fill_scores) = 'array'
     AND jsonb_array_length(p_fill_scores) > 0 THEN

    SELECT count(*) INTO v_n_bad
      FROM jsonb_to_recordset(p_fill_scores)
             AS f(team_slot_id uuid, game_id uuid, score integer)
      LEFT JOIN public.scores s      ON s.team_slot_id = f.team_slot_id AND s.game_id = f.game_id
      LEFT JOIN public.team_slots ts ON ts.id = f.team_slot_id
      LEFT JOIN public.teams t       ON t.id = ts.team_id
     WHERE s.id IS NULL
        OR t.week_id IS DISTINCT FROM p_week_id
        OR ts.is_fill IS DISTINCT FROM true
        OR s.score IS NOT NULL
        OR f.score IS NULL OR f.score < 1;
    IF v_n_bad > 0 THEN
      RAISE EXCEPTION 'Invalid or stale fill-score payload (% row(s)) — scores changed since the screen loaded; close and retry', v_n_bad;
    END IF;

    SELECT count(*) INTO v_n_fill
      FROM (SELECT DISTINCT team_slot_id, game_id
              FROM jsonb_to_recordset(p_fill_scores)
                     AS f(team_slot_id uuid, game_id uuid, score integer)) d;
    IF v_n_fill <> jsonb_array_length(p_fill_scores) THEN
      RAISE EXCEPTION 'Duplicate rows in fill-score payload';
    END IF;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload)
    SELECT v_run_id, 'preimage_row', 'scores', s.id, jsonb_build_object('score', s.score)
      FROM jsonb_to_recordset(p_fill_scores) AS f(team_slot_id uuid, game_id uuid, score integer)
      JOIN public.scores s ON s.team_slot_id = f.team_slot_id AND s.game_id = f.game_id;

    UPDATE public.scores s SET score = f.score
      FROM jsonb_to_recordset(p_fill_scores) AS f(team_slot_id uuid, game_id uuid, score integer)
     WHERE s.team_slot_id = f.team_slot_id AND s.game_id = f.game_id;
  END IF;

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
$function$
;

REVOKE EXECUTE ON FUNCTION public.archive_week(uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_week(uuid, boolean, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. unarchive_week — restore the materialized fill scores (pre-image is NULL)
--    in section 3b, alongside the other verbatim pre-image restores.
-- ----------------------------------------------------------------------------
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
  -- Auction exemption (both deletes): auction activity settles on its own
  -- clock and is reversed only by reverse_settled_auction — the archive
  -- engine never touches it.
  DELETE FROM public.activity_feed_events a
   WHERE a.week_id = p_week_id
     AND a.auction_id IS NULL
     AND a.id NOT IN (
       SELECT pk FROM public.week_archive_snapshot
        WHERE run_id = v_run_id AND kind = 'preexisting_id' AND table_name = 'activity_feed_events'
     );

  DELETE FROM public.pin_ledger pl
   WHERE (pl.week_id = p_week_id
          OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id))
     AND pl.auction_id IS NULL
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

  -- Fill scores archive_week materialized revert to their pre-image (NULL) —
  -- the unscored fill goes back to being a live league-average estimate.
  UPDATE public.scores s SET
      score = (sn.payload ->> 'score')::integer
    FROM public.week_archive_snapshot sn
   WHERE sn.run_id = v_run_id AND sn.kind = 'preimage_row'
     AND sn.table_name = 'scores' AND sn.pk = s.id;

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
$function$
;
