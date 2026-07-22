-- ─────────────────────────────────────────────────────────────────────────────
-- OddsEngine generators (2 of 3): fair-priced rung ladders on both syncs.
--
-- • odds_engine_build_ladder — pure (STABLE) ladder builder shared by the
--   minter and the churn guard; odds_engine_mint_ladder becomes a thin
--   INSERT..SELECT over it.
-- • odds_engine_reladder_if_changed — re-mints a betless market's selections
--   ONLY when the freshly built ladder differs from what's posted, so
--   selection ids (which staged slips reference) stay stable across no-op
--   resyncs.
-- • sync_over_under_markets_for_week — game-score + night-pins markets mint
--   full ladders (seed line formulas unchanged: pvp_player_line / floored
--   night mean); the betless reprice block becomes a re-ladder loop.
-- • sync_lanetalk_prop_markets_for_week — same for strikes/spares/clean
--   frames, game + night scope (seed lines still lanetalk_seed_lines).
--
-- Markets carrying any bet stay fully frozen (existing invariant). Prune and
-- refund paths are untouched. Engine disabled → every path degenerates to the
-- exact legacy single 2.000 over/under pair.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Pure ladder builder ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.odds_engine_build_ladder(p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS TABLE(key text, label text, odds numeric, line numeric, sort_order integer, side text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg   public.odds_engine_config;
  v_line  numeric;
  v_over  numeric;
  v_under numeric;
  j       integer;
BEGIN
  v_cfg := public.odds_engine_get_config(p_season_id);

  IF NOT v_cfg.is_enabled OR p_mean IS NULL OR p_variance IS NULL THEN
    RETURN QUERY VALUES
      ('over',  'Over',  2.000::numeric, p_seed_line, 0, 'over'),
      ('under', 'Under', 2.000::numeric, p_seed_line, 1, 'under');
    RETURN;
  END IF;

  FOR j IN -v_cfg.rungs_per_side .. v_cfg.rungs_per_side LOOP
    v_line := p_seed_line + j * p_spacing;
    IF v_line < p_range_lo OR v_line > p_range_hi THEN
      CONTINUE;
    END IF;

    SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
      FROM public.odds_engine_price_pair(p_mean, p_variance, p_n_games, v_line,
                                         v_cfg.odds_min, v_cfg.odds_max, j = 0) pp;
    IF v_over IS NULL THEN
      CONTINUE;  -- rung priced outside the clamp: not offered
    END IF;

    RETURN QUERY VALUES
      (CASE WHEN j = 0 THEN 'over' ELSE 'over:' || v_line END,
       'Over', v_over, v_line, (j + v_cfg.rungs_per_side) * 2, 'over'),
      (CASE WHEN j = 0 THEN 'under' ELSE 'under:' || v_line END,
       'Under', v_under, v_line, (j + v_cfg.rungs_per_side) * 2 + 1, 'under');
  END LOOP;
END;
$function$;

-- 2. Minter now delegates to the builder (one source of truth) ───────────────
CREATE OR REPLACE FUNCTION public.odds_engine_mint_ladder(p_market_id uuid, p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side)
    SELECT p_market_id, bl.key, bl.label, bl.odds, bl.line, bl.sort_order, bl.side
    FROM public.odds_engine_build_ladder(p_seed_line, p_mean, p_variance, p_n_games,
                                         p_spacing, p_range_lo, p_range_hi, p_season_id) bl;
END;
$function$;

-- 3. Churn-guarded re-ladder ─────────────────────────────────────────────────
-- For BETLESS markets only (callers enforce it): rebuilds the ladder and swaps
-- the posted selections only when (key, label, odds, line, sort_order, side)
-- differ. Returns true when a swap happened.
CREATE OR REPLACE FUNCTION public.odds_engine_reladder_if_changed(p_market_id uuid, p_seed_line numeric, p_mean numeric, p_variance numeric, p_n_games integer, p_spacing numeric, p_range_lo numeric, p_range_hi numeric, p_season_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_changed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM (
      (SELECT s.key, s.label, s.odds, s.line, s.sort_order, s.side
         FROM public.bet_selections s WHERE s.market_id = p_market_id
       EXCEPT
       SELECT bl.key, bl.label, bl.odds, bl.line, bl.sort_order, bl.side
         FROM public.odds_engine_build_ladder(p_seed_line, p_mean, p_variance, p_n_games,
                                              p_spacing, p_range_lo, p_range_hi, p_season_id) bl)
      UNION ALL
      (SELECT bl.key, bl.label, bl.odds, bl.line, bl.sort_order, bl.side
         FROM public.odds_engine_build_ladder(p_seed_line, p_mean, p_variance, p_n_games,
                                              p_spacing, p_range_lo, p_range_hi, p_season_id) bl
       EXCEPT
       SELECT s.key, s.label, s.odds, s.line, s.sort_order, s.side
         FROM public.bet_selections s WHERE s.market_id = p_market_id)
    ) d
  ) INTO v_changed;

  IF v_changed THEN
    DELETE FROM public.bet_selections WHERE market_id = p_market_id;
    PERFORM public.odds_engine_mint_ladder(p_market_id, p_seed_line, p_mean, p_variance,
                                           p_n_games, p_spacing, p_range_lo, p_range_hi, p_season_id);
  END IF;
  RETURN v_changed;
END;
$function$;

-- 4. sync_over_under_markets_for_week — ladders on create + re-ladder ────────
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
  v_cfg          public.odds_engine_config;
  v_mean         numeric;
  v_var          numeric;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  v_cfg := public.odds_engine_get_config(v_season_id);

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

  -- --- Re-ladder: rebuild line + priced rungs on every OPEN market with no ---
  -- bets, so re-syncs pick up new history AND fresh recency-weighted odds.
  -- Selection ids only churn when the posted ladder actually changed
  -- (odds_engine_reladder_if_changed). Markets with any bet stay frozen.
  FOR v_rec IN
    SELECT m.id AS market_id, m.subject_player_id, m.game_number
    FROM public.bet_markets m
    WHERE m.week_id = p_week_id
      AND m.market_type = 'over_under'
      AND m.status = 'open'
      AND m.subject_player_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_legs bl
        JOIN public.bet_selections s2 ON s2.id = bl.selection_id
        WHERE s2.market_id = m.id
      )
  LOOP
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.subject_player_id, v_season_id, 'score') ps;
    IF v_rec.game_number IS NOT NULL THEN
      v_line := public.pvp_player_line(v_rec.subject_player_id, v_season_id);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_score, 0.5, 299.5, v_season_id);
    ELSE
      v_line := GREATEST(0.5, floor(public.player_raw_avg_score(v_rec.subject_player_id, v_season_id) * v_n_games) + 0.5);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_night_pins, 0.5, 300 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;

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
    -- Season → lifetime → league ladder, shared with PvP lines (seed rung).
    v_line := public.pvp_player_line(v_rec.player_id, v_season_id);
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'score') ps;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    PERFORM public.odds_engine_mint_ladder(
      v_market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_score, 0.5, 299.5, v_season_id);
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
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'score') ps;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
      VALUES ('over_under', v_rec.name || ' Total Pins — Night',
              p_week_id, NULL, v_rec.player_id,
              jsonb_build_object('scope', 'night'), 'open')
      RETURNING id INTO v_market_id;

    PERFORM public.odds_engine_mint_ladder(
      v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_night_pins, 0.5, 300 * v_n_games - 0.5, v_season_id);
  END LOOP;
