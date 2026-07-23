-- ─────────────────────────────────────────────────────────────────────────────
-- Value-first lines (2 of 2): mint-on-demand placement.
--
-- The bettor picks the VALUE they want to beat; placement prices it
-- authoritatively and mints the rung if the book doesn't carry it yet:
--   • bet_mint_rung_internal — one rung's price-and-mint: posted rung →
--     tolerance-check the client quote and reuse it; absent → price fresh
--     inside the custom band, reject out-of-band, and insert the over/under
--     PAIR at the fresh zero-vig price (client-supplied odds are never
--     stored). Under rungs stay UI-hidden but must exist: settlement grades
--     both sides and PvP prop duels derive the counterparty as same-rung-
--     opposite-side. Race-safe via ON CONFLICT (market_id, key) DO NOTHING +
--     re-read. Quote drift beyond quote_tolerance raises the machine-
--     parseable 'ODDS_MOVED|<market_id>|<quoted>|<fresh>' contract.
--   • place_bet_at_lines — the line-shaped placement wrapper: picks are
--     {market_id, line, quoted_odds}; every leg goes through the mint helper
--     and the ids feed the untouched place_house_bet core (atomic — a failed
--     placement rolls minted rungs back, so no betless custom rung ever
--     persists).
--   • compose_combo_bet — re-signed: specs gain optional "quoted_odds"
--     (with it, an unposted chosen line MINTS instead of raising — on both
--     the fresh and dedup paths; without it, deployed-client behavior is
--     byte-identical), plus p_extra_picks so a combo can parlay with
--     custom-line regular legs in ONE bet.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. bet_mint_rung_internal ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bet_mint_rung_internal(p_market_id uuid, p_line numeric, p_quoted_odds numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt      public.bet_markets;
  v_line     numeric;
  v_cfg      public.odds_engine_config;
  v_d        record;
  v_sel      record;
  v_over     numeric;
  v_under    numeric;
BEGIN
  IF p_quoted_odds IS NULL OR p_quoted_odds <= 1.0 THEN
    RAISE EXCEPTION 'A quoted price is required to take a line';
  END IF;

  SELECT * INTO v_mkt FROM public.bet_markets WHERE id = p_market_id;
  IF v_mkt.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_mkt.status <> 'open' THEN
    RAISE EXCEPTION 'A selected market is not open';
  END IF;

  IF p_line IS NULL OR p_line <> floor(p_line) + 0.5 THEN
    RAISE EXCEPTION 'Lines must land on a half point (got %)', p_line;
  END IF;
  -- Canonical numeric text: '4.50'::numeric and '4.5'::numeric must build the
  -- SAME 'over:<line>' key the ladder minter builds (its lines come out of
  -- seed + j × spacing arithmetic, minimal scale).
  v_line := trim_scale(p_line);

  SELECT * INTO v_d FROM public.odds_engine_market_distribution(p_market_id);
  v_cfg := public.odds_engine_get_config(v_d.season_id);

  -- Posted rung → the book's standing offer wins; the quote just has to
  -- agree with it within tolerance.
  SELECT s.id, s.odds INTO v_sel
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;
  IF v_sel.id IS NOT NULL THEN
    IF abs(v_sel.odds - p_quoted_odds) > v_cfg.quote_tolerance THEN
      RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_sel.odds;
    END IF;
    RETURN v_sel.id;
  END IF;

  -- Fresh mint: price inside the custom band; out-of-band lines are simply
  -- not offered. Engine off → nothing beyond the posted pair is offered.
  IF NOT v_cfg.is_enabled THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  IF v_line < v_d.range_lo OR v_line > v_d.range_hi THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
    FROM public.odds_engine_price_pair(v_d.mean, v_d.variance, v_d.n_games, v_line,
                                       COALESCE(v_cfg.custom_odds_min, v_cfg.odds_min),
                                       COALESCE(v_cfg.custom_odds_max, v_cfg.odds_max),
                                       false) pp;
  IF v_over IS NULL THEN
    RAISE EXCEPTION 'That line is not available right now';
  END IF;
  IF abs(v_over - p_quoted_odds) > v_cfg.quote_tolerance THEN
    RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_over;
  END IF;

  -- Mint the PAIR at the fresh price. sort_order 100 + 2·line keeps custom
  -- rungs stable, collision-free (half-point lines step in whole units of
  -- 2·line), and after the generated ladder's 0..13; the client orders by
  -- line anyway.
  INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side)
    VALUES
      (p_market_id, 'over:'  || v_line, 'Over',  v_over,  v_line, 100 + (v_line * 2)::integer, 'over'),
      (p_market_id, 'under:' || v_line, 'Under', v_under, v_line, 101 + (v_line * 2)::integer, 'under')
    ON CONFLICT (market_id, key) DO NOTHING;

  -- Re-read: on a concurrent mint the unique constraint arbitrates and the
  -- winner's posted price stands — tolerance-check it like any posted rung.
  SELECT s.id, s.odds INTO v_sel
    FROM public.bet_selections s
    WHERE s.market_id = p_market_id AND s.side = 'over' AND s.line = v_line;
  IF v_sel.id IS NULL THEN
    RAISE EXCEPTION 'Could not mint the requested line';
  END IF;
  IF abs(v_sel.odds - p_quoted_odds) > v_cfg.quote_tolerance THEN
    RAISE EXCEPTION 'ODDS_MOVED|%|%|%', p_market_id, p_quoted_odds, v_sel.odds;
  END IF;
  RETURN v_sel.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.bet_mint_rung_internal(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- 2. place_bet_at_lines ──────────────────────────────────────────────────────
-- Line-shaped placement: every pick is {market_id, line, quoted_odds}. The
-- accounting core (place_house_bet) is untouched — it re-validates every leg,
-- writes the bet + legs + the stake double entry, and any failure rolls the
-- minted rungs back with it.
CREATE OR REPLACE FUNCTION public.place_bet_at_lines(p_picks jsonb, p_stake integer, p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pick       jsonb;
  v_market_id  uuid;
  v_market_ids uuid[] := '{}';
  v_sel_ids    uuid[] := '{}';
BEGIN
  IF p_picks IS NULL OR jsonb_typeof(p_picks) <> 'array' OR jsonb_array_length(p_picks) < 1 THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;

  FOR v_pick IN SELECT value FROM jsonb_array_elements(p_picks) LOOP
    v_market_id := (v_pick ->> 'market_id')::uuid;
    IF v_market_id IS NULL THEN
      RAISE EXCEPTION 'Every pick needs a market_id';
    END IF;
    IF v_market_id = ANY (v_market_ids) THEN
      RAISE EXCEPTION 'The same market appears twice on this ticket';
    END IF;
    v_market_ids := v_market_ids || v_market_id;
    v_sel_ids := v_sel_ids || public.bet_mint_rung_internal(
      v_market_id, (v_pick ->> 'line')::numeric, (v_pick ->> 'quoted_odds')::numeric);
  END LOOP;

  RETURN public.place_house_bet(v_sel_ids, p_stake, NULL,
                                p_insurance_item_id, p_crutch_item_id, p_boost_item_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.place_bet_at_lines(jsonb, integer, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.place_bet_at_lines(jsonb, integer, uuid, uuid, uuid) TO authenticated;

-- 3. compose_combo_bet — quoted specs mint their chosen line ─────────────────
-- Re-signed (extra param with a default → deployed clients keep working; the
-- DROP is required because CREATE OR REPLACE cannot add parameters).
DROP FUNCTION public.compose_combo_bet(uuid, jsonb, integer, uuid[], uuid, uuid, uuid);

CREATE FUNCTION public.compose_combo_bet(p_week_id uuid, p_combos jsonb, p_stake integer, p_extra_selection_ids uuid[] DEFAULT NULL::uuid[], p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid, p_extra_picks jsonb DEFAULT NULL::jsonb)
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
  v_spec_quote   numeric;
  v_odds         numeric;
  v_mean         numeric;
  v_var          numeric;
  v_cfg          public.odds_engine_config;
  v_spacing      numeric;
  v_hi           numeric;
  v_cn           integer;
  v_pick         jsonb;
  v_extra_ids    uuid[] := '{}';
  v_pick_market  uuid;
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
    -- Optional chosen rung: NULL means the seed rung (canonical 'over' key).
    -- With a quoted price attached, an UNPOSTED chosen line mints on demand
    -- (bet_mint_rung_internal); without one, legacy behavior — posted rungs
    -- only.
    v_spec_line := (v_spec ->> 'line')::numeric;
    v_spec_quote := (v_spec ->> 'quoted_odds')::numeric;

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
      ELSIF v_spec_quote IS NOT NULL THEN
        -- Quoted spec: posted rungs reuse (tolerance-checked inside), unposted
        -- lines mint at the fresh price.
        v_over_id := public.bet_mint_rung_internal(v_market_id, v_spec_line, v_spec_quote);
        SELECT s.line, s.odds INTO v_line, v_odds
          FROM public.bet_selections s WHERE s.id = v_over_id;
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
          IF v_spec_quote IS NOT NULL THEN
            -- Chosen line off the fresh ladder: mint it on demand alongside.
            v_over_id := public.bet_mint_rung_internal(v_market_id, v_spec_line, v_spec_quote);
            SELECT s.line, s.odds INTO v_line, v_odds
              FROM public.bet_selections s WHERE s.id = v_over_id;
          ELSE
            RAISE EXCEPTION 'That line is not offered for this combo — pick a posted rung';
          END IF;
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

  -- Line-shaped parlay extras: regular picks riding the same ticket, minted
  -- through the same helper (must be OTHER markets — no self-referential legs).
  IF p_extra_picks IS NOT NULL THEN
    IF jsonb_typeof(p_extra_picks) <> 'array' THEN
      RAISE EXCEPTION 'extra_picks must be an array';
    END IF;
    FOR v_pick IN SELECT value FROM jsonb_array_elements(p_extra_picks) LOOP
      v_pick_market := (v_pick ->> 'market_id')::uuid;
      IF v_pick_market IS NULL THEN
        RAISE EXCEPTION 'Every pick needs a market_id';
      END IF;
      IF v_pick_market = ANY (v_market_ids) THEN
        RAISE EXCEPTION 'A combo cannot parlay with its own selections';
      END IF;
      v_extra_ids := v_extra_ids || public.bet_mint_rung_internal(
        v_pick_market, (v_pick ->> 'line')::numeric, (v_pick ->> 'quoted_odds')::numeric);
    END LOOP;
  END IF;

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
  -- market(s) and minted rung(s) back too.
  v_bet_id := public.place_house_bet(
    v_over_ids || v_extra_ids || COALESCE(p_extra_selection_ids, '{}'::uuid[]),
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
$function$;

REVOKE EXECUTE ON FUNCTION public.compose_combo_bet(uuid, jsonb, integer, uuid[], uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compose_combo_bet(uuid, jsonb, integer, uuid[], uuid, uuid, uuid, jsonb) TO authenticated;
