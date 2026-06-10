-- ============================================================================
-- Weekly Archive / Unarchive — atomic coupling + reversible point-in-time snapshot
-- ============================================================================
-- See ARCHIVE.md for the full design. Summary:
--
--   * archive_week(week) replaces the old 3 non-atomic client steps
--     (weeks.update is_archived → settle_betting_for_week → weeks.insert next week)
--     with ONE transaction that also captures a pre-image snapshot of everything
--     settlement is about to touch, anchored to a week_archive_runs row.
--
--   * unarchive_week(week, mode, force) restores the economy to the exact instant
--     before archive ran (delete the rows settlement INSERTed; restore the columns
--     settlement UPDATEd), always destroys week N+1, and — for 'hard' — also unlocks
--     the score lock (is_archived=false). Re-running archive_week then re-derives on
--     a clean slate.
--
--   * Mode vocabulary: 'soft' = reverse the economy, re-derive the SAME scores
--     (week stays archived/locked); 'hard' = also reopen the scores for editing
--     (is_archived → false). Both reverse the economy and destroy week N+1.
--
-- Reversal is snapshot-driven (not rule-based) so it cannot resurrect actions taken
-- BEFORE the archive (e.g. a PvP challenge cancelled by "Start Game", a manually
-- closed market): their pre-image is already in that state, so restore is a no-op.
--
-- Schema facts this relies on (verified against supabase/schema.sql):
--   * bet_payout/bet_refund pin_ledger rows have week_id = NULL (linked by bet_id) →
--     the pin_ledger predicate needs the bet_id branch.
--   * loan ledger is loan_ledger; pin link col is pin_ledger.loan_ledger_id.
--   * both settlement feed events (sportsbook_weekly_house_result, pvp_challenge_settled)
--     are week-stamped → activity_feed_events reverses by week_id (necessary: the
--     pvp event has a UNIQUE (pvp_challenge_id, event_type) index).
--   * rsvp.week_id has no ON DELETE CASCADE → delete N+1 rsvp rows before the week.
-- ============================================================================


-- ============================================================================
-- 1. Tables: the run anchor + the pre-image snapshot store.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.week_archive_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id       uuid        NOT NULL REFERENCES public.weeks(id)   ON DELETE CASCADE,
  season_id     uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  actor_id      uuid        REFERENCES public.players(id)          ON DELETE SET NULL,
  archived_at   timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  reversed_mode text        CHECK (reversed_mode IN ('soft', 'hard')),
  reversed_at   timestamptz,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),  -- required by the project table convention
  updated_at    timestamptz NOT NULL DEFAULT now()   -- (set_updated_at trigger auto-attached)
);

CREATE INDEX IF NOT EXISTS week_archive_runs_week_id_idx ON public.week_archive_runs (week_id, status);

CREATE TABLE IF NOT EXISTS public.week_archive_snapshot (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid        NOT NULL REFERENCES public.week_archive_runs(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('preexisting_id', 'preimage_row')),
  table_name text        NOT NULL,
  pk         uuid        NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()   -- required by the project table convention
);

CREATE INDEX IF NOT EXISTS week_archive_snapshot_run_idx
  ON public.week_archive_snapshot (run_id, table_name, kind);

ALTER TABLE public.week_archive_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_archive_snapshot ENABLE ROW LEVEL SECURITY;

-- Admin-only read (traceability). All writes happen through the SECURITY DEFINER
-- RPCs below; clients never write these tables directly.
CREATE POLICY "admin can read runs" ON public.week_archive_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'));
CREATE POLICY "admin can read snapshot" ON public.week_archive_snapshot AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'));


-- ============================================================================
-- 2. archive_week — atomic: snapshot → lock → settle → create next week.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.archive_week(p_week_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  -- --------------------------------------------------------------------------
  UPDATE public.weeks SET is_archived = true, bowled_at = current_date WHERE id = p_week_id;

  PERFORM public.settle_betting_for_week(p_week_id);

  INSERT INTO public.weeks (season_id, week_number)
    VALUES (v_season_id, v_week_number + 1)
    ON CONFLICT (season_id, week_number) DO NOTHING;

  RETURN v_run_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_week(uuid) TO authenticated;


-- ============================================================================
-- 3. unarchive_week — restore to the archive-time checkpoint + destroy week N+1.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.unarchive_week(
  p_week_id uuid,
  p_mode    text,
  p_force   boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_mode NOT IN ('soft', 'hard') THEN
    RAISE EXCEPTION 'mode must be soft or hard';
  END IF;

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

    SELECT count(DISTINCT b.id) INTO v_n_bets
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
     WHERE m.week_id = v_next_week_id;

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
          OR pl.bet_id IN (
               SELECT b.id FROM public.bets b
                 JOIN public.bet_legs l       ON l.bet_id = b.id
                 JOIN public.bet_selections s ON s.id = l.selection_id
                 JOIN public.bet_markets m    ON m.id = s.market_id
                WHERE m.week_id = p_week_id
             ))
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
  -- 3c. Destroy week N+1 (both modes). rsvp.week_id has no cascade → delete first.
  --     Teams/games/markets/pvp cascade; the refund_bets_before_market_delete
  --     trigger refunds any bets placed on N+1.
  -- --------------------------------------------------------------------------
  IF v_next_week_id IS NOT NULL THEN
    DELETE FROM public.rsvp  WHERE week_id = v_next_week_id;
    DELETE FROM public.weeks WHERE id = v_next_week_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3d. Mode branch: hard reopens the score lock (scores become editable);
  --     soft leaves the week archived (same scores re-derive on re-archive).
  -- --------------------------------------------------------------------------
  IF p_mode = 'hard' THEN
    UPDATE public.weeks SET is_archived = false, bowled_at = NULL WHERE id = p_week_id;
  END IF;

  UPDATE public.week_archive_runs
     SET status = 'reversed', reversed_mode = p_mode, reversed_at = now()
   WHERE id = v_run_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unarchive_week(uuid, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unarchive_week(uuid, text, boolean) TO authenticated;
