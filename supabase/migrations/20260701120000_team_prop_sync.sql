-- Team-aggregate prop markets — generation (PR1, migration 2 of 4).
--
-- Auto-generates first-class team_prop markets: one per (game × team × stat) for
-- stats {clean_frames, strikes, spares, total_pins}, each with over/under
-- selections sharing a seeded line. Coupled into resync_week_markets on the
-- games/moneyline path (team_props are game-anchored, like moneylines), so the
-- existing games/team/score/rsvp triggers keep them in lockstep with the schedule.
--
-- Seeding (team_prop_seed_line): Σ over the team's CURRENT non-fill roster of each
-- player's per-game average of the stat, floored to a half-point ONCE (never sum
-- pre-floored per-player half-lines — that compounds the +0.5 offset). Frame
-- stats come from official LaneTalk imports (no history → contributes 0);
-- total_pins uses each player's raw average score (season → lifetime → league),
-- mirroring pvp_player_line's ladder without its rounding.
--
-- Lines never move under a placed bet (reseed only markets with zero bets), and
-- markets ride through per-game roster swaps like moneyline — pruned only when the
-- game/team dies or the stat leaves the catalog.

-- Raw (un-rounded) average score for a player: season archived → lifetime → league.
-- Mirrors pvp_player_line's ladder but returns the raw mean so team sums can be
-- floored once at the team level.
CREATE OR REPLACE FUNCTION public.player_raw_avg_score(p_player_id uuid, p_season_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_avg numeric;
BEGIN
  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.season_id = p_season_id AND w.is_archived = true
    AND ts.player_id = p_player_id AND s.score > 0;
  IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;

  SELECT AVG(s.score) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true AND ts.player_id = p_player_id AND s.score > 0;
  IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;

  SELECT COALESCE(AVG(s.score), 130) INTO v_avg
  FROM public.scores s
  JOIN public.team_slots ts ON ts.id = s.team_slot_id
  JOIN public.teams t       ON t.id = ts.team_id
  JOIN public.weeks w       ON w.id = t.week_id
  WHERE w.is_archived = true AND ts.player_id IS NOT NULL AND s.score > 0;
  RETURN v_avg;
END;
$function$
;

-- Seeded line for a team_prop market. One shared definition for insert + reseed.
CREATE OR REPLACE FUNCTION public.team_prop_seed_line(p_team_id uuid, p_stat text, p_season_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_roster integer;
  v_sum    numeric;
BEGIN
  SELECT count(*) INTO v_roster
  FROM public.team_slots ts
  WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
  IF v_roster = 0 THEN v_roster := 1; END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    SELECT COALESCE(SUM(pl.avg_stat), 0) INTO v_sum
    FROM public.team_slots ts
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = ts.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl
    WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
    -- Half-point, floored once; clamp to [0.5, 10 frames/game × roster − 0.5].
    RETURN LEAST(10 * v_roster - 0.5, GREATEST(0.5, floor(COALESCE(v_sum, 0)) + 0.5));

  ELSIF p_stat = 'total_pins' THEN
    SELECT COALESCE(SUM(public.player_raw_avg_score(ts.player_id, p_season_id)), 0) INTO v_sum
    FROM public.team_slots ts
    WHERE ts.team_id = p_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL;
    RETURN GREATEST(0.5, floor(COALESCE(v_sum, 0)) + 0.5);

  ELSE
    RAISE EXCEPTION 'Unknown team_prop stat %', p_stat;
  END IF;
END;
$function$
;

-- Generate/prune/reseed team_prop markets for a week. Create-only + reseed-unbet
-- + prune-dead, idempotent (mirrors the O/U / LaneTalk syncs).
CREATE OR REPLACE FUNCTION public.sync_team_prop_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id uuid;
  v_rec       record;
  v_stat      text;
  v_clock     text;
  v_line      numeric;
  v_market_id uuid;
  v_label     text;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Prune open/closed team_props whose game/team no longer exists or whose stat
  -- left the catalog. (Game deletion already cascades the market away + refunds;
  -- this also covers team reassignment.) Settled/void are immutable.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'team_prop'
     AND m.status IN ('open', 'closed')
     AND (
       NOT EXISTS (SELECT 1 FROM public.games g WHERE g.id = m.subject_game_id)
       OR NOT EXISTS (
            SELECT 1 FROM public.games g
            WHERE g.id = m.subject_game_id
              AND (m.params ->> 'team_id')::uuid IN (g.team_a_id, g.team_b_id))
       OR (m.params ->> 'stat') NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins')
     );

  -- Create: one market per (game, team∈{a,b}, stat) not already present.
  FOR v_rec IN
    SELECT g.id AS game_id, g.game_number, t.id AS team_id, t.team_number
    FROM public.games g
    JOIN public.teams ta ON ta.id = g.team_a_id AND ta.week_id = p_week_id
    JOIN public.teams t  ON t.id IN (g.team_a_id, g.team_b_id)
    WHERE g.team_a_id IS NOT NULL AND g.team_b_id IS NOT NULL
  LOOP
    FOREACH v_stat IN ARRAY ARRAY['clean_frames', 'strikes', 'spares', 'total_pins'] LOOP
      IF EXISTS (
        SELECT 1 FROM public.bet_markets m
        WHERE m.market_type = 'team_prop'
          AND m.subject_game_id = v_rec.game_id
          AND m.params ->> 'team_id' = v_rec.team_id::text
          AND m.params ->> 'stat' = v_stat
      ) THEN
        CONTINUE;
      END IF;

      v_clock := CASE WHEN v_stat = 'total_pins' THEN 'archive' ELSE 'lanetalk' END;
      v_label := CASE v_stat
                   WHEN 'clean_frames' THEN 'Clean Frames'
                   WHEN 'strikes'      THEN 'Strikes'
                   WHEN 'spares'       THEN 'Spares'
                   ELSE 'Total Pins' END;
      v_line := public.team_prop_seed_line(v_rec.team_id, v_stat, v_season_id);

      INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_game_id, params, status)
        VALUES ('team_prop',
                'Team ' || v_rec.team_number || ' ' || v_label || ' — Game ' || v_rec.game_number,
                p_week_id, v_rec.game_number, v_rec.game_id,
                jsonb_build_object(
                  'family', 'team_aggregate',
                  'stat', v_stat,
                  'scope', 'game',
                  'team_id', v_rec.team_id::text,
                  'team_number', v_rec.team_number,
                  'clock', v_clock),
                'open')
        RETURNING id INTO v_market_id;

      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);
    END LOOP;
  END LOOP;

  -- Reseed: refresh the line on every open team_prop market that has NO bets yet
  -- (self-heals stale lines after roster/import changes). Never touches a market
  -- carrying a placed bet.
  UPDATE public.bet_selections s
     SET line = public.team_prop_seed_line((m.params ->> 'team_id')::uuid, m.params ->> 'stat', v_season_id)
    FROM public.bet_markets m
   WHERE s.market_id = m.id
     AND m.week_id = p_week_id
     AND m.market_type = 'team_prop'
     AND m.status = 'open'
     AND NOT EXISTS (
       SELECT 1 FROM public.bet_legs l
       JOIN public.bet_selections s2 ON s2.id = l.selection_id
       WHERE s2.market_id = m.id
     );
END;
$function$
;

-- Wire team_prop generation into the coupling path. team_props are game-anchored,
-- so the create loop is empty until games exist — but we call it UNCONDITIONALLY
-- (not gated on p_moneyline) so roster/score edits reseed unbet team lines too,
-- exactly like the O/U sync. It is a cheap no-op before games exist.
CREATE OR REPLACE FUNCTION public.resync_week_markets(p_week_id uuid, p_moneyline boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_week_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = p_week_id AND w.is_archived = false) THEN
    RETURN;
  END IF;
  PERFORM public.sync_over_under_markets_for_week(p_week_id);
  PERFORM public.sync_lanetalk_prop_markets_for_week(p_week_id);
  PERFORM public.sync_team_prop_markets_for_week(p_week_id);
  IF p_moneyline THEN
    PERFORM public.sync_moneyline_markets_for_week(p_week_id);
  END IF;
END;
$function$
;
