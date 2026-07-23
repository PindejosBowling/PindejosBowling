-- ─────────────────────────────────────────────────────────────────────────────
-- OddsEngine combos (3 of 3): priced rung ladders for player-composed combos.
--
-- • combo_preview_ladder — the BuilderBar's live ladder: existing open combo
--   (same combo_key) → its posted over rungs verbatim; otherwise a fresh
--   ladder from the summed member distributions around combo_seed_line.
-- • compose_combo_bet — specs gain an optional "line" (the chosen rung; NULL
--   = seed). New markets mint the FULL ladder and bet the chosen rung's over;
--   dedup requires the chosen rung to be posted on the existing market.
-- • Final DO block resyncs every non-archived week so the live board carries
--   engine-priced ladders immediately (the engine shipped enabled).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. combo_preview_ladder ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.combo_preview_ladder(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1, p_week_id uuid DEFAULT NULL::uuid, p_game_number integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_members      uuid[];
  v_member_texts text[];
  v_scope        text;
  v_combo_key    text;
  v_mkt          uuid;
  v_seed         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_spacing      numeric;
  v_hi           numeric;
  v_cn           integer := GREATEST(COALESCE(p_n_games, 1), 1);
  v_out          jsonb;
BEGIN
  IF p_stat IS NULL OR p_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
    RAISE EXCEPTION 'Unknown combo stat %', COALESCE(p_stat, '(null)');
  END IF;

  SELECT array_agg(m ORDER BY m) INTO v_members
    FROM (SELECT DISTINCT m FROM unnest(COALESCE(p_member_ids, '{}')) m) d;
  IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Existing open combo for the same key → its posted rungs ARE the offer
  -- (a second bettor can only take lines the market already carries).
  IF p_week_id IS NOT NULL THEN
    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    v_scope := CASE WHEN p_game_number IS NULL THEN 'night' ELSE 'game' END;
    v_combo_key := p_stat || '|' || v_scope || '|' || COALESCE(p_game_number::text, 'n')
                   || '|' || array_to_string(v_member_texts, ',');
    SELECT m.id INTO v_mkt
      FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'combo'
        AND m.status = 'open' AND m.params ->> 'combo_key' = v_combo_key;
    IF v_mkt IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_build_object(
               'line', s.line, 'odds', s.odds, 'is_seed', s.key = 'over')
             ORDER BY s.line)
        INTO v_out
        FROM public.bet_selections s
        WHERE s.market_id = v_mkt AND s.side = 'over';
      RETURN COALESCE(v_out, '[]'::jsonb);
    END IF;
  END IF;

  v_seed := public.combo_seed_line(v_members, p_stat, p_season_id, v_cn);

  SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
    INTO v_mean, v_var
    FROM unnest(v_members) mem(m)
    CROSS JOIN LATERAL public.odds_engine_player_stat(
      mem.m, p_season_id,
      CASE WHEN p_stat = 'total_pins' THEN 'score' ELSE p_stat END) ps;

  v_cfg := public.odds_engine_get_config(p_season_id);
  v_spacing := CASE
    WHEN p_stat <> 'total_pins' THEN v_cfg.spacing_count
    WHEN v_cn = 1 THEN v_cfg.spacing_score
    ELSE v_cfg.spacing_night_pins END;
  v_hi := CASE WHEN p_stat = 'total_pins'
               THEN 300 * v_cn * array_length(v_members, 1) - 0.5
               ELSE 10 * v_cn * array_length(v_members, 1) - 0.5 END;

  SELECT jsonb_agg(jsonb_build_object(
           'line', bl.line, 'odds', bl.odds, 'is_seed', bl.key = 'over')
         ORDER BY bl.line)
    INTO v_out
    FROM public.odds_engine_build_ladder(v_seed, v_mean, v_var, v_cn,
                                         v_spacing, 0.5, v_hi, p_season_id) bl
    WHERE bl.side = 'over';
  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- 2. compose_combo_bet — chosen-rung composition over a full minted ladder ───
