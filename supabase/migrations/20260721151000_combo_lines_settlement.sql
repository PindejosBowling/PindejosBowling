-- Combo Lines (settlement): teach the settle engine about market_type='combo'.
--
--   1. settle_market_internal — accept 'combo' (generic over/under grading;
--      also enables the admin settle_market escape hatch for combos)
--   2. settle_week — new step (c''') settling combos on both clocks (archive
--      total_pins from scores, LaneTalk frame stats from official imports)
--      with a per-member complete-data guard, plus the backstop exemption
--      widened to combos at all three sites
--   3. settle_betting_for_week (legacy, probe-only) — same exemption widening
--   4. preview_settle_week — mirrored combo branch with human-readable
--      would-void reasons (else the default branch reports combos settleable)
--
-- unsettle_week/unarchive_week need no changes: combos only mutate columns the
-- settle-phase snapshot already captures, and their money is bet-linked
-- week-stamped ledger pairs.

CREATE OR REPLACE FUNCTION public.settle_market_internal(p_market_id uuid, p_result_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market public.bet_markets;
BEGIN
  SELECT * INTO v_market FROM public.bet_markets WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.market_type NOT IN ('over_under', 'prop', 'team_prop', 'combo') THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under/prop/team_prop/combo markets';
  END IF;
  IF v_market.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;

  -- Selection results: over wins above the line, under below; half-point lines
  -- never push, but equality is handled as push for completeness.
  UPDATE public.bet_selections s
    SET result = CASE
      WHEN s.key = 'over'  THEN CASE WHEN p_result_value > s.line THEN 'won'
                                     WHEN p_result_value < s.line THEN 'lost' ELSE 'push' END
      WHEN s.key = 'under' THEN CASE WHEN p_result_value < s.line THEN 'won'
                                     WHEN p_result_value > s.line THEN 'lost' ELSE 'push' END
      ELSE s.result END
    WHERE s.market_id = p_market_id;

  UPDATE public.bet_markets
    SET result_value = p_result_value, status = 'settled', settled_at = now()
    WHERE id = p_market_id;

  PERFORM public.finalize_bets_for_market(p_market_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_week(p_week_id uuid, p_void_missing boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_is_archived boolean;
  v_run_id      uuid;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
  v_n_pending   integer;
  v_titles      text;
  v_bet         record;
  -- LaneTalk fold locals
  v_stat        text;
  v_value       numeric;
  v_team_id     uuid;
  v_complete    boolean;
  v_official_n  integer;
  v_scored_n    integer;
  v_settled     integer := 0;
  v_voided      integer := 0;
  v_pending     integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number, is_archived
    INTO v_season_id, v_week_number, v_is_archived
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF NOT v_is_archived THEN
    RAISE EXCEPTION 'Week must be advanced (locked) before it can be settled';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week — advance it first';
  END IF;

  -- --------------------------------------------------------------------------
  -- Money snapshot capture, phase='settle', ONCE per run. Skipped on re-settle
  -- so the snapshot pins the pre-FIRST-settle state; re-settle is additive via
  -- the per-step guards and stays reversible by unsettle/unarchive.
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.week_archive_snapshot WHERE run_id = v_run_id AND phase = 'settle') THEN
    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'pin_ledger', pl.id, 'settle'
      FROM public.pin_ledger pl
     WHERE pl.week_id = p_week_id
        OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id);

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'loan_ledger', ll.id, 'settle'
      FROM public.loan_ledger ll WHERE ll.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'pvp_ledger', pv.id, 'settle'
      FROM public.pvp_ledger pv WHERE pv.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'activity_feed_events', af.id, 'settle'
      FROM public.activity_feed_events af WHERE af.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_markets', m.id,
           jsonb_build_object('status', m.status, 'result_value', m.result_value, 'settled_at', m.settled_at), 'settle'
      FROM public.bet_markets m WHERE m.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_selections', s.id,
           jsonb_build_object('result', s.result), 'settle'
      FROM public.bet_selections s
      JOIN public.bet_markets m ON m.id = s.market_id
     WHERE m.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bets', b.id,
           jsonb_build_object('status', b.status, 'potential_payout', b.potential_payout, 'settled_at', b.settled_at), 'settle'
      FROM public.bets b WHERE b.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_legs', l.id,
           jsonb_build_object('result', l.result), 'settle'
      FROM public.bet_legs l
      JOIN public.bets b ON b.id = l.bet_id
     WHERE b.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'pvp_challenges', c.id,
           jsonb_build_object('status', c.status, 'winner_player_id', c.winner_player_id,
                              'result_detail', c.result_detail, 'settled_at', c.settled_at,
                              'admin_note', c.admin_note), 'settle'
      FROM public.pvp_challenges c WHERE c.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'pvp_challenge_offers', o.id,
           jsonb_build_object('superseded_at', o.superseded_at, 'accepted_at', o.accepted_at,
                              'declined_at', o.declined_at), 'settle'
      FROM public.pvp_challenge_offers o
      JOIN public.pvp_challenges c ON c.id = o.challenge_id
     WHERE c.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'loans', ln.id,
           jsonb_build_object('status', ln.status, 'paid_off_at', ln.paid_off_at), 'settle'
      FROM public.loans ln
     WHERE ln.season_id = v_season_id AND ln.status = 'active';
  END IF;

  -- (a) Score credits (player-only mints), once per week.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE week_id = p_week_id AND type = 'score_credit'
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

  -- (b) O/U settlement. Game markets: subject's game score. Night markets
  --     (game_number NULL): Σ subject's non-fill scores across the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    IF v_mkt.game_number IS NOT NULL THEN
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
    ELSE
      SELECT SUM(s.score)::integer INTO v_score
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;
    END IF;

    IF v_score IS NULL THEN
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- (c) Moneyline settlement.
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

  -- (c') team_prop TOTAL PINS markets (archive clock).
  FOR v_mkt IN
    SELECT id, subject_game_id, (params ->> 'team_id')::uuid AS team_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'team_prop'
      AND params ->> 'stat' = 'total_pins' AND params ->> 'clock' = 'archive'
      AND status <> 'settled'
  LOOP
    IF v_mkt.subject_game_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.scores
        WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE sc.game_id = v_mkt.subject_game_id
          AND ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id AND sc.score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    END IF;
  END LOOP;

  -- (c'') LaneTalk player + team props (FOLDED IN from
  --       settle_lanetalk_props_for_week). Settles off official imports; markets
  --       with no gradable value are delete-refunded when p_void_missing, else
  --       left pending (exempt from the backstop below).
  FOR v_mkt IN
    SELECT id, market_type, subject_player_id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id
      AND status IN ('open', 'closed')
      AND ((market_type = 'prop' AND params ->> 'source' = 'lanetalk')
        OR (market_type = 'team_prop' AND params ->> 'clock' = 'lanetalk'))
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_mkt.market_type = 'team_prop' THEN
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames') THEN
        RAISE EXCEPTION 'Unknown LaneTalk team stat % on market %', v_stat, v_mkt.id;
      END IF;
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;

      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.team_slots ts
          JOIN public.scores s ON s.team_slot_id = ts.id
          JOIN public.games g  ON g.id = s.game_id
          WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
            AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.lanetalk_game_imports i
              WHERE i.week_id = p_week_id
                AND i.player_id = ts.player_id
                AND i.game_number = g.game_number
                AND i.classification = 'official')
        ) INTO v_complete;

        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        JOIN public.team_slots ts ON ts.team_id = v_team_id
                                 AND ts.player_id = i.player_id
                                 AND ts.is_fill = false
        WHERE i.week_id = p_week_id
          AND i.game_number = v_mkt.game_number
          AND i.classification = 'official';

        IF v_complete AND v_official_n > 0 THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id
                                   AND ts.player_id = i.player_id
                                   AND ts.is_fill = false
          WHERE i.week_id = p_week_id
            AND i.game_number = v_mkt.game_number
            AND i.classification = 'official';
        END IF;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.team_slots ts
          WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
            AND (SELECT count(*) FROM public.scores s
                 WHERE s.team_slot_id = ts.id AND s.score IS NOT NULL)
              > (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = ts.player_id
                   AND i.classification = 'official')
        ) INTO v_complete;

        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        JOIN public.team_slots ts ON ts.team_id = v_team_id
                                 AND ts.player_id = i.player_id
                                 AND ts.is_fill = false
        WHERE i.week_id = p_week_id
          AND i.classification = 'official';

        IF v_complete AND v_official_n > 0 THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id
                                   AND ts.player_id = i.player_id
                                   AND ts.is_fill = false
          WHERE i.week_id = p_week_id
            AND i.classification = 'official'
            AND i.frames > 0;
        END IF;
      END IF;

    ELSE
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames', 'clean_pct', 'first_ball_avg') THEN
        RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
      END IF;

      IF v_mkt.game_number IS NOT NULL THEN
        SELECT CASE v_stat
                 WHEN 'strikes'        THEN st.strikes::numeric
                 WHEN 'spares'         THEN st.spares::numeric
                 WHEN 'clean_frames'   THEN (st.strikes + st.spares)::numeric
                 WHEN 'clean_pct'      THEN st.clean_pct
                 WHEN 'first_ball_avg' THEN st.first_ball_avg
               END
          INTO v_value
        FROM public.lanetalk_game_imports i
        CROSS JOIN LATERAL (
          SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg
        ) st
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.game_number = v_mkt.game_number
          AND i.classification = 'official'
        LIMIT 1;
      ELSE
        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.classification = 'official';

        SELECT count(*) INTO v_scored_n
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = p_week_id
          AND ts.player_id = v_mkt.subject_player_id
          AND ts.is_fill = false
          AND s.score IS NOT NULL;

        IF v_official_n > 0 AND v_official_n >= v_scored_n THEN
          SELECT CASE v_stat
                   WHEN 'strikes'        THEN SUM(st.strikes)::numeric
                   WHEN 'spares'         THEN SUM(st.spares)::numeric
                   WHEN 'clean_frames'   THEN (SUM(st.strikes) + SUM(st.spares))::numeric
                   WHEN 'clean_pct'      THEN SUM(st.clean_pct * st.frames) / NULLIF(SUM(st.frames), 0)
                   WHEN 'first_ball_avg' THEN SUM(st.first_ball_avg * st.frames) / NULLIF(SUM(st.frames), 0)
                 END
            INTO v_value
          FROM public.lanetalk_game_imports i
          CROSS JOIN LATERAL (
            SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg, i.frames
          ) st
          WHERE i.week_id = p_week_id
            AND i.player_id = v_mkt.subject_player_id
            AND i.classification = 'official'
            AND st.frames > 0;
        END IF;
      END IF;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  -- (c''') Combo markets (BOTH clocks): Σ member stats vs the line. A combo
  --        settles only when EVERY member has complete data for its scope —
  --        an absent member never silently settles the sum low. Missing data
  --        ⇒ delete-refund when p_void_missing (the refund-trigger rail),
  --        else left pending (exempt from the backstop below, both clocks:
  --        an archive-clock combo missing a member score will never
  --        self-heal, but preview flags it and voidMissing resolves it).
  FOR v_mkt IN
    SELECT id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'combo'
      AND status IN ('open', 'closed')
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_stat = 'total_pins' THEN
      -- Archive clock: settle from scores.
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.scores s
            JOIN public.team_slots ts ON ts.id = s.team_slot_id
            JOIN public.teams t       ON t.id = ts.team_id
            JOIN public.games g       ON g.id = s.game_id
            WHERE t.week_id = p_week_id
              AND ts.player_id = mem.pid::uuid
              AND ts.is_fill = false
              AND g.game_number = v_mkt.game_number
              AND s.score IS NOT NULL)
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(s.score)::numeric INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.team_slots ts ON ts.player_id = mem.pid::uuid AND ts.is_fill = false
          JOIN public.teams t       ON t.id = ts.team_id AND t.week_id = p_week_id
          JOIN public.scores s      ON s.team_slot_id = ts.id
          JOIN public.games g       ON g.id = s.game_id AND g.game_number = v_mkt.game_number
          WHERE s.score IS NOT NULL;
        END IF;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.scores s
            JOIN public.team_slots ts ON ts.id = s.team_slot_id
            JOIN public.teams t       ON t.id = ts.team_id
            WHERE t.week_id = p_week_id
              AND ts.player_id = mem.pid::uuid
              AND ts.is_fill = false
              AND s.score IS NOT NULL)
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(s.score)::numeric INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.team_slots ts ON ts.player_id = mem.pid::uuid AND ts.is_fill = false
          JOIN public.teams t       ON t.id = ts.team_id AND t.week_id = p_week_id
          JOIN public.scores s      ON s.team_slot_id = ts.id
          WHERE s.score IS NOT NULL;
        END IF;
      END IF;

    ELSIF v_stat IN ('strikes', 'spares', 'clean_frames') THEN
      -- LaneTalk clock: settle from official imports.
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.lanetalk_game_imports i
            WHERE i.week_id = p_week_id
              AND i.player_id = mem.pid::uuid
              AND i.game_number = v_mkt.game_number
              AND i.classification = 'official')
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.lanetalk_game_imports i
            ON i.player_id = mem.pid::uuid
          WHERE i.week_id = p_week_id
            AND i.game_number = v_mkt.game_number
            AND i.classification = 'official';
        END IF;
      ELSE
        -- Night: per member, official imports must cover every recorded score
        -- and exist at all (the c'' player-night predicate, applied per member).
        SELECT NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          WHERE (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = mem.pid::uuid
                   AND i.classification = 'official') = 0
             OR (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = mem.pid::uuid
                   AND i.classification = 'official')
              < (SELECT count(*) FROM public.scores s
                 JOIN public.games g       ON g.id = s.game_id
                 JOIN public.team_slots ts ON ts.id = s.team_slot_id
                 JOIN public.teams t       ON t.id = ts.team_id
                 WHERE t.week_id = p_week_id
                   AND ts.player_id = mem.pid::uuid
                   AND ts.is_fill = false
                   AND s.score IS NOT NULL)
        ) INTO v_complete;

        IF v_complete THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
          JOIN public.lanetalk_game_imports i
            ON i.player_id = mem.pid::uuid
          WHERE i.week_id = p_week_id
            AND i.classification = 'official'
            AND i.frames > 0;
        END IF;
      END IF;

    ELSE
      RAISE EXCEPTION 'Unknown combo stat % on market %', v_stat, v_mkt.id;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  -- (d) Loan garnishment + interest.
  PERFORM public.process_weekly_loans(p_week_id);

  -- (e) PvP: auto-settle locked contracts for this week.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- --------------------------------------------------------------------------
  -- (f) Backstop, NARROWED. Props now settle in (c'') above, so the exemption
  --     is no longer blanket: a bet is exempt from the pending-count/void ONLY
  --     when p_void_missing = false AND it has a leg on a still-unsettled
  --     next-day-clock market (LaneTalk player prop or LaneTalk-clock team_prop)
  --     — i.e. a market genuinely still lacking import data. With
  --     p_void_missing = true those markets were delete-refunded in (c''), so no
  --     such legs remain and the exemption is inert.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_n_pending
  FROM public.bets b
  WHERE b.week_id = p_week_id AND b.status = 'pending'
    AND (p_void_missing OR NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.status <> 'settled'
        AND (m2.market_type = 'prop'
             OR m2.market_type = 'combo'
             OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
    ));

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE b.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND (p_void_missing OR NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        ));

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      WHERE b.week_id = p_week_id AND b.status = 'pending'
        AND (p_void_missing OR NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        ))
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, p_week_id,
        v_bet.stake, 'bet_refund', 'Voided at settlement — market never settled', NULL, v_bet.id);
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- (g) UNIFIED House weekly P/L — computed once, over ALL week-anchored house
  --     ledger rows (bets incl. LaneTalk payouts, PvP, loan garnishment),
  --     EXCLUDING bounty/auction (own feed cards + own clocks). UPSERT so a
  --     re-settle after a late import refreshes it (stable row id).
  -- --------------------------------------------------------------------------
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
   WHERE pl.is_house = true
     AND pl.week_id = p_week_id
     AND pl.auction_id IS NULL
     AND pl.bounty_post_id IS NULL;

  IF EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    UPDATE public.activity_feed_events
       SET public_payload = jsonb_set(COALESCE(public_payload, '{}'::jsonb), '{house_net}', to_jsonb(v_house_net)),
           updated_at = now()
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result';
  ELSE
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;

  -- Mark settled (preserve first-settle time across re-settles).
  UPDATE public.weeks SET settled_at = now() WHERE id = p_week_id AND settled_at IS NULL;

  UPDATE public.week_archive_runs
     SET details = details || jsonb_build_object(
           'settled_at', now(),
           'settle_counts', jsonb_build_object(
             'settled', v_settled, 'voided', v_voided,
             'left_pending', v_pending, 'house_net', v_house_net))
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'settled', v_settled, 'voided', v_voided,
    'left_pending', v_pending, 'house_net', v_house_net);
