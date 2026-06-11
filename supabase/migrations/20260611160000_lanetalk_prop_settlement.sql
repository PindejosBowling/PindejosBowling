-- LaneTalk stat-prop settlement — function bodies + 2 new functions, NO DDL.
--
-- Stat lines (strikes / spares per game, clean% / first-ball avg per night) are
-- ordinary `bet_markets` rows with market_type = 'prop' and
-- params = { source: 'lanetalk', stat, scope } — the PIN_ECONOMY_SCHEMA §7
-- escape hatch. Archive runs night-of; LaneTalk data often lands the next day,
-- so these markets ride a separate settlement clock:
--
--   1. settle_market_internal relaxed to IN ('over_under','prop') — the
--      over/under/push derivation + finalize_bets_for_market engine settle
--      stat props as-is (selections are ordinary over/under rows with a line).
--   2. settle_betting_for_week's no-pending-bets backstop now EXEMPTS bets
--      with ≥1 leg on an unsettled prop market — archive settles normal bets
--      night-of and leaves LaneTalk-prop bets pending. (Mixed parlays still
--      die at archive when a score leg loses: finalize_bets_for_market settles
--      all-resolved bets; a lost leg fails the bet regardless of open legs.)
--   3. lanetalk_game_stats(payload) — the single authoritative stat definition
--      for money. Client stats.ts mirrors it for display/seeding only.
--   4. settle_lanetalk_props_for_week(week, void_missing) — the "Confirm
--      LaneTalk Data" RPC: derives actuals from lanetalk_game_imports inside
--      the settlement transaction (same trust model as settle_betting_for_week
--      deriving from scores; the client never supplies a result_value).
--
-- Archive/unarchive composition: prop markets are week-stamped, so the archive
-- preimage already snapshots their markets/selections/bets/legs; this RPC only
-- UPDATEs captured columns and INSERTs bet-linked, week-stamped pin_ledger
-- rows — exactly what unarchive_week reverses.
--
-- Security: settle_lanetalk_props_for_week is SECURITY DEFINER, admin-gated
-- in-body via auth.jwt(), search_path pinned, EXECUTE revoked from
-- PUBLIC/anon. lanetalk_game_stats is a pure IMMUTABLE helper (no table
-- access, no caller trust).

-- ----------------------------------------------------------------------------
-- 1. settle_market_internal — accept 'prop' alongside 'over_under'.
--    (settle_market is an unchanged admin-gate wrapper; no type check there.)
-- ----------------------------------------------------------------------------
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
  IF v_market.market_type NOT IN ('over_under', 'prop') THEN
    RAISE EXCEPTION 'settle_market_internal only handles over_under/prop markets';
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

-- ----------------------------------------------------------------------------
-- 2. settle_betting_for_week — backstop exemption for LaneTalk props.
--    Body identical to the previous revision except the backstop: bets with
--    ≥1 leg on an UNSETTLED prop market are excluded from the pending count,
--    the abort listing, and the force-void loop — they wait for the Confirm
--    LaneTalk Data clock (settle_lanetalk_props_for_week).
-- ----------------------------------------------------------------------------
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
  -- bet_refund rows are bet-linked (and week-stamped) so unarchive deletes them.
  --
  -- EXEMPTION: bets with ≥1 leg on an UNSETTLED prop market (LaneTalk stat
  -- bets) are deliberately left pending — their data lands after archive and
  -- settle_lanetalk_props_for_week settles them on the Confirm clock.
  -- --------------------------------------------------------------------------
  SELECT count(DISTINCT b.id) INTO v_n_pending
  FROM public.bets b
  JOIN public.bet_legs l       ON l.bet_id = b.id
  JOIN public.bet_selections s ON s.id = l.selection_id
  JOIN public.bet_markets m    ON m.id = s.market_id
  WHERE m.week_id = p_week_id AND b.status = 'pending'
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
      WHERE m.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
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
      SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND b.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
        )
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bet_id) VALUES
        (v_bet.player_id, v_bet.season_id, p_week_id, false,  v_bet.stake, 'bet_refund', 'Voided at archive — market never settled',         v_bet.id),
        (NULL,            v_bet.season_id, p_week_id, true,  -v_bet.stake, 'bet_refund', 'Voided at archive — market never settled (house)', v_bet.id);
    END LOOP;
  END IF;

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  -- Summed via bet_id through the week's markets: payout/refund rows are now also
  -- week-stamped, but bet_id remains the authoritative link for bet money.
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
$function$
;