END;
$function$;

-- 5. sync_lanetalk_prop_markets_for_week — ladders on create + re-ladder ─────
CREATE OR REPLACE FUNCTION public.sync_lanetalk_prop_markets_for_week(p_week_id uuid)
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
  v_rec          record;
  v_market_id    uuid;
  v_line         numeric;
  v_cfg          public.odds_engine_config;
  v_mean         numeric;
  v_var          numeric;
  v_sl           record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  v_cfg := public.odds_engine_get_config(v_season_id);

  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;
  SELECT EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) INTO v_has_games;

  -- Target games: the schedule once it exists; before teams, existing prop
  -- market numbers, defaulting to {1, 2} (same policy as the O/U sync).
  IF v_has_games THEN
    SELECT ARRAY(
      SELECT DISTINCT g.game_number FROM public.games g
        JOIN public.teams t ON t.id = g.team_a_id
       WHERE t.week_id = p_week_id
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT game_number FROM public.bet_markets
       WHERE week_id = p_week_id AND market_type = 'prop'
         AND params ->> 'source' = 'lanetalk' AND game_number IS NOT NULL
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);

  -- --- Prune: refund + remove every open/closed lanetalk prop whose subject ---
  -- lost eligibility (ladder ∩ official history) or whose game number left the
  -- schedule. A stat leaving the catalog (first_ball_avg retirement) prunes
  -- ONLY betless markets — a market carrying bets keeps its stat settleable.
  -- Night markets (game_number NULL) follow the subject's standing in ANY
  -- target game. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'prop'
     AND m.params ->> 'source' = 'lanetalk'
     AND m.status IN ('open', 'closed')
     AND (
       (m.params ->> 'stat' NOT IN ('strikes', 'spares', 'clean_frames')
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l
          JOIN public.bet_selections s ON s.id = l.selection_id
          WHERE s.market_id = m.id))
       -- no official import history → no line
       OR NOT EXISTS (
         SELECT 1 FROM public.lanetalk_game_imports i
         WHERE i.player_id = m.subject_player_id
           AND i.classification = 'official'
           AND i.frames > 0)
       OR (m.game_number IS NOT NULL AND m.game_number <> ALL (v_target_games))
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

  -- --- Create missing per-game markets (strikes + spares + clean frames) ----
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name,
           sl.strikes_line, sl.spares_line, sl.clean_frames_per_game
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
    -- zero seed rows = no official history → no markets for this player
    JOIN LATERAL public.lanetalk_seed_lines(ep.player_id) sl ON true
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'strikes') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_rec.strikes_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'spares') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_rec.spares_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      -- Per-game clean seed line: floor+0.5 on the per-game average, clamped
      -- inside the possible range (10 frames a game).
      v_line := LEAST(9.5, GREATEST(0.5, floor(v_rec.clean_frames_per_game) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'clean_frames') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;
  END LOOP;

  -- --- Create missing night markets (clean frames + strikes + spares) -------
  FOR v_rec IN
    SELECT DISTINCT ep.player_id, p.name,
           sl.strikes_per_game, sl.spares_per_game, sl.clean_frames_per_game
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
    JOIN LATERAL public.lanetalk_seed_lines(ep.player_id) sl ON true
  LOOP
    -- Night seed lines: per-game average scaled to this week's schedule,
    -- floored ONCE to a half so it can't push, clamped inside the possible
    -- range (10 frames a game — the money definitions count FRAMES, so 10·n
    -- is the true ceiling for strikes, spares, and clean frames alike).
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.clean_frames_per_game * v_n_games) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'clean_frames') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Clean Frames — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'clean_frames', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.strikes_per_game * v_n_games) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'strikes') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      v_line := LEAST(10 * v_n_games - 0.5,
                GREATEST(0.5, floor(v_rec.spares_per_game * v_n_games) + 0.5));
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'spares') ps;
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Night',
                p_week_id, NULL, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'night'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;

  -- --- Re-ladder: unbet open/closed markets track new imports (line drift ---
  -- AND recency-weighted odds drift). Never touches a market under a placed
  -- bet; ids only churn when the posted ladder actually changed. Legacy
  -- stats (first_ball_avg) are skipped — frozen as before.
  FOR v_rec IN
    SELECT m.id AS market_id, m.subject_player_id, m.game_number,
           m.params ->> 'stat' AS stat
    FROM public.bet_markets m
    WHERE m.week_id = p_week_id
      AND m.market_type = 'prop'
      AND m.params ->> 'source' = 'lanetalk'
      AND m.status IN ('open', 'closed')
      AND m.params ->> 'stat' IN ('strikes', 'spares', 'clean_frames')
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s2 ON s2.id = l.selection_id
        WHERE s2.market_id = m.id)
  LOOP
    SELECT sl.* INTO v_sl FROM public.lanetalk_seed_lines(v_rec.subject_player_id) sl;
    IF v_sl IS NULL OR v_sl.strikes_per_game IS NULL THEN
      CONTINUE;  -- no official history (the prune above handles removal)
    END IF;

    v_line := CASE
      WHEN v_rec.stat = 'strikes' AND v_rec.game_number IS NOT NULL THEN v_sl.strikes_line
      WHEN v_rec.stat = 'strikes' THEN LEAST(10 * v_n_games - 0.5,
             GREATEST(0.5, floor(v_sl.strikes_per_game * v_n_games) + 0.5))
      WHEN v_rec.stat = 'spares' AND v_rec.game_number IS NOT NULL THEN v_sl.spares_line
      WHEN v_rec.stat = 'spares' THEN LEAST(10 * v_n_games - 0.5,
             GREATEST(0.5, floor(v_sl.spares_per_game * v_n_games) + 0.5))
      WHEN v_rec.game_number IS NOT NULL THEN
             LEAST(9.5, GREATEST(0.5, floor(v_sl.clean_frames_per_game) + 0.5))
      ELSE LEAST(10 * v_n_games - 0.5,
             GREATEST(0.5, floor(v_sl.clean_frames_per_game * v_n_games) + 0.5))
    END;

    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.subject_player_id, v_season_id, v_rec.stat) ps;

    IF v_rec.game_number IS NOT NULL THEN
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    ELSE
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;
END;
$function$;