CREATE OR REPLACE FUNCTION public.compose_combo_bet(p_week_id uuid, p_combos jsonb, p_stake integer, p_extra_selection_ids uuid[] DEFAULT NULL::uuid[], p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id    uuid;
  v_season_id    uuid;
  v_archived     boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_spec         jsonb;
  v_stat         text;
  v_scope        text;
  v_game_number  integer;
  v_members      uuid[];
  v_member_texts text[];
  v_member_names text[];
  v_n_named      integer;
  v_combo_key    text;
  v_existing     record;
  v_clock        text;
  v_label        text;
  v_line         numeric;
  v_market_id    uuid;
  v_over_id      uuid;
  v_deduped      boolean;
  v_market_ids   uuid[] := '{}';
  v_over_ids     uuid[] := '{}';
  v_combos_out   jsonb := '[]'::jsonb;
  v_first_created jsonb := NULL;
  v_n_created    integer := 0;
  v_bet_id       uuid;
  v_spec_line    numeric;
  v_odds         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_spacing      numeric;
  v_hi           numeric;
  v_cn           integer;
BEGIN
  v_player_id := public.current_player_id();

  SELECT w.season_id, w.is_archived INTO v_season_id, v_archived
    FROM public.weeks w WHERE w.id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF v_archived THEN
    RAISE EXCEPTION 'This week is locked — no new bets can be placed';
  END IF;

  IF p_combos IS NULL OR jsonb_typeof(p_combos) <> 'array' OR jsonb_array_length(p_combos) < 1 THEN
    RAISE EXCEPTION 'At least one combo is required';
  END IF;

  -- Schedule games: the games table is authoritative once a schedule exists;
  -- before teams, default {1, 2} (the O/U sync's pre-teams convention).
  SELECT ARRAY(
    SELECT DISTINCT g.game_number FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
    ORDER BY 1
  ) INTO v_target_games;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);
  v_cfg := public.odds_engine_get_config(v_season_id);

  -- One coarse lock per week serializes identical composes without per-spec
  -- lock-ordering concerns; the partial unique index is the backstop.
  PERFORM pg_advisory_xact_lock(hashtextextended('combo|' || p_week_id::text, 0));

  FOR v_spec IN SELECT value FROM jsonb_array_elements(p_combos) LOOP
    v_stat := v_spec ->> 'stat';
    v_scope := v_spec ->> 'scope';
    v_game_number := (v_spec ->> 'game_number')::integer;
    -- Optional chosen rung: bettors step the ladder in the BuilderBar; NULL
    -- means the seed rung (canonical 'over' key).
    v_spec_line := (v_spec ->> 'line')::numeric;

    IF v_stat IS NULL OR v_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
      RAISE EXCEPTION 'Unknown combo stat %', COALESCE(v_stat, '(null)');
    END IF;
    IF v_scope IS NULL OR v_scope NOT IN ('game', 'night') THEN
      RAISE EXCEPTION 'Combo scope must be game or night';
    END IF;
    IF v_scope = 'game' THEN
      IF v_game_number IS NULL OR NOT (v_game_number = ANY (v_target_games)) THEN
        RAISE EXCEPTION 'Game % is not on this week''s schedule', COALESCE(v_game_number::text, '(null)');
      END IF;
    ELSIF v_game_number IS NOT NULL THEN
      RAISE EXCEPTION 'A night combo cannot carry a game number';
    END IF;

    -- Members: sorted + deduped; at least two; every member RSVP''d in.
    SELECT array_agg(m ORDER BY m) INTO v_members
      FROM (SELECT DISTINCT (mem.value)::uuid AS m
              FROM jsonb_array_elements_text(COALESCE(v_spec -> 'member_ids', '[]'::jsonb)) mem
             WHERE mem.value IS NOT NULL) d;
    IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
      RAISE EXCEPTION 'A combo needs at least two distinct players';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_members) mem
      WHERE NOT EXISTS (
        SELECT 1 FROM public.rsvp r
        WHERE r.week_id = p_week_id AND r.player_id = mem AND r.status = 'in')
    ) THEN
      RAISE EXCEPTION 'Every combo member must be RSVP''d in for this week';
    END IF;

    -- Display-name snapshot (also proves every id is a real player).
    SELECT array_agg(p.name ORDER BY mem.ord), count(p.id)
      INTO v_member_names, v_n_named
      FROM unnest(v_members) WITH ORDINALITY mem(id, ord)
      JOIN public.players p ON p.id = mem.id;
    IF v_n_named <> array_length(v_members, 1) THEN
      RAISE EXCEPTION 'Unknown player in combo';
    END IF;

    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    v_combo_key := v_stat || '|' || v_scope || '|' || COALESCE(v_game_number::text, 'n')
                   || '|' || array_to_string(v_member_texts, ',');

    SELECT m.id, m.status INTO v_existing
      FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'combo'
        AND m.status IN ('open', 'closed')
        AND m.params ->> 'combo_key' = v_combo_key;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.status <> 'open' THEN
        RAISE EXCEPTION 'This combo is in progress — betting is closed';
      END IF;
      v_market_id := v_existing.id;
      v_deduped := true;
      IF v_spec_line IS NULL THEN
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.key = 'over';
      ELSE
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.side = 'over' AND s.line = v_spec_line;
        IF v_over_id IS NULL THEN
          RAISE EXCEPTION 'This combo already exists at other lines — pick one of its posted rungs';
        END IF;
      END IF;
    ELSE
      v_deduped := false;
      v_clock := CASE WHEN v_stat = 'total_pins' THEN 'archive' ELSE 'lanetalk' END;
      v_label := CASE v_stat
                   WHEN 'clean_frames' THEN 'Clean Frames'
                   WHEN 'strikes'      THEN 'Strikes'
                   WHEN 'spares'       THEN 'Spares'
                   ELSE 'Total Pins' END;
      v_line := public.combo_seed_line(v_members, v_stat, v_season_id,
                  CASE WHEN v_scope = 'game' THEN 1 ELSE v_n_games END);

      INSERT INTO public.bet_markets
          (market_type, title, week_id, game_number, subject_game_id, params, status, created_by_player_id)
        VALUES ('combo',
                array_to_string(v_member_names, ' + ') || ' ' || v_label
                  || ' — ' || CASE WHEN v_scope = 'game' THEN 'Game ' || v_game_number ELSE 'Night' END,
                p_week_id,
                CASE WHEN v_scope = 'game' THEN v_game_number ELSE NULL END,
                NULL,
                jsonb_build_object(
                  'family', 'combo',
                  'stat', v_stat,
                  'scope', v_scope,
                  'clock', v_clock,
                  'member_ids', to_jsonb(v_member_texts),
                  'member_names', to_jsonb(v_member_names),
                  'combo_key', v_combo_key),
                'open',
                v_player_id)
        RETURNING id INTO v_market_id;

      -- Combo distribution: members modeled independent, so per-game means
      -- and variances add (night scaling happens inside the pricer). total_pins
      -- maps to the members' score distributions.
      SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0)
        INTO v_mean, v_var
        FROM (SELECT DISTINCT m FROM unnest(v_members) m) mem
        CROSS JOIN LATERAL public.odds_engine_player_stat(
          mem.m, v_season_id,
          CASE WHEN v_stat = 'total_pins' THEN 'score' ELSE v_stat END) ps;

      v_cn := CASE WHEN v_scope = 'game' THEN 1 ELSE v_n_games END;
      v_spacing := CASE
        WHEN v_stat <> 'total_pins' THEN v_cfg.spacing_count
        WHEN v_scope = 'game' THEN v_cfg.spacing_score
        ELSE v_cfg.spacing_night_pins END;
      v_hi := CASE WHEN v_stat = 'total_pins'
                   THEN 300 * v_cn * array_length(v_members, 1) - 0.5
                   ELSE 10 * v_cn * array_length(v_members, 1) - 0.5 END;

      PERFORM public.odds_engine_mint_ladder(
        v_market_id, v_line, v_mean, v_var, v_cn, v_spacing, 0.5, v_hi, v_season_id);

      IF v_spec_line IS NULL THEN
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.key = 'over';
      ELSE
        SELECT s.id, s.line, s.odds INTO v_over_id, v_line, v_odds
          FROM public.bet_selections s
          WHERE s.market_id = v_market_id AND s.side = 'over' AND s.line = v_spec_line;
        IF v_over_id IS NULL THEN
          RAISE EXCEPTION 'That line is not offered for this combo — pick a posted rung';
        END IF;
      END IF;

      v_n_created := v_n_created + 1;
      IF v_first_created IS NULL THEN
        v_first_created := jsonb_build_object(
          'stat', v_stat, 'scope', v_scope, 'game_number', v_game_number,
          'member_count', array_length(v_members, 1),
          'member_names', to_jsonb(v_member_names),
          'line', v_line, 'odds', v_odds);
      END IF;
    END IF;

    -- One ticket cannot carry the same combo twice (place_house_bet expects
    -- each leg on a distinct market; two identical specs dedup to one market).
    IF v_market_id = ANY (v_market_ids) THEN
      RAISE EXCEPTION 'The same combo appears twice on this ticket';
    END IF;
    v_market_ids := v_market_ids || v_market_id;
    v_over_ids := v_over_ids || v_over_id;
    v_combos_out := v_combos_out || jsonb_build_object(
      'market_id', v_market_id, 'line', v_line, 'odds', v_odds, 'deduped', v_deduped);
  END LOOP;

  -- Parlay extras must be OTHER markets' selections (no self-referential legs).
  IF p_extra_selection_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bet_selections s
    WHERE s.id = ANY (p_extra_selection_ids) AND s.market_id = ANY (v_market_ids)
  ) THEN
    RAISE EXCEPTION 'A combo cannot parlay with its own selections';
  END IF;

  -- Compose = bet: place_house_bet re-validates every leg (open market, same
  -- season/week, min stake, balance, anti-tank, item contracts) and writes the
  -- bet + legs + the bet_stake double entry. Any failure rolls the new
  -- market(s) back too.
  v_bet_id := public.place_house_bet(
    v_over_ids || COALESCE(p_extra_selection_ids, '{}'::uuid[]),
    p_stake, NULL,
    p_insurance_item_id, p_crutch_item_id, p_boost_item_id);

  -- Feed: at most ONE compose card per bet (activity_feed_unique_bet_event is
  -- (bet, event_type)) — published only when this ticket minted ≥1 new market;
  -- payload carries the first created combo + how many were created. Dedup-only
  -- tickets post nothing beyond place_house_bet's own priority events.
  IF v_n_created > 0 THEN
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_combo_composed',
      v_season_id, p_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.combo_composed',
      v_first_created || jsonb_build_object('stake', p_stake, 'combo_count', v_n_created),
      jsonb_build_object('bet_id', v_bet_id, 'market_ids', to_jsonb(v_market_ids)),
      NULL, now());
  END IF;

  RETURN jsonb_build_object('bet_id', v_bet_id, 'combos', v_combos_out);
END;
$function$
;

-- 3. Price the live board now: the engine shipped enabled, so every
-- non-archived week's betless markets re-ladder immediately.
DO $$
DECLARE w record;
BEGIN
  FOR w IN SELECT id FROM public.weeks WHERE is_archived = false LOOP
    PERFORM public.resync_week_markets(w.id);
  END LOOP;
END $$;
