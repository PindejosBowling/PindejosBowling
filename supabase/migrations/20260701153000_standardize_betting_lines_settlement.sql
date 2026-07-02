-- Standardize betting-line generation across groupings (2 of 2: settlement).
--
-- Two settlement paths for the standardized matrix — this migration MUST land
-- in the same push as …_standardize_betting_lines_sync (without it, a pending
-- night total_pins bet would abort every archive via the no-pending-bets
-- backstop, and lanetalk-clock team props would never auto-settle):
--
-- 1. settle_lanetalk_props_for_week now also settles LaneTalk-clock TEAM props
--    (market_type='team_prop', params.clock='lanetalk'). This closes a real
--    gap: earlier comments claimed the Confirm RPC settled them, but the loop
--    only ever selected market_type='prop'. Team value = Σ official imports of
--    the team's NON-FILL roster (the population team_prop_seed_line prices,
--    the score-credit mint pays, and the anti-tank trigger guards), game scope
--    for game markets, whole-night for night markets, with complete-data
--    guards mirroring the player night guard.
--
-- 2. settle_betting_for_week settles NIGHT total_pins team props at archive:
--    Σ the team's non-NULL scores across all the week's games. Fills are
--    INCLUDED here (score-sheet semantics, matching the per-game total_pins /
--    moneyline aggregation) while frame-stat team props count non-fill roster
--    imports (import semantics) — a deliberate asymmetry: total pinfall is
--    what the team actually bowled; frame stats follow the priced roster.
--
-- The archive backstop's exemption predicate already covers team_prop +
-- clock='lanetalk', and unarchive_week is snapshot-driven (night markets are
-- week-stamped; Confirm settlements only touch captured columns + bet-linked
-- ledger rows), so neither needs changes.

CREATE OR REPLACE FUNCTION public.settle_lanetalk_props_for_week(p_week_id uuid, p_void_missing boolean DEFAULT false)
 RETURNS TABLE(settled integer, voided integer, left_pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt        record;
  v_stat       text;
  v_value      numeric;
  v_team_id    uuid;
  v_complete   boolean;
  v_official_n integer;
  v_scored_n   integer;
  v_settled    integer := 0;
  v_voided     integer := 0;
  v_pending    integer := 0;
BEGIN
  PERFORM public.assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

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
      -- ----- LaneTalk-clock TEAM prop: Σ non-fill roster official imports ----
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames') THEN
        RAISE EXCEPTION 'Unknown LaneTalk team stat % on market %', v_stat, v_mkt.id;
      END IF;
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;

      IF v_mkt.game_number IS NOT NULL THEN
        -- Game scope. Complete-data guard: every non-fill roster player with a
        -- recorded score for this game must have an official import for it (a
        -- player without a score row needs no import — contributes 0).
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

        -- Positivity: never settle an import-less team at 0 off no data.
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
        -- Night scope. Guard: every non-fill roster player's official imports
        -- must cover every game they have a recorded score for.
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
      -- ----- LaneTalk PLAYER prop (unchanged; keeps first_ball_avg/clean_pct
      -- support so legacy bet-carrying markets still grade) ------------------
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames', 'clean_pct', 'first_ball_avg') THEN
        RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
      END IF;

      IF v_mkt.game_number IS NOT NULL THEN
        -- Per-game: the player's official import for this exact game.
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
        -- Night: only settle off a COMPLETE night — official imports must cover
        -- every game the player has a recorded score for.
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
          -- Frame-level aggregate across the night (totals, not per-game means).
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
      -- Delete-refund rail: refund_bets_before_market_delete refunds every
      -- touched bet whole (incl. parlays spanning other markets).
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_settled, v_voided, v_pending;
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
                 OR (m.market_type = 'team_prop' AND m.params ->> 'clock' = 'lanetalk'))
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
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
