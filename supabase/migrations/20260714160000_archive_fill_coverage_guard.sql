-- Coverage guard for archive-time fill materialization.
--
-- `…090000_archive_fill_score_materialization` made archive_week stamp the
-- on-screen values for unscored fill slots — but only when the client passes
-- p_fill_scores. An OUTDATED client (or any caller omitting the payload)
-- could still archive a week with unscored fill rows and silently reproduce
-- the original bug: the fill's contribution vanishes from archived records
-- and settlement (observed on S3W2 — archive ran from a pre-fix app build,
-- zero scores pre-images in the snapshot, both moneylines graded as if the
-- fill team scored 0).
--
-- Fix: after materialization, RAISE (rolling the whole archive back) if any
-- unscored fill participation row remains, provided
--   (a) the week was actually bowled (≥1 stored score) — an abandoned,
--       never-bowled week still archives from any client (nothing to grade;
--       markets close and the backstop voids), and
--   (b) any archived counted score exists league-wide — the server proxy for
--       "league average > 0". When the league has no history at all, the
--       client's estimate is 0 and it legitimately omits those rows (a NULL
--       row and a 0 estimate contribute identically).
--
-- Same signature → CREATE OR REPLACE; grants carry over.

CREATE OR REPLACE FUNCTION public.archive_week(p_week_id uuid, p_force boolean DEFAULT false, p_fill_scores jsonb DEFAULT NULL)
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
  -- 2b''. Coverage guard: no unscored fill row may survive into settlement.
  --       A caller that omits (or under-covers with) p_fill_scores would
  --       silently archive records/settle bets without the fill's on-screen
  --       contribution — the exact bug materialization fixes. Exemptions:
  --       a never-bowled week (nothing to grade), and a league with no
  --       archived history (the client's estimate is 0 → rows legitimately
  --       omitted; a NULL row contributes the same 0).
  -- --------------------------------------------------------------------------
  IF EXISTS (SELECT 1
               FROM public.scores s
               JOIN public.team_slots ts ON ts.id = s.team_slot_id
               JOIN public.teams t       ON t.id = ts.team_id
              WHERE t.week_id = p_week_id AND ts.is_fill AND s.score IS NULL)
     AND EXISTS (SELECT 1
               FROM public.scores s
               JOIN public.team_slots ts ON ts.id = s.team_slot_id
               JOIN public.teams t       ON t.id = ts.team_id
              WHERE t.week_id = p_week_id AND s.score IS NOT NULL)
     AND EXISTS (SELECT 1
               FROM public.scores s
               JOIN public.team_slots ts ON ts.id = s.team_slot_id
               JOIN public.teams t       ON t.id = ts.team_id
               JOIN public.weeks w       ON w.id = t.week_id
              WHERE w.is_archived AND ts.is_fill = false
                AND ts.player_id IS NOT NULL AND s.score > 0)
  THEN
    RAISE EXCEPTION 'Unscored fill slots remain — the archive did not receive their on-screen values (p_fill_scores). Update the app and retry, or enter the fill scores manually.';
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