-- ----------------------------------------------------------------------------
-- 3. lanetalk_game_stats — the authoritative per-game stat definition for
--    money. Mirrors the client's payloadToGame null-coercion (missing frames →
--    empty, missing booleans → false, missing first-ball pins → 0). Returns
--    NULLs for a payload with no frames (callers treat that as missing data).
--      strikes        = frames with is_strike
--      spares         = frames with is_spare
--      clean_pct      = (strikes + spares) / frames × 100
--      first_ball_avg = Σ first-ball pins / frames
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lanetalk_game_stats(p_payload jsonb)
 RETURNS TABLE(strikes integer, spares integer, clean_pct numeric, first_ball_avg numeric)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE COALESCE((f.value ->> 'is_strike')::boolean, false))::integer AS strikes,
    COUNT(*) FILTER (WHERE COALESCE((f.value ->> 'is_spare')::boolean,  false))::integer AS spares,
    CASE WHEN COUNT(*) > 0 THEN
      (COUNT(*) FILTER (WHERE COALESCE((f.value ->> 'is_strike')::boolean, false)
                           OR COALESCE((f.value ->> 'is_spare')::boolean,  false)))::numeric
        / COUNT(*) * 100
    END AS clean_pct,
    CASE WHEN COUNT(*) > 0 THEN
      SUM(COALESCE((f.value -> 'throws' -> 0 ->> 'pins')::numeric, 0)) / COUNT(*)
    END AS first_ball_avg
  FROM jsonb_array_elements(COALESCE(p_payload -> 'frames', '[]'::jsonb)) AS f(value);
$function$
;

-- ----------------------------------------------------------------------------
-- 4. settle_lanetalk_props_for_week — the "Confirm LaneTalk Data" RPC.
--    One transaction; mirrors settle_betting_for_week's market loop. Per
--    non-settled LaneTalk prop market of the week:
--      • scope=game  → actual from the player's 'official' import row matching
--        (week, player, game_number) via lanetalk_game_stats.
--      • scope=night → frame-level aggregate across the player's official
--        imports for the week, ONLY when their official-game count ≥ their
--        scored-game count (never settle clean% off half a night); otherwise
--        missing data.
--      • data present → settle_market_internal (idempotent);
--        missing + p_void_missing → DELETE the market (the
--        refund_bets_before_market_delete trigger refunds bets whole — the
--        standard delete-refund rail); missing otherwise → leave pending.
--    Returns one summary row for the confirm toast. Idempotent / re-runnable
--    after late imports.
-- ----------------------------------------------------------------------------
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
  v_official_n integer;
  v_scored_n   integer;
  v_settled    integer := 0;
  v_voided     integer := 0;
  v_pending    integer := 0;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_mkt IN
    SELECT id, subject_player_id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id
      AND market_type = 'prop'
      AND params ->> 'source' = 'lanetalk'
      AND status IN ('open', 'closed')
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_stat NOT IN ('strikes', 'spares', 'clean_pct', 'first_ball_avg') THEN
      RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
    END IF;

    IF (v_mkt.params ->> 'scope') = 'game' THEN
      -- Per-game: the player's official import for this exact game.
      SELECT CASE v_stat
               WHEN 'strikes'        THEN st.strikes::numeric
               WHEN 'spares'         THEN st.spares::numeric
               WHEN 'clean_pct'      THEN st.clean_pct
               WHEN 'first_ball_avg' THEN st.first_ball_avg
             END
        INTO v_value
      FROM public.lanetalk_game_imports i
      CROSS JOIN LATERAL public.lanetalk_game_stats(i.payload) st
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
                 WHEN 'clean_pct'      THEN SUM(st.clean_pct * st.frames) / NULLIF(SUM(st.frames), 0)
                 WHEN 'first_ball_avg' THEN SUM(st.first_ball_avg * st.frames) / NULLIF(SUM(st.frames), 0)
               END
          INTO v_value
        FROM public.lanetalk_game_imports i
        CROSS JOIN LATERAL (
          SELECT g.strikes, g.spares, g.clean_pct, g.first_ball_avg,
                 jsonb_array_length(COALESCE(i.payload -> 'frames', '[]'::jsonb)) AS frames
          FROM public.lanetalk_game_stats(i.payload) g
        ) st
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.classification = 'official'
          AND st.frames > 0;
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

REVOKE EXECUTE ON FUNCTION public.settle_lanetalk_props_for_week(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_lanetalk_props_for_week(uuid, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.lanetalk_game_stats(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lanetalk_game_stats(jsonb) TO authenticated;