END;
$function$
;

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
    WHERE week_id = p_week_id AND type = 'score_credit'
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
  -- Game markets: the subject's score for that game. Night markets
  -- (game_number NULL): Σ the subject's non-fill scores across the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    IF v_mkt.game_number IS NOT NULL THEN
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
    ELSE
      SELECT SUM(s.score)::integer INTO v_score
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;
    END IF;

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

  -- Settle every non-settled team_prop TOTAL PINS market (archive clock).
  -- Game markets: team pinfall = Σ scores of the anchored team for that game
  -- (the moneyline aggregation). Night markets (subject_game_id NULL): Σ the
  -- team's non-NULL scores across ALL the week's games — fills INCLUDED
  -- (score-sheet semantics; frame-stat team props count non-fill roster
  -- imports instead). Frame-stat team_props (clock='lanetalk') settle later
  -- via settle_lanetalk_props_for_week and are skipped here.
  FOR v_mkt IN
    SELECT id, subject_game_id, (params ->> 'team_id')::uuid AS team_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'team_prop'
      AND params ->> 'stat' = 'total_pins' AND params ->> 'clock' = 'archive'
      AND status <> 'settled'
  LOOP
    IF v_mkt.subject_game_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.scores
        WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE sc.game_id = v_mkt.subject_game_id
          AND ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    ELSE
      -- Night total_pins: team_slots are week-scoped through their team, so
      -- every score reached through them belongs to this week's games.
      IF EXISTS (
        SELECT 1 FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id AND sc.score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
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
  -- EXEMPTION: bets with ≥1 leg on an UNSETTLED next-day-clock market are left
  -- pending — LaneTalk player props (market_type='prop') and LaneTalk-clock
  -- team_props (market_type='team_prop', params.clock='lanetalk'). Their data
  -- lands after archive; settle_lanetalk_props_for_week settles them on Confirm.
  -- total_pins team_props (clock='archive') are NOT exempt — settled just above.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_n_pending
  FROM public.bets b
  WHERE b.week_id = p_week_id AND b.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.status <> 'settled'
        AND (m2.market_type = 'prop'
             OR m2.market_type = 'combo'
             OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
    );

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE b.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND NOT (m.market_type = 'prop'
                 OR m.market_type = 'combo'
                 OR (m.market_type = 'team_prop' AND m.params ->> 'clock' = 'lanetalk'))
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
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
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
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
$function$
;

CREATE OR REPLACE FUNCTION public.preview_settle_week(p_week_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt          record;
  v_stat         text;
  v_team_id      uuid;
  v_has          boolean;
  v_complete     boolean;
  v_official_n   integer;
  v_scored_n     integer;
  v_reason       text;
  v_settleable   integer := 0;
  v_would_void   jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_mkt IN
    SELECT id, market_type, subject_player_id, subject_game_id, game_number, title, params
    FROM public.bet_markets
    WHERE week_id = p_week_id AND status <> 'settled'
  LOOP
    v_has    := false;
    v_reason := NULL;

    IF v_mkt.market_type = 'over_under' THEN
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.scores s
          JOIN public.games g       ON g.id = s.game_id
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
        ) INTO v_has;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.scores s
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND s.score IS NOT NULL
        ) INTO v_has;
      END IF;
      v_reason := 'no scores recorded';

    ELSIF v_mkt.market_type = 'moneyline' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.scores WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) INTO v_has;
      v_reason := 'no scores recorded for the game';

    ELSIF v_mkt.market_type = 'team_prop' AND v_mkt.params ->> 'stat' = 'total_pins'
          AND v_mkt.params ->> 'clock' = 'archive' THEN
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;
      IF v_mkt.subject_game_id IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM public.scores WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL) INTO v_has;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.scores sc
          JOIN public.team_slots ts ON ts.id = sc.team_slot_id
          WHERE ts.team_id = v_team_id AND sc.score IS NOT NULL
        ) INTO v_has;
      END IF;
      v_reason := 'no scores recorded';

    ELSIF (v_mkt.market_type = 'prop' AND v_mkt.params ->> 'source' = 'lanetalk')
       OR (v_mkt.market_type = 'team_prop' AND v_mkt.params ->> 'clock' = 'lanetalk') THEN
      v_stat := v_mkt.params ->> 'stat';
      v_reason := 'awaiting LaneTalk import';

      IF v_mkt.market_type = 'team_prop' THEN
        v_team_id := (v_mkt.params ->> 'team_id')::uuid;
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM public.team_slots ts
            JOIN public.scores s ON s.team_slot_id = ts.id
            JOIN public.games g  ON g.id = s.game_id
            WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
              AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.lanetalk_game_imports i
                WHERE i.week_id = p_week_id AND i.player_id = ts.player_id
                  AND i.game_number = g.game_number AND i.classification = 'official')
          ) INTO v_complete;
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id AND ts.player_id = i.player_id AND ts.is_fill = false
          WHERE i.week_id = p_week_id AND i.game_number = v_mkt.game_number AND i.classification = 'official';
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM public.team_slots ts
            WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
              AND (SELECT count(*) FROM public.scores s WHERE s.team_slot_id = ts.id AND s.score IS NOT NULL)
                > (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = ts.player_id AND i.classification = 'official')
          ) INTO v_complete;
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id AND ts.player_id = i.player_id AND ts.is_fill = false
          WHERE i.week_id = p_week_id AND i.classification = 'official';
        END IF;
        v_has := (v_complete AND v_official_n > 0);
      ELSE
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT EXISTS (
            SELECT 1 FROM public.lanetalk_game_imports i
            WHERE i.week_id = p_week_id AND i.player_id = v_mkt.subject_player_id
              AND i.game_number = v_mkt.game_number AND i.classification = 'official'
          ) INTO v_has;
        ELSE
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          WHERE i.week_id = p_week_id AND i.player_id = v_mkt.subject_player_id AND i.classification = 'official';
          SELECT count(*) INTO v_scored_n
          FROM public.scores s
          JOIN public.games g       ON g.id = s.game_id
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND s.score IS NOT NULL;
          v_has := (v_official_n > 0 AND v_official_n >= v_scored_n);
        END IF;
      END IF;

    ELSIF v_mkt.market_type = 'combo' THEN
      -- Mirrors settle_week (c'''): complete only when EVERY member has data
      -- for the combo's scope and clock.
      v_stat := v_mkt.params ->> 'stat';

      IF v_stat = 'total_pins' THEN
        v_reason := 'a combo member has no recorded score';
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE NOT EXISTS (
              SELECT 1 FROM public.scores s
              JOIN public.team_slots ts ON ts.id = s.team_slot_id
              JOIN public.teams t       ON t.id = ts.team_id
              JOIN public.games g       ON g.id = s.game_id
              WHERE t.week_id = p_week_id AND ts.player_id = mem.pid::uuid
                AND ts.is_fill = false AND g.game_number = v_mkt.game_number
                AND s.score IS NOT NULL)
          ) INTO v_has;
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE NOT EXISTS (
              SELECT 1 FROM public.scores s
              JOIN public.team_slots ts ON ts.id = s.team_slot_id
              JOIN public.teams t       ON t.id = ts.team_id
              WHERE t.week_id = p_week_id AND ts.player_id = mem.pid::uuid
                AND ts.is_fill = false AND s.score IS NOT NULL)
          ) INTO v_has;
        END IF;
      ELSE
        v_reason := 'a combo member is awaiting LaneTalk import';
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE NOT EXISTS (
              SELECT 1 FROM public.lanetalk_game_imports i
              WHERE i.week_id = p_week_id AND i.player_id = mem.pid::uuid
                AND i.game_number = v_mkt.game_number AND i.classification = 'official')
          ) INTO v_has;
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_mkt.params -> 'member_ids') mem(pid)
            WHERE (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = mem.pid::uuid
                     AND i.classification = 'official') = 0
               OR (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = mem.pid::uuid
                     AND i.classification = 'official')
                < (SELECT count(*) FROM public.scores s
                   JOIN public.games g       ON g.id = s.game_id
                   JOIN public.team_slots ts ON ts.id = s.team_slot_id
                   JOIN public.teams t       ON t.id = ts.team_id
                   WHERE t.week_id = p_week_id AND ts.player_id = mem.pid::uuid
                     AND ts.is_fill = false AND s.score IS NOT NULL)
          ) INTO v_has;
        END IF;
      END IF;

    ELSE
      -- Any other non-settled market (shouldn't reach settlement) — treat as
      -- settleable so it isn't flagged as a spurious void.
      v_has := true;
    END IF;

    IF v_has THEN
      v_settleable := v_settleable + 1;
    ELSE
      v_would_void := v_would_void || jsonb_build_object(
        'market_id', v_mkt.id,
        'market_type', v_mkt.market_type,
        'title', v_mkt.title,
        'reason', v_reason);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'settleable', v_settleable,
    'missing_count', jsonb_array_length(v_would_void),
    'would_void', v_would_void);
END;
$function$
;
