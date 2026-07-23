-- Seed lines anchor on the BOOK PROJECTION, not the raw average ---------------
-- (2026-07-23) Product change: every generated sportsbook line's DEFAULT value
-- (the seed rung the board opens on) now anchors on the OddsEngine's
-- recency-weighted projected mean — the same number the board's AVG-vs-BOOK
-- strip shows as BOOK — instead of the player's raw season/lifetime average.
-- The default offer is therefore the book's actual opinion (≈ even money by
-- construction: floor(mean) + 0.5 straddles the model mean), and the strip
-- reads directly against the posted default line.
--
-- Engine off (season kill-switch) or no mean → the legacy average-anchored
-- formulas apply unchanged, so is_enabled=false still reproduces pre-engine
-- behavior end-to-end (probe-combo-lines relies on that).
--
-- Deliberately NOT changed: pvp_player_line itself — PvP challenge lines stay
-- anchored on demonstrated raw averages (a duel-fairness contract, not a book
-- offer). The O/U generator now uses it only as the engine-off fallback.
--
-- Touched:
--   • NEW  odds_engine_seed_line(enabled, mean, n_games, fallback, lo, hi)
--   • combo_seed_line               — engine-aware (per-member floored
--     projected means summed + one half point; legacy body is the else-branch)
--   • sync_over_under_markets_for_week   — all 4 seed sites
--   • sync_lanetalk_prop_markets_for_week — all 7 seed sites
--   • a final resync of non-archived weeks applies the new anchors to betless
--     open markets immediately (any bet freezes a ladder — untouched, as ever)

-- ── The one seed rule ────────────────────────────────────────────────────────
-- Engine on + mean known → floor(mean × games) + 0.5, clamped to the stat's
-- possible range; otherwise the caller's legacy fallback line.
CREATE OR REPLACE FUNCTION public.odds_engine_seed_line(
  p_enabled boolean, p_mean numeric, p_n_games integer,
  p_fallback numeric, p_range_lo numeric, p_range_hi numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_enabled AND p_mean IS NOT NULL
      THEN LEAST(p_range_hi, GREATEST(p_range_lo, floor(p_mean * p_n_games) + 0.5))
    ELSE p_fallback
  END;
$$;

-- ── Combo seeds ──────────────────────────────────────────────────────────────
-- Engine on: per member floor(projected mean × games), summed + ONE half point
-- (the same per-member floor structure as the legacy average formula, so the
-- number decomposes into per-member bases; a no-history member contributes the
-- prior-informed mean now, not 0 — the book's actual expectation for them).
-- Engine off: the legacy average-anchored bodies, verbatim.
CREATE OR REPLACE FUNCTION public.combo_seed_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n_members integer;
  v_sum       numeric;
  v_cfg       public.odds_engine_config;
BEGIN
  IF p_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;

  SELECT count(DISTINCT m) INTO v_n_members FROM unnest(p_member_ids) m;
  IF v_n_members = 0 THEN v_n_members := 1; END IF;

  v_cfg := public.odds_engine_get_config(p_season_id);

  IF v_cfg.is_enabled THEN
    -- Seed = the book's projection: Σ floor(mean × games) + 0.5.
    SELECT COALESCE(SUM(floor(ps.mean * p_n_games)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem
    CROSS JOIN LATERAL public.odds_engine_player_stat(
      mem.player_id, p_season_id,
      CASE WHEN p_stat = 'total_pins' THEN 'score' ELSE p_stat END) ps;
    IF p_stat = 'total_pins' THEN
      RETURN GREATEST(0.5, v_sum + 0.5);
    END IF;
    -- Clamp to [0.5, 10 frames/game × games × members − 0.5].
    RETURN LEAST(10 * p_n_games * v_n_members - 0.5,
                 GREATEST(0.5, v_sum + 0.5));
  END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    -- Per member: floor(per-game avg × games) = their solo whole-number base
    -- (no data → 0). Summed bases + ONE half point.
    SELECT COALESCE(SUM(floor(COALESCE(pl.avg_stat, 0) * p_n_games)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = mem.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl;
    -- Clamp to [0.5, 10 frames/game × games × members − 0.5].
    RETURN LEAST(10 * p_n_games * v_n_members - 0.5,
                 GREATEST(0.5, v_sum + 0.5));
  END IF;

  -- total_pins
  SELECT COALESCE(SUM(floor(public.player_raw_avg_score(mem.player_id, p_season_id) * p_n_games)), 0) INTO v_sum
  FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem;
  RETURN GREATEST(0.5, v_sum + 0.5);
END;
$function$;

-- ── O/U generator: projection-anchored seeds at all 4 sites ──────────────────
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
  -- Seed = the book projection (engine mean); legacy average when engine off.
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
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, 1,
                  public.pvp_player_line(v_rec.subject_player_id, v_season_id), 0.5, 299.5);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_score, 0.5, 299.5, v_season_id);
    ELSE
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, v_n_games,
                  GREATEST(0.5, floor(public.player_raw_avg_score(v_rec.subject_player_id, v_season_id) * v_n_games) + 0.5),
                  0.5, 300 * v_n_games - 0.5);
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
    -- Seed = the book projection; the season → lifetime → league PvP ladder is
    -- the engine-off fallback only.
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'score') ps;
    v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, 1,
                public.pvp_player_line(v_rec.player_id, v_season_id), 0.5, 299.5);

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
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'score') ps;
    v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, v_n_games,
                GREATEST(0.5, floor(public.player_raw_avg_score(v_rec.player_id, v_season_id) * v_n_games) + 0.5),
                0.5, 300 * v_n_games - 0.5);

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

