-- Player NIGHT total-pins line — completes the 2026-07-01 standardization.
--
-- The standardized board gave teams a night TOTAL PINS line but players only
-- got the frame stats at night scope (score O/U was per-game only), so the
-- WEEKLY player row read CLEAN FRAMES · STRIKES · SPARES with no pin total.
-- This adds one night score O/U per eligible player: market_type='over_under',
-- game_number NULL, params={scope:'night'}, actual = Σ the player's (non-fill)
-- scores across the week's games — settled AT ARCHIVE like every score line
-- (scores are known night-of; this is NOT a LaneTalk-clock market, so it is
-- correctly non-exempt from the archive backstop).
--
-- Both function replacements land in this one file: the sync creating night
-- O/U markets and the archive settlement's night branch must ship together,
-- or a pending night-pins bet would abort every archive via the backstop.

-- ---------------------------------------------------------------------------
-- O/U sync: night market per eligible player + NULL-safe prune + scoped reprice.
-- The old prune's participation clause (`g.game_number = m.game_number`) never
-- matches a NULL game_number, so it would have deleted every night market the
-- moment games existed — the prune is restructured game-scope vs night-scope.
-- Night line = floor(player_raw_avg_score × n_games) + 0.5 (raw ladder mean ×
-- schedule, floored ONCE — scaling the pre-floored per-game line would
-- compound the +0.5 offset).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(p_week_id uuid, p_extra_games integer[] DEFAULT '{}'::integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id    uuid;
  v_has_teams    boolean;
  v_has_games    boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_line         numeric;
  v_market_id    uuid;
  v_rec          record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;
  SELECT EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) INTO v_has_games;

  -- Target games: once a schedule exists the games table is authoritative
  -- (∪ p_extra_games for a just-inserted game in the same client flow).
  -- Before teams: existing market numbers ∪ extras, defaulting to {1, 2}.
  IF v_has_games THEN
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
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);

  -- --- Prune: refund + remove every O/U market whose subject is no longer ---
  -- eligible (per the ladder above) or whose game number is no longer
  -- scheduled. Night markets (game_number NULL) follow the subject's standing
  -- in ANY game, like the night stat props. The BEFORE DELETE trigger
  -- (refund_bets_before_market_delete) refunds every touched bet whole (ledger
  -- pair + bet row), including parlays spanning other markets. Settled/void
  -- markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status IN ('open', 'closed')
     AND (
       (m.game_number IS NOT NULL AND m.game_number <> ALL (v_target_games))
       OR (m.game_number IS NOT NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             JOIN public.games g       ON g.id = s.game_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id
               AND g.game_number = m.game_number))
       OR (m.game_number IS NULL AND v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_games AND v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
     );

  -- --- Refresh: recompute the line on every OPEN market that has no bets yet,
  -- so re-syncs pick up the current season→lifetime→league ladder. Markets with
  -- any bet on any selection are frozen (line untouched) to protect bettors.
  -- Game markets: pvp_player_line (already FLOOR(avg) + 0.5). Night markets:
  -- the raw ladder mean × the week's game count, floored once.
  UPDATE public.bet_selections bs
     SET line = CASE
       WHEN m.game_number IS NOT NULL THEN public.pvp_player_line(m.subject_player_id, v_season_id)
       ELSE GREATEST(0.5, floor(public.player_raw_avg_score(m.subject_player_id, v_season_id) * v_n_games) + 0.5)
     END
   FROM public.bet_markets m
   WHERE bs.market_id = m.id
     AND m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status = 'open'
     AND m.subject_player_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.bet_legs bl
       JOIN public.bet_selections s2 ON s2.id = bl.selection_id
       WHERE s2.market_id = m.id
     );

  -- --- Create missing markets for eligible (player, game) pairs ---------------
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name
    FROM (
      -- games exist → participation rows are the authority, per game
      SELECT DISTINCT ts.player_id, g.game_number
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      -- teams but no games yet (mid-team-gen) → slots × target
      SELECT ts.player_id, gt.game_number
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      -- no teams → RSVP × target
      SELECT r.player_id, gt.game_number
      FROM public.rsvp r
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = ep.game_number AND m.subject_player_id = ep.player_id
    )
  LOOP
    -- Season → lifetime → league ladder, shared with PvP lines.
    v_line := public.pvp_player_line(v_rec.player_id, v_season_id);

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);
  END LOOP;

  -- --- Create missing NIGHT markets (player total pins across the night) ------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name
    FROM (
      SELECT DISTINCT ts.player_id
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      SELECT ts.player_id
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      SELECT r.player_id
      FROM public.rsvp r
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number IS NULL AND m.subject_player_id = ep.player_id
    )
  LOOP
    v_line := GREATEST(0.5, floor(public.player_raw_avg_score(v_rec.player_id, v_season_id) * v_n_games) + 0.5);

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
      VALUES ('over_under', v_rec.name || ' Total Pins — Night',
              p_week_id, NULL, v_rec.player_id,
              jsonb_build_object('scope', 'night'), 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);
  END LOOP;
END;
$function$
;

-- ---------------------------------------------------------------------------
-- Archive settlement: night O/U branch. A night market's actual = Σ the
-- player's non-fill scores across the week's games; no scores → closed (its
-- bets fall to the backstop, correctly non-exempt — this is an archive-clock
-- market).
-- ---------------------------------------------------------------------------
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