-- ── LaneTalk prop generator: projection-anchored seeds at all 7 sites ────────
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
  -- Seeds anchor on the book projection (engine mean, floor + 0.5); the
  -- lanetalk_seed_lines averages remain the engine-off fallback and the
  -- eligibility gate (zero seed rows = no official history → no markets).
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
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, 1,
                  v_rec.strikes_line, 0.5, 9.5);
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Strikes — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'strikes', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'spares'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'spares') ps;
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, 1,
                  v_rec.spares_line, 0.5, 9.5);
      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, params, status)
        VALUES ('prop', v_rec.name || ' Spares — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.player_id,
                jsonb_build_object('source', 'lanetalk', 'stat', 'spares', 'scope', 'game'), 'open')
        RETURNING id INTO v_market_id;
      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number = v_rec.game_number AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'clean_frames') ps;
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, 1,
                  LEAST(9.5, GREATEST(0.5, floor(v_rec.clean_frames_per_game) + 0.5)), 0.5, 9.5);
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
    -- Night seeds: the book's per-game projection scaled to this week's
    -- schedule, floored ONCE to a half so it can't push, clamped inside the
    -- possible range (10 frames a game — the money definitions count FRAMES,
    -- so 10·n is the true ceiling for strikes, spares, and clean frames
    -- alike). Engine off → the per-game average scaled the same way.
    IF NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'prop'
        AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'clean_frames'
        AND m.game_number IS NULL AND m.subject_player_id = v_rec.player_id
    ) THEN
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'clean_frames') ps;
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, v_n_games,
                  LEAST(10 * v_n_games - 0.5,
                    GREATEST(0.5, floor(v_rec.clean_frames_per_game * v_n_games) + 0.5)),
                  0.5, 10 * v_n_games - 0.5);
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
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'strikes') ps;
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, v_n_games,
                  LEAST(10 * v_n_games - 0.5,
                    GREATEST(0.5, floor(v_rec.strikes_per_game * v_n_games) + 0.5)),
                  0.5, 10 * v_n_games - 0.5);
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
      SELECT ps.mean, ps.variance INTO v_mean, v_var
        FROM public.odds_engine_player_stat(v_rec.player_id, v_season_id, 'spares') ps;
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, v_n_games,
                  LEAST(10 * v_n_games - 0.5,
                    GREATEST(0.5, floor(v_rec.spares_per_game * v_n_games) + 0.5)),
                  0.5, 10 * v_n_games - 0.5);
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

    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_rec.subject_player_id, v_season_id, v_rec.stat) ps;

    -- Fallback (engine off): the legacy average-anchored line for this
    -- stat/scope; engine on: the projection seed.
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

    IF v_rec.game_number IS NOT NULL THEN
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, 1, v_line, 0.5, 9.5);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, 1, v_cfg.spacing_count, 0.5, 9.5, v_season_id);
    ELSE
      v_line := public.odds_engine_seed_line(v_cfg.is_enabled, v_mean, v_n_games, v_line,
                  0.5, 10 * v_n_games - 0.5);
      PERFORM public.odds_engine_reladder_if_changed(
        v_rec.market_id, v_line, v_mean, v_var, v_n_games, v_cfg.spacing_count, 0.5, 10 * v_n_games - 0.5, v_season_id);
    END IF;
  END LOOP;
END;
$function$;

-- ── Apply now: re-anchor every betless open market on live weeks ─────────────
-- The syncs above are the trigger-coupled resync bodies; running them once
-- here re-ladders betless open markets onto the projection seeds immediately
-- instead of waiting for the next RSVP/schedule mutation. Bet-frozen ladders
-- are untouched (the standing invariant).
DO $$
DECLARE
  w record;
BEGIN
  FOR w IN SELECT id FROM public.weeks WHERE is_archived = false LOOP
    PERFORM public.sync_over_under_markets_for_week(w.id);
    PERFORM public.sync_lanetalk_prop_markets_for_week(w.id);
  END LOOP;
END $$;
